"""The JSON shapes the frontend sends and receives (camelCase on the wire)."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    StringConstraints,
    field_serializer,
    field_validator,
)
from pydantic.alias_generators import to_camel

Text = Annotated[str, StringConstraints(max_length=300)]
Required = Annotated[str, StringConstraints(min_length=1, max_length=300)]

# Times outside these years are typing mistakes or attempts to break the
# date arithmetic, never real entries.
EARLIEST_YEAR = 1970
LATEST_YEAR = 2200


def utc_iso(value: dt.datetime) -> str:
    return value.replace(tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")


def no_nul(value: str) -> str:
    # PostgreSQL cannot store the NUL character, and no one types it.
    return value.replace("\x00", "")


class Wire(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        str_strip_whitespace=True,
    )


class Input(Wire):
    """Anything a browser or phone sends."""

    @field_validator("*", mode="before")
    @classmethod
    def drop_nul(cls, value):
        return no_nul(value) if isinstance(value, str) else value


class Login(Input):
    # Long enough for any real password; a longer one would only make
    # checking it slow.
    username: Annotated[str, StringConstraints(max_length=200)] = ""
    password: Annotated[str, StringConstraints(max_length=200)] = ""


def tidy_extra(value) -> dict[str, str]:
    """Answers to custom questions: short text values under short keys."""
    if not isinstance(value, dict):
        return {}
    return {
        no_nul(str(k))[:40]: no_nul(str(v))[:1000]
        for k, v in list(value.items())[:50]
        if v is not None
    }


Option = Annotated[str, StringConstraints(max_length=300)]


class FieldSpec(Input):
    """One question on a form, as the office set it up."""

    key: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    label: Annotated[str, StringConstraints(max_length=200)] = ""
    hint: Annotated[str, StringConstraints(max_length=300)] = ""
    type: Annotated[str, StringConstraints(max_length=20)] = "text"
    # The distribution channels are the longest list (see forms.MAX_CHANNELS).
    options: Annotated[list[Option], Field(max_length=2000)] = []
    required: bool = False
    hidden: bool = False
    builtin: bool = False
    core: bool = False


class LotIn(Input):
    # Crop, variety, batch number and date are always required. Whether the
    # others are is the office's choice, checked in forms.check_lot().
    date: dt.date
    seed_type: Text = ""
    crop: Required
    variety: Required
    batch_no: Required
    production_source: Text = ""
    certification: Text = ""
    expiry_date: dt.date | None = None
    storage_location: Text = ""
    packing_location: Text = ""
    extra: dict[str, str] = {}

    @field_validator("extra", mode="before")
    @classmethod
    def tidy(cls, value):
        return tidy_extra(value)

    @field_validator("expiry_date", mode="before")
    @classmethod
    def blank_is_none(cls, value):
        return None if value == "" else value


class LotOut(Wire):
    id: str
    date: dt.date
    seed_type: str
    crop: str
    variety: str
    batch_no: str
    production_source: str
    certification: str
    expiry_date: dt.date | None
    storage_location: str
    packing_location: str
    created_at: dt.datetime
    updated_at: dt.datetime | None = None
    entry_count: int | None = None
    extra: dict[str, str] = {}

    @field_validator("extra", mode="before")
    @classmethod
    def tidy(cls, value):
        return tidy_extra(value)

    @field_validator("expiry_date", mode="before")
    @classmethod
    def blank_is_none(cls, value):
        return None if value == "" else value

    @field_serializer("expiry_date")
    def blank_expiry(self, value: dt.date | None) -> str:
        return value.isoformat() if value else ""

    @field_serializer("created_at")
    def created_utc(self, value: dt.datetime) -> str:
        return utc_iso(value)

    @field_serializer("updated_at")
    def updated_utc(self, value: dt.datetime | None) -> str | None:
        return utc_iso(value) if value else None


LotList = RootModel[list[LotOut]]


class LotMade(LotOut):
    """The answer to adding a seed lot."""

    # True when a lot with the same crop, variety and batch was already
    # there, and this is that lot rather than a new one.
    existing: bool = False


class EntryIn(Input):
    id: Annotated[str, StringConstraints(min_length=8, max_length=64)]
    lot_id: Annotated[str, StringConstraints(min_length=1, max_length=8)]
    date: Annotated[str, StringConstraints(max_length=20)] = ""
    filled_by: Literal["Farmer", "Field officer"] = "Farmer"
    farmer_name: Required
    kyc_type: Literal["", "Aadhaar ID", "PAN ID", "Other"] = ""
    kyc_other: Text = ""
    id_number: Annotated[str, StringConstraints(max_length=40)] = ""
    contact: Annotated[str, StringConstraints(max_length=20)] = ""
    # Not checked against the office's required settings: a farmer may have
    # filled the form offline before a setting changed, and the entry must
    # not be lost for that.
    channel: Text = ""
    landholding: Text = ""
    quantity: Text = ""
    filled_at: Annotated[str, StringConstraints(max_length=40)] = ""
    device_id: Annotated[str, StringConstraints(max_length=64)] = ""
    fingerprint: Annotated[str, StringConstraints(max_length=64)] = ""
    user_agent: str = ""
    device: dict[str, str] = {}
    extra: dict[str, str] = {}

    @field_validator("extra", mode="before")
    @classmethod
    def tidy(cls, value):
        return tidy_extra(value)

    @field_validator("user_agent")
    @classmethod
    def shorten(cls, value: str) -> str:
        return value[:400]

    @field_validator("device", mode="before")
    @classmethod
    def tidy_device(cls, value):
        # Older entries have none. Keep it small: short text values only.
        if not isinstance(value, dict):
            return {}
        return {no_nul(str(k))[:40]: no_nul(str(v))[:200] for k, v in list(value.items())[:30]}


class EntryOut(EntryIn):
    received_at: dt.datetime
    ip_address: str = ""
    lot: LotOut | None
    # Set once the office has corrected the entry.
    updated_at: dt.datetime | None = None
    updated_by: str | None = None

    @field_validator("ip_address", mode="before")
    @classmethod
    def no_address(cls, value):
        return value or ""

    @field_serializer("received_at")
    def received_utc(self, value: dt.datetime) -> str:
        return utc_iso(value)

    @field_serializer("updated_at")
    def updated_utc(self, value: dt.datetime | None) -> str | None:
        return utc_iso(value) if value else None


class EntryChange(Input):
    """A correction to an entry, made in the office. Which seed lot it
    belongs to, when it was received and what phone sent it never change."""

    date: Annotated[str, StringConstraints(max_length=20)] = ""
    filled_by: Literal["Farmer", "Field officer"]
    farmer_name: Required
    kyc_type: Literal["", "Aadhaar ID", "PAN ID", "Other"] = ""
    kyc_other: Text = ""
    id_number: Annotated[str, StringConstraints(max_length=40)] = ""
    contact: Annotated[str, StringConstraints(max_length=20)] = ""
    channel: Text = ""
    landholding: Text = ""
    quantity: Text = ""
    extra: dict[str, str] = {}

    @field_validator("extra", mode="before")
    @classmethod
    def tidy(cls, value):
        return tidy_extra(value)


class SeedIn(Input):
    """The seed details written on a row of an imported file, for files
    that have them in place of a QR code."""

    crop: Required
    variety: Required
    batch_no: Required
    seed_type: Text = ""
    production_source: Text = ""
    certification: Text = ""
    expiry_date: dt.date | None = None
    storage_location: Text = ""
    packing_location: Text = ""
    # The seed lot's date, if one has to be made: the earliest row's day.
    date: dt.date | None = None

    @field_validator("expiry_date", "date", mode="before")
    @classmethod
    def blank_is_none(cls, value):
        return None if value == "" else value


class ImportRow(EntryIn):
    """One row of an imported file. It names its seed lot by QR code, or
    carries the seed details so the lot can be found or made."""

    lot_id: Annotated[str, StringConstraints(max_length=8)] = ""
    seed: SeedIn | None = None
    # When the entry was really made, for files that record it. Left out,
    # the entry counts as received when it is imported.
    received_at: dt.datetime | None = None

    @field_validator("received_at")
    @classmethod
    def stored_as_utc(cls, value: dt.datetime | None) -> dt.datetime | None:
        if value is None:
            return value
        if not EARLIEST_YEAR <= value.year <= LATEST_YEAR:
            raise ValueError("not a real time")
        if value.tzinfo is not None:
            value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return value


class EntryPage(Wire):
    """One page of the entries list, and how many match in all."""

    items: list[EntryOut]
    total: int


class ChannelCount(Wire):
    name: str
    counts: dict[str, int]


class Stats(Wire):
    """The numbers behind the dashboard's charts (see stats.py)."""

    # Every crop that has ever had an entry, oldest first.
    series: list[str]
    # What the counts are split by: the series are crops, or varieties.
    by: Literal["crop", "variety"] = "crop"
    # When the very first and the latest entry came in, for "all time".
    first: dt.datetime | None = None
    last: dt.datetime | None = None
    # How many distribution channels had an entry in the period.
    channel_count: int = 0
    # How many seed lots had an entry in the period.
    lot_count: int = 0

    @field_serializer("first", "last")
    def moment_utc(self, value: dt.datetime | None) -> str | None:
        return utc_iso(value) if value else None

    # Entries in the period of the same length just before this one.
    previous: int
    # One per day or week: how many entries each crop had.
    columns: list[dict[str, int]]
    channels: list[ChannelCount]
    # The rest feeds the dashboard's insights.
    kpis: "Kpis | None" = None
    # Entries by day of the week (0 is Sunday) and hour, in the office's
    # own time: seven rows of 24 counts.
    heatmap: list[list[int]] = []
    lots: "LotSummary | None" = None
    # The newest few entries of the period.
    latest: list["LatestEntry"] = []


