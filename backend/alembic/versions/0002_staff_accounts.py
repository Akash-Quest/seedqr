"""Staff accounts with roles, and sign-ins that belong to an account."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String(100), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(200), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    # Sign-ins made before accounts existed belong to nobody, so everyone
    # signs in once more.
    op.drop_table("admin_sessions")
    op.create_table(
        "admin_sessions",
        sa.Column("token", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_admin_sessions_user_id", "admin_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_table("admin_sessions")
    op.create_table(
        "admin_sessions",
        sa.Column("token", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )
    op.drop_table("users")
