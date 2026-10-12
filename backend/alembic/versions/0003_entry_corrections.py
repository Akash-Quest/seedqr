"""Records when an entry was corrected in the office, and by whom."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade() -> None:
    op.add_column("farmer_entries", sa.Column("updated_at", sa.DateTime))
    op.add_column("farmer_entries", sa.Column("updated_by", sa.String(100)))


def downgrade() -> None:
    with op.batch_alter_table("farmer_entries") as table:
        table.drop_column("updated_by")
        table.drop_column("updated_at")