class Kpis(Wire):
    """Counts about the entries of the period, beyond how many there were."""

    # Different mobile numbers given, and how many of them appear on more
    # than one entry (the same farmer twice, or a shared phone).
    farmers: int = 0
    repeat_farmers: int = 0
    with_id: int = 0
    with_contact: int = 0
    by_officer: int = 0
    # Different phones the entries were sent from.
    devices: int = 0


class WaitingLot(Wire):
    id: str
    crop: str
    variety: str
    batch_no: str
    created_at: dt.datetime

    @field_serializer("created_at")
    def created_utc(self, value: dt.datetime) -> str:
        return utc_iso(value)


class LotSummary(Wire):
    """Seed lots in use now, whatever the period."""

    total: int
    # Lots nobody has scanned yet, and the newest few of them.
    unused: int
    waiting: list[WaitingLot]


class LatestEntry(Wire):
    id: str
    farmer_name: str
    crop: str
    variety: str
    quantity: str
    channel: str
    received_at: dt.datetime

    @field_serializer("received_at")
    def received_utc(self, value: dt.datetime) -> str:
        return utc_iso(value)


class Imported(Wire):
    # Rows saved now. Rows that were already there are not counted.
    count: int
    # Seed lots that had to be made for them.
    lots_made: int = 0


class PublicLot(LotOut):
    """What a farmer's phone gets after scanning: the lot and both forms."""

    lot_fields: list[FieldSpec] = []
    farmer_fields: list[FieldSpec] = []


Role = Literal["admin", "editor", "viewer"]
Password = Annotated[str, StringConstraints(min_length=8, max_length=200)]


class Token(Wire):
    token: str
    username: str
    role: Role


class StaffNew(Input):
    username: Annotated[str, StringConstraints(min_length=3, max_length=100)]
    password: Password
    role: Role


class StaffChange(Input):
    role: Role
    active: bool
    # Left out to keep the password as it is.
    password: Password | None = None


class StaffOut(Wire):
    id: int
    username: str
    role: Role
    active: bool
    created_at: dt.datetime

    @field_serializer("created_at")
    def created_utc(self, value: dt.datetime) -> str:
        return utc_iso(value)


class Address(Wire):
    lan: str | None


class Ok(Wire):
    ok: bool = True


Stats.model_rebuild()
