from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Read from backend/.env, or from the environment."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Only used to make the first admin account, when there are no accounts
    # yet. After that, accounts are managed on the Staff page.
    admin_username: str = ""
    admin_password: str = ""
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'seedcode.db').as_posix()}"
    # Database connections kept by each copy of the app, and how many more it
    # may open when busy. Copies x (size + overflow) must stay under what the
    # database allows.
    db_pool_size: int = 5
    db_max_overflow: int = 5
    session_hours: int = 12
    # The interactive API pages at /api/docs.
    docs: bool = True
    host: str = "127.0.0.1"
    port: int = 8010
    reload: bool = True
    # This computer's address on the local network. Only needed inside
    # Docker, where the backend cannot find it out by itself.
    lan_address: str = ""


settings = Settings()
