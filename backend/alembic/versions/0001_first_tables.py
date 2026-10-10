"""The tables as they were before migrations were introduced."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None


def upgrade() -> None:
    op.create_table(
        "seed_lots",
        sa.Column("id", sa.String(8), primary_key=True),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("seed_type", sa.String(300), nullable=False),
        sa.Column("crop", sa.String(300), nullable=False),
        sa.Column("variety", sa.String(300), nullable=False),
        sa.Column("batch_no", sa.String(300), nullable=False),
        sa.Column("production_source", sa.String(300), nullable=False),
        sa.Column("certification", sa.String(300), nullable=False),
        sa.Column("expiry_date", sa.Date),
        sa.Column("storage_location", sa.String(300), nullable=False),
        sa.Column("packing_location", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime),
        sa.Column("deleted_at", sa.DateTime),
        sa.Column("extra", sa.JSON),
    )
    op.create_table(
        "farmer_entries",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("lot_id", sa.String(8), sa.ForeignKey("seed_lots.id"), nullable=False),
        sa.Column("date", sa.String(20), nullable=False),
        sa.Column("filled_by", sa.String(20), nullable=False),
        sa.Column("farmer_name", sa.String(300), nullable=False),
        sa.Column("kyc_type", sa.String(20), nullable=False),
        sa.Column("kyc_other", sa.String(300), nullable=False),
        sa.Column("id_number", sa.String(40), nullable=False),
        sa.Column("contact", sa.String(20), nullable=False),
        sa.Column("channel", sa.String(300), nullable=False),
        sa.Column("landholding", sa.String(300), nullable=False),
        sa.Column("quantity", sa.String(300), nullable=False),
        sa.Column("filled_at", sa.String(40), nullable=False),
        sa.Column("device_id", sa.String(64), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("user_agent", sa.String(400), nullable=False),
        sa.Column("device", sa.JSON),
        sa.Column("ip_address", sa.String(64)),
        sa.Column("lot_snapshot", sa.JSON),
        sa.Column("extra", sa.JSON),
        sa.Column("received_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_farmer_entries_lot_id", "farmer_entries", ["lot_id"])
    op.create_index("ix_farmer_entries_received_at", "farmer_entries", ["received_at"])
    op.create_table(
        "form_settings",
        sa.Column("form", sa.String(10), primary_key=True),
        sa.Column("fields", sa.JSON, nullable=False),
        sa.Column("updated_at", sa.DateTime),
    )
    op.create_table(
        "admin_sessions",
        sa.Column("token", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("admin_sessions")
    op.drop_table("form_settings")
    op.drop_table("farmer_entries")
    op.drop_table("seed_lots")
