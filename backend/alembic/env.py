from alembic import context

from app import models  # noqa: F401  (so every table is known)
from app.database import Base, engine

# Always run against the app's own database, with the app's own settings.
with engine.connect() as connection:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        # SQLite cannot change a column in place; this rebuilds the table.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()
