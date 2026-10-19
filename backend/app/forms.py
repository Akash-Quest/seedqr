"""The questions on the two forms, which the office can change.

"lot" is what the admin fills in for a seed lot; "farmer" is what the farmer
fills in after scanning. Built-in questions are stored in their own columns
and can be renamed, made optional or hidden. "Core" ones are needed by the
rest of the app (labels, charts) and always stay required and visible.
Custom questions are added by the office and stored in the `extra` column.
"""

import datetime as dt
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import cache, schemas
from .channels import CHANNELS
from .models import FormSettings, utc_now

FORMS = ("lot", "farmer")


def _builtin(key, label, type="text", required=True, core=False, hint="", options=None):
    return {
        "key": key, "label": label, "hint": hint, "type": type, "options": options or [],
        "required": required, "hidden": False, "builtin": True, "core": core,
    }


DEFAULTS = {
    "lot": [
        _builtin("date", "Date", "date", core=True),
        _builtin("seedType", "Seed type", hint="For example hybrid, certified or foundation"),
        _builtin("crop", "Crop intended for sowing", core=True),
        _builtin("variety", "Variety", core=True),
        _builtin("batchNo", "Batch/lot number", core=True),
        _builtin("productionSource", "Production source"),
        _builtin("certification", "Certification details", required=False),
        _builtin("expiryDate", "Expiry date", "date", required=False),
        _builtin("storageLocation", "Storage location"),
        _builtin("packingLocation", "Packing location", required=False),
    ],
    "farmer": [
        _builtin("date", "Date", "date"),
        _builtin("filledBy", "Who is filling this in?", "choice", options=["Farmer", "Field officer"]),
        _builtin("farmerName", "Farmer name", core=True),
        _builtin("kycType", "Document / KYC type", "kyc", required=False),
        _builtin("idNumber", "ID number", required=False),
        _builtin("contact", "Contact number", "phone", required=False),
        _builtin(
            "channel", "Distribution channel", "channel",
            hint="The list is long. Type part of the name or village to shorten it.",
            options=CHANNELS,
        ),
        _builtin("landholding", "Landholding size", required=False),
        _builtin("quantity", "Quantity of seed given"),
    ],
}

CUSTOM_TYPES = {"text", "number", "date", "select", "textarea"}
CUSTOM_KEY = re.compile(r"c_[a-z0-9]{4,20}")
MAX_FIELDS = 50
MAX_CHANNELS = 2000


def clean_options(options: list[str], limit: int) -> list[str]:
    # A dict keeps the order and finds a repeat in one step, however long
    # the list is.
    out: dict[str, None] = {}
    for option in options:
        option = " ".join(str(option).split())[:300]
        if option:
            out.setdefault(option)
            if len(out) >= limit:
                break
    return list(out)


def load(form: str, db: Session) -> list[dict]:
    """The form's questions in order, with the office's changes applied.
    Asked for at every scan of a bag, so kept until the forms change. What
    comes back is shared: read it, never change it."""
    return cache.remember(("form", form), ("forms",), lambda: _load(form, db))


def public(form: str, db: Session) -> list[dict]:
    """The questions a farmer's phone needs: hidden ones stay in the office."""
    return [field for field in load(form, db) if not field["hidden"]]


def _load(form: str, db: Session) -> list[dict]:
    defaults = {field["key"]: field for field in DEFAULTS[form]}
    row = db.get(FormSettings, form)
    saved = row.fields if row is not None and isinstance(row.fields, list) else []

    out, seen = [], set()
    for item in saved:
        key = item.get("key") if isinstance(item, dict) else None
        if key in seen:
            continue
        if key in defaults:
            base = defaults[key]
            field = {
                **base,
                "label": item.get("label") or base["label"],
                "hint": item.get("hint", base["hint"]),
                "required": bool(item.get("required")),
                "hidden": bool(item.get("hidden")),
            }
            if base["core"]:
                field.update(required=True, hidden=False)
            # The channel list is the office's to change.
            if key == "channel" and item.get("options"):
                field["options"] = list(item["options"])
        elif isinstance(key, str) and CUSTOM_KEY.fullmatch(key):
            field = {
                "key": key, "label": item.get("label") or "Untitled",
                "hint": item.get("hint", ""), "type": item.get("type", "text"),
                "options": list(item.get("options") or []),
                "required": bool(item.get("required")), "hidden": bool(item.get("hidden")),
                "builtin": False, "core": False,
            }
        else:
            continue
        out.append(field)
        seen.add(key)

    # A built-in question is never lost, even if it was missing from a save.
    for key, base in defaults.items():
        if key not in seen:
            out.append(dict(base))
    return out


