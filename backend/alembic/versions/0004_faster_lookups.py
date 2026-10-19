"""Faster lookups for a large number of entries.

- seed_lots.seed_key: finds "the same seed" with one indexed lookup instead
  of reading every lot.
- farmer_entries (received_at, id): the entries list's order, so a page is
  read from the index instead of sorting every entry.
- PostgreSQL only: trigram indexes, so a search for part of a name, phone
  number or channel does not read every entry. Their names start with
  "trgm_"; the models do not describe them (see tests/test_api.py).
"""

import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"

SEARCHED = ("farmer_name", "contact", "channel")


def seed_key(crop, variety, batch_no) -> str:
    # The same as app.models.seed_key, copied so this step never changes.
    parts = (" ".join((part or "").split()).lower() for part in (crop, variety, batch_no))
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def upgrade() -> None:
    with op.batch_alter_table("seed_lots") as table:
        table.add_column(sa.Column("seed_key", sa.String(64), nullable=False, server_default=""))

    lots = sa.table(
        "seed_lots",
        sa.column("id", sa.String),
        sa.column("crop", sa.String),
        sa.column("variety", sa.String),
        sa.column("batch_no", sa.String),
        sa.column("seed_key", sa.String),
    )
    connection = op.get_bind()
    rows = connection.execute(sa.select(lots.c.id, lots.c.crop, lots.c.variety, lots.c.batch_no)).all()
    for lot_id, crop, variety, batch_no in rows:
        connection.execute(
            lots.update().where(lots.c.id == lot_id).values(seed_key=seed_key(crop, variety, batch_no))
        )
    op.create_index("ix_seed_lots_seed_key", "seed_lots", ["seed_key"])

    op.drop_index("ix_farmer_entries_received_at", table_name="farmer_entries")
    op.create_index("ix_farmer_entries_received_at_id", "farmer_entries", ["received_at", "id"])

    if connection.dialect.name == "postgresql":
        add_trigram_indexes(connection)


def add_trigram_indexes(connection) -> None:
    """Needs the pg_trgm extension, which comes with PostgreSQL. A database
    that does not allow adding it simply searches more slowly."""
    try:
        with connection.begin_nested():
            connection.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    except sa.exc.DBAPIError:
        print("pg_trgm is not available; searching entries will read every entry.")
        return
    for column in SEARCHED:
        connection.execute(
            sa.text(
                f"CREATE INDEX IF NOT EXISTS trgm_farmer_entries_{column} "
                f"ON farmer_entries USING gin ({column} gin_trgm_ops)"
            )
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        for column in SEARCHED:
            connection.execute(sa.text(f"DROP INDEX IF EXISTS trgm_farmer_entries_{column}"))
    op.drop_index("ix_farmer_entries_received_at_id", table_name="farmer_entries")
    op.create_index("ix_farmer_entries_received_at", "farmer_entries", ["received_at"])
    op.drop_index("ix_seed_lots_seed_key", table_name="seed_lots")
    if connection.dialect.name == "sqlite":
        # In place (SQLite 3.35 and later): rebuilding the table instead, as
        # batch mode does, trips over the entries that point at its rows.
        op.execute("ALTER TABLE seed_lots DROP COLUMN seed_key")
    else:
        op.drop_column("seed_lots", "seed_key")
