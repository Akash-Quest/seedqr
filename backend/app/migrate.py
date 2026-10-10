"""Brings the database up to date:  python -m app.migrate

Run once before the app starts (run.py does it; in Docker it is its own
step), never by every copy of the app at once. The changes
themselves are in alembic/versions.
"""

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from .auth import seed_admin
from .config import BACKEND_DIR
from .database import SessionLocal, engine


def add_missing_columns() -> None:
    """Databases made before migrations existed were brought up to date by
    this at every start. Kept so such a database can join the migrations."""
    wanted = {
        "farmer_entries": {
            "device": "JSON", "ip_address": "VARCHAR(64)", "lot_snapshot": "JSON", "extra": "JSON",
            "date": "VARCHAR(20) DEFAULT ''",
        },
        "seed_lots": {"updated_at": "DATETIME", "deleted_at": "DATETIME", "extra": "JSON"},
    }
    with engine.begin() as connection:
        for table, columns in wanted.items():
            existing = {column["name"] for column in inspect(engine).get_columns(table)}
            for name, kind in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {kind}"))


def upgrade() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    tables = set(inspect(engine).get_table_names())
    if "seed_lots" in tables and "alembic_version" not in tables:
        # An older database: its tables are already there, so start from
        # the first migration instead of running it.
        add_missing_columns()
        command.stamp(config, "0001")
    command.upgrade(config, "head")
    with SessionLocal() as db:
        seed_admin(db)


if __name__ == "__main__":
    upgrade()