def save(form: str, fields: list[schemas.FieldSpec], db: Session) -> list[dict]:
    if len(fields) > MAX_FIELDS:
        raise HTTPException(400, f"A form can have at most {MAX_FIELDS} questions.")
    defaults = {field["key"] for field in DEFAULTS[form]}
    keys = set()
    stored = []
    for field in fields:
        if field.key in keys:
            raise HTTPException(400, "Two questions have the same key.")
        keys.add(field.key)
        item = {"key": field.key, "label": field.label.strip(), "hint": field.hint.strip(),
                "required": field.required, "hidden": field.hidden}
        if field.key == "channel" and form == "farmer":
            channels = clean_options(field.options, MAX_CHANNELS)
            if not channels:
                raise HTTPException(400, "Keep at least one distribution channel.")
            item["options"] = channels
        if field.key not in defaults:
            if not CUSTOM_KEY.fullmatch(field.key):
                raise HTTPException(400, "A question has a key that is not allowed.")
            if not item["label"]:
                raise HTTPException(400, "Every new question needs a name.")
            if field.type not in CUSTOM_TYPES:
                raise HTTPException(400, f"“{item['label']}” has a type that is not allowed.")
            options = clean_options(field.options, 100)
            if field.type == "select" and not options:
                raise HTTPException(400, f"“{item['label']}” needs at least one choice.")
            item.update(type=field.type, options=options)
        stored.append(item)

    row = db.get(FormSettings, form)
    if row is None:
        db.add(FormSettings(form=form, fields=stored, updated_at=utc_now()))
    else:
        row.fields = stored
        row.updated_at = utc_now()
    db.commit()
    cache.changed("forms")
    return load(form, db)


def all_forms(db: Session) -> dict[str, list[dict]]:
    return {form: load(form, db) for form in FORMS}


def check_custom(field: dict, value: str) -> str:
    """Tidies one answer to a custom question, or refuses it."""
    value = (value or "").strip()[:1000]
    if value == "":
        return value
    label = field["label"]
    if field["type"] == "number":
        try:
            float(value)
        except ValueError:
            raise HTTPException(400, f"“{label}” must be a number.")
    elif field["type"] == "date":
        try:
            dt.date.fromisoformat(value)
        except ValueError:
            raise HTTPException(400, f"“{label}” must be a date.")
    elif field["type"] == "select" and value not in field["options"]:
        raise HTTPException(400, f"“{label}” must be one of its choices.")
    return value


def farmer_answers(extra: dict[str, str], db: Session) -> dict[str, str]:
    """Answers to custom questions on an entry from a farmer's phone.

    Never refused: the phone may have been filled in offline against an
    older form, and the entry must not be lost for that. So an answer to a
    question the office knows is kept only if it fits the question, and an
    answer to an unknown one only if it has a key the office could have
    made. Anything else is dropped, not stored."""
    fields = {field["key"]: field for field in load("farmer", db) if not field["builtin"]}
    kept = {}
    for key, value in extra.items():
        if key in fields:
            try:
                kept[key] = check_custom(fields[key], value)
            except HTTPException:
                continue
        elif CUSTOM_KEY.fullmatch(key):
            kept[key] = value.strip()[:1000]
    return kept


def check_lot(body: schemas.LotIn, db: Session) -> dict[str, str]:
    """Applies the office's required/optional settings to a seed lot and
    returns the cleaned answers to custom questions."""
    values = body.model_dump(by_alias=True)
    extra = {}
    for field in load("lot", db):
        if field["builtin"]:
            value = values.get(field["key"])
        else:
            value = check_custom(field, body.extra.get(field["key"], ""))
            if not field["hidden"]:
                extra[field["key"]] = value
        if field["required"] and not field["hidden"] and value in (None, ""):
            raise HTTPException(400, f"“{field['label']}” is required.")
    return extra
