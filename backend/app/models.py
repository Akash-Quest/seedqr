import datetime as dt
import hashlib

from sqlalchemy import JSON, ForeignKey, Index, String, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> dt.datetime:
    # Stored without a timezone, always in UTC.
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def seed_key(crop: str | None, variety: str | None, batch_no: str | None) -> str:
    """Two lots are the same seed when crop, variety and batch match, whatever
    the capitals and spacing. Kept as a hash so it fits in an index on every
    database, and finding the same seed is one lookup however many lots
    there are."""
    parts = (" ".join((part or "").split()).lower() for part in (crop, variety, batch_no))
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


class SeedLot(Base):
    """What the admin enters for one batch of seed. One QR code per lot."""

    __tablename__ = "seed_lots"

    id: Mapped[str] = mapped_column(String(8), primary_key=True)
    date: Mapped[dt.date]
    seed_type: Mapped[str] = mapped_column(String(300))
    crop: Mapped[str] = mapped_column(String(300))
    variety: Mapped[str] = mapped_column(String(300))
    batch_no: Mapped[str] = mapped_column(String(300))
    production_source: Mapped[str] = mapped_column(String(300))
    certification: Mapped[str] = mapped_column(String(300), default="")
    expiry_date: Mapped[dt.date | None]
    storage_location: Mapped[str] = mapped_column(String(300))
    packing_location: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[dt.datetime] = mapped_column(default=utc_now)
    # Set when the office changes the details after the label was made.
    updated_at: Mapped[dt.datetime | None]
    # Set when the office deletes the lot. The row is kept so that farmer
    # entries made against it still have their seed details.
    deleted_at: Mapped[dt.datetime | None]
    # Answers to questions the office added itself, by question key.
    extra: Mapped[dict | None] = mapped_column(JSON)
    # seed_key() of the crop, variety and batch, kept up to date below.
    seed_key: Mapped[str] = mapped_column(String(64), default="", index=True)


@event.listens_for(SeedLot, "before_insert")
@event.listens_for(SeedLot, "before_update")
def _keep_seed_key(_mapper, _connection, lot: SeedLot) -> None:
    lot.seed_key = seed_key(lot.crop, lot.variety, lot.batch_no)


class FarmerEntry(Base):
    """What is filled in on the phone after scanning a bag."""

    __tablename__ = "farmer_entries"
    # The entries list is newest first; this index is already in that order,
    # so a page is read straight from it instead of sorting every entry.
    __table_args__ = (Index("ix_farmer_entries_received_at_id", "received_at", "id"),)

    # Made up by the phone, so the same entry sent twice is stored once.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    lot_id: Mapped[str] = mapped_column(ForeignKey("seed_lots.id"), index=True)
    # The date the farmer entered (YYYY-MM-DD), kept as text like the rest.
    date: Mapped[str] = mapped_column(String(20), default="")
    filled_by: Mapped[str] = mapped_column(String(20))
    farmer_name: Mapped[str] = mapped_column(String(300))
    kyc_type: Mapped[str] = mapped_column(String(20), default="")
    kyc_other: Mapped[str] = mapped_column(String(300), default="")
    id_number: Mapped[str] = mapped_column(String(40), default="")
    contact: Mapped[str] = mapped_column(String(20), default="")
    channel: Mapped[str] = mapped_column(String(300))
    landholding: Mapped[str] = mapped_column(String(300), default="")
    quantity: Mapped[str] = mapped_column(String(300))
    # The phone's own clock, so kept as text rather than trusted as a time.
    filled_at: Mapped[str] = mapped_column(String(40), default="")
    device_id: Mapped[str] = mapped_column(String(64), default="")
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(400), default="")
    # What the phone reported about itself: model, browser, screen and so on.
    device: Mapped[dict | None] = mapped_column(JSON, default=dict)
    # Seen by the server, not sent by the phone.
    ip_address: Mapped[str | None] = mapped_column(String(64), default="")
    # The seed details as they were when the farmer submitted, so a later
    # edit of the lot does not rewrite what this farmer actually saw.
    lot_snapshot: Mapped[dict | None] = mapped_column(JSON)
    # Answers to questions the office added itself, by question key.
    extra: Mapped[dict | None] = mapped_column(JSON)
    received_at: Mapped[dt.datetime] = mapped_column(default=utc_now)
    # Set when someone in the office corrects the entry: when, and who.
    updated_at: Mapped[dt.datetime | None]
    updated_by: Mapped[str | None] = mapped_column(String(100))

    lot: Mapped[SeedLot] = relationship(lazy="joined")


class FormSettings(Base):
    """The office's changes to one form's questions (see forms.py)."""

    __tablename__ = "form_settings"

    form: Mapped[str] = mapped_column(String(10), primary_key=True)
    fields: Mapped[list] = mapped_column(JSON)
    updated_at: Mapped[dt.datetime | None]


class User(Base):
    """Someone in the office who can sign in. Farmers never have one."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Always stored in lower case, so signing in ignores capitals.
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    # "admin", "editor" or "viewer" (see auth.py).
    role: Mapped[str] = mapped_column(String(10))
    # Switched off instead of deleted, so the account can come back.
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[dt.datetime] = mapped_column(default=utc_now)


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    # A hash of the token the browser holds, so reading this table is not
    # enough to sign in as someone.
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[dt.datetime]
