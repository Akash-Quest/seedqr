from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Read from backend/.env, or from the environment."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    admin_username: str
    admin_password: str
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'seedcode.db').as_posix()}"
    session_hours: int = 12
    host: str = "127.0.0.1"
    port: int = 8010
    reload: bool = True


settings = Settings()
