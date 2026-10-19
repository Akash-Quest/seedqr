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
    # The interactive API pages at /api/docs. Off unless asked for, so a
    # server on the internet does not describe itself to strangers.
    docs: bool = False
    host: str = "127.0.0.1"
    port: int = 8010
    reload: bool = True
    # This computer's address on the local network. Only needed inside
    # Docker, where the backend cannot find it out by itself.
    lan_address: str = ""

    # True when every request comes through one proxy (nginx, or Vite in
    # development) that adds the caller's address to X-Forwarded-For. Turn
    # it off if the backend is ever reached directly, since a caller could
    # then write any address there and slip past the limits below.
    behind_proxy: bool = True
    # Wrong passwords allowed from one address for one username in 15
    # minutes, before that pair has to wait.
    login_attempts: int = 10
    # Farmer entries one network address may send in a minute. Generous:
    # many phones can share one address on a mobile network, and a phone
    # that was offline sends all its saved entries at once.
    entries_per_minute: int = 120


settings = Settings()
