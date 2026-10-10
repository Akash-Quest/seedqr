"""The JSON shapes the frontend sends and receives (camelCase on the wire)."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    StringConstraints,
    field_serializer,
    field_validator,
)
from pydantic.alias_generators import to_camel

Text = Annotated[str, StringConstraints(max_length=300)]
Required = Annotated[str, StringConstraints(min_length=1, max_length=300)]


def utc_iso(value: dt.datetime) -> str:
    return value.replace(tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")


class Wire(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        str_strip_whitespace=True,
    )


class Login(Wire):
    username: str = ""
    password: str = ""


def tidy_extra(value) -> dict[str, str]:
    """Answers to custom questions: short text values under short keys."""
    if not isinstance(value, dict):
        return {}
    return {str(k)[:40]: str(v)[:1000] for k, v in list(value.items())[:50] if v is not None}


class FieldSpec(Wire):
    """One question on a form, as the office set it up."""

    key: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    label: Annotated[str, StringConstraints(max_length=200)] = ""
    hint: Annotated[str, StringConstraints(max_length=300)] = ""
    type: str = "text"
    options: list[str] = []
    required: bool = False
    hidden: bool = False
    builtin: bool = False
    core: bool = False


class LotIn(Wire):
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


class EntryIn(Wire):
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
        return {str(k)[:40]: str(v)[:200] for k, v in list(value.items())[:30]}


class EntryOut(EntryIn):
    received_at: dt.datetime
    ip_address: str = ""
    lot: LotOut | None

    @field_validator("ip_address", mode="before")
    @classmethod
    def no_address(cls, value):
        return value or ""

    @field_serializer("received_at")
    def received_utc(self, value: dt.datetime) -> str:
        return utc_iso(value)


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
    # Entries in the period of the same length just before this one.
    previous: int
    # One per day or week: how many entries each crop had.
    columns: list[dict[str, int]]
    channels: list[ChannelCount]


class Imported(Wire):
    count: int


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


class StaffNew(Wire):
    username: Annotated[str, StringConstraints(min_length=3, max_length=100)]
    password: Password
    role: Role


class StaffChange(Wire):
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
