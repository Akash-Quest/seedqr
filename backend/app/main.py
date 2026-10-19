import csv
import datetime as dt
import io
import json
import logging
import secrets
import socket
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import auth, cache, forms, limits, schemas, stats
from .config import BACKEND_DIR, settings
from .database import SessionLocal, get_db
from .models import FarmerEntry, SeedLot, User, seed_key, utc_now

# The tables are made and changed by `python -m app.migrate`, not here: several
# copies of the app start at once and must not all alter the database.

log = logging.getLogger("seedcode")

app = FastAPI(
    title="SeedCode",
    docs_url="/api/docs" if settings.docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.docs else None,
)
app.include_router(auth.router)
app.include_router(stats.router)


# The frontend reads every failure as {"error": "..."}.
@app.exception_handler(StarletteHTTPException)
async def http_error(_request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        {"error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None)
    )


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _exc: RequestValidationError):
    return JSONResponse(
        {"error": "Some details are missing or not valid."}, status_code=400
    )


@app.exception_handler(Exception)
async def server_error(request: Request, _exc: Exception):
    # The details go to the log, never to the browser.
    log.exception("Failed: %s %s", request.method, request.url.path)
    return JSONResponse(
        {"error": "Something went wrong on the server. Please try again."}, status_code=500
    )


# ---- Every response ------------------------------------------------------

# What the pages may load, and from where: only this site. Styles may be
# inline because React and the charts set them on elements.
CONTENT_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        # The Excel reader and writer unzip big files in a worker they make
        # from a blob: URL.
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

SAFE_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"same-origin"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"cross-origin-resource-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
]

WRITES = {"POST", "PUT", "PATCH", "DELETE"}


def touched(path: str) -> tuple[str, ...]:
    """The kinds of kept answers (see cache.py) a write to `path` changes."""
    if path.startswith("/api/forms"):
        return ("forms",)
    if path.startswith("/api/lots"):
        return ("lots",)
    if path.startswith("/api/entries/import"):
        return ("entries", "lots")
    if path.startswith("/api/entries/export"):
        return ()
    if path.startswith("/api/entries"):
        return ("entries",)
    return ()


class EveryResponse:
    """Adds the safety headers to every response, keeps API answers out of
    browser caches, and marks kept answers stale after every write. Also the
    last word on errors, so even a failure goes out with those headers."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        is_api = path.startswith("/api/")
        # The API pages, when switched on, load their own scripts.
        policy = not (settings.docs and path in ("/api/docs", "/api/openapi.json"))
        kinds = touched(path) if scope["method"] in WRITES else ()
        started = False

        async def with_headers(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                # The write is saved by now, and the browser has not yet been
                # told: whatever it asks next is worked out afresh. A refused
                # write changed nothing, so it keeps every answer.
                if kinds and message["status"] < 400:
                    cache.changed(*kinds)
                headers = MutableHeaders(scope=message)
                for name, value in SAFE_HEADERS:
                    headers.append(name.decode(), value.decode())
                if policy:
                    headers.append("content-security-policy", CONTENT_POLICY)
                if is_api:
                    headers["cache-control"] = "no-store"
            await send(message)

        async def reply(status: int, error: str) -> None:
            body = json.dumps({"error": error}).encode()
            await with_headers(
                {
                    "type": "http.response.start",
                    "status": status,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await with_headers({"type": "http.response.body", "body": body})

        # No one types the NUL character, and PostgreSQL cannot hold it.
        if "\x00" in path or b"%00" in scope.get("query_string", b"").lower():
            await reply(400, "Some details are missing or not valid.")
            return
        try:
            await self.app(scope, receive, with_headers)
        except Exception:
            # The details go to the log, never to the browser.
            log.exception("Failed: %s %s", scope["method"], path)
            if started:
                raise
            await reply(500, "Something went wrong on the server. Please try again.")


# The last one added runs first: every answer, even a refusal for size,
# gets the safety headers, and sizes are checked before any body is read.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(limits.BodyLimit)
app.add_middleware(EveryResponse)


# HEAD too: uptime monitors often ask with it.
@app.api_route("/api/health", methods=["GET", "HEAD"], response_model=schemas.Ok)
def health(db: Session = Depends(get_db)):
    """Public: asked by Docker and the load balancer. Fails if the database
    cannot be reached, so a broken copy of the app is taken out of use."""
    db.execute(text("SELECT 1"))
    return {}


@app.get(
    "/api/address",
    response_model=schemas.Address,
    dependencies=[Depends(auth.signed_in)],
)
def address():
    """This computer's address on the local network, so that a QR code made
    while the admin is on "localhost" still opens on a phone."""
    if settings.lan_address.strip():
        return {"lan": settings.lan_address.strip()}
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Asking which address would be used to reach the internet picks the
        # real network card. Nothing is actually sent.
        probe.connect(("8.8.8.8", 53))
        return {"lan": probe.getsockname()[0]}
    except OSError:
        return {"lan": None}
    finally:
        probe.close()


# ---- Seed lots -----------------------------------------------------------

# Letters and digits that are hard to confuse when read off a label.
ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_lot_id() -> str:
    return "".join(secrets.choice(ID_CHARS) for _ in range(8))


def json_reply(body: bytes) -> Response:
    return Response(body, media_type="application/json")


@app.get(
    "/api/lots",
    response_model=list[schemas.LotOut],
    dependencies=[Depends(auth.signed_in)],
)
def list_lots(db: Session = Depends(get_db)):
    """Every lot in use, with how many entries it has. Kept, already turned
    into JSON, until a lot or an entry changes."""
    return json_reply(cache.remember(("lots",), ("lots", "entries"), lambda: lots_json(db)))


def lots_json(db: Session) -> bytes:
    # Entries are counted per lot first, which the lot_id index answers
    # without reading the entries themselves, then matched to the lots.
    counts = (
        select(FarmerEntry.lot_id, func.count().label("entries"))
        .group_by(FarmerEntry.lot_id)
        .subquery()
    )
    rows = db.execute(
        select(SeedLot, func.coalesce(counts.c.entries, 0))
        .outerjoin(counts, counts.c.lot_id == SeedLot.id)
        .where(SeedLot.deleted_at.is_(None))
        .order_by(SeedLot.created_at.desc())
    ).all()
    lots = []
    for lot, count in rows:
        out = schemas.LotOut.model_validate(lot)
        out.entry_count = count
        lots.append(out)
    return schemas.LotList(lots).model_dump_json(by_alias=True).encode()


@app.post(
    "/api/lots",
    response_model=schemas.LotMade,
    dependencies=[Depends(auth.editor)],
)
def create_lot(body: schemas.LotIn, db: Session = Depends(get_db)):
    extra = forms.check_lot(body, db)
    # The same crop, variety and batch is the same seed lot, so it keeps the
    # QR code it already has: adding it again gives that lot back, unchanged.
    # A deleted lot does not count, since deleting is how a code is retired.
    same = db.scalar(
        select(SeedLot)
        .where(
            SeedLot.seed_key == seed_key(body.crop, body.variety, body.batch_no),
            SeedLot.deleted_at.is_(None),
        )
        .order_by(SeedLot.created_at)
        .limit(1)
    )
    if same is not None:
        return {**schemas.LotOut.model_validate(same).model_dump(), "existing": True}
    lot = SeedLot(
        id=new_lot_id(),
        **body.model_dump(exclude={"extra"}),
        extra=extra,
    )
    db.add(lot)
    db.commit()
    return lot


def live_lot(lot_id: str, db: Session) -> SeedLot:
    lot = db.get(SeedLot, lot_id)
    if lot is None or lot.deleted_at is not None:
        raise HTTPException(404, "This code is not recognised.")
    return lot


@app.put(
    "/api/lots/{lot_id}",
    response_model=schemas.LotOut,
    dependencies=[Depends(auth.editor)],
)
def update_lot(lot_id: str, body: schemas.LotIn, db: Session = Depends(get_db)):
    """Changes the details behind an existing QR code. The code itself only
    holds the lot's ID, so labels already printed keep working."""
    lot = live_lot(lot_id, db)
    extra = forms.check_lot(body, db)
    for name, value in body.model_dump(exclude={"extra"}).items():
        setattr(lot, name, value)
    # Answers to questions now hidden are kept, not wiped.
    lot.extra = {**(lot.extra or {}), **extra}
    lot.updated_at = utc_now()
    db.commit()
    return lot


@app.delete(
    "/api/lots/{lot_id}",
    response_model=schemas.Ok,
    dependencies=[Depends(auth.editor)],
)
def delete_lot(lot_id: str, db: Session = Depends(get_db)):
    """Takes a lot out of use: it leaves the lists and its QR code stops
    opening the form. Farmer entries already received are kept."""
    lot = live_lot(lot_id, db)
    lot.deleted_at = utc_now()
    db.commit()
    return {}


def slow_down(limiter: limits.Limiter, request: Request) -> None:
    wait = limiter.take(limits.client_address(request))
    if wait:
        raise limits.too_many(wait)


@app.get("/api/lots/{lot_id}", response_model=schemas.PublicLot)
def get_lot(lot_id: str, request: Request, db: Session = Depends(get_db)):
    """Public: this is what a farmer's phone loads after scanning. The forms
    come with it, so the phone can show the right questions offline. Only
    what the farmer is meant to see: hidden questions and their answers
    stay in the office."""
    slow_down(limits.lots_by_address, request)
    lot_fields = forms.public("lot", db)
    lot = schemas.LotOut.model_validate(live_lot(lot_id, db)).model_dump(by_alias=True)
    shown = {field["key"] for field in lot_fields}
    for field in forms.load("lot", db):
        if field["builtin"] and field["key"] not in shown:
            lot[field["key"]] = None if field["key"] == "expiryDate" else ""
    lot["extra"] = {key: value for key, value in lot["extra"].items() if key in shown}
    return schemas.PublicLot.model_validate(
        {**lot, "lotFields": lot_fields, "farmerFields": forms.public("farmer", db)}
    )


# ---- Form questions ------------------------------------------------------


@app.get(
    "/api/forms",
    response_model=dict[str, list[schemas.FieldSpec]],
    dependencies=[Depends(auth.signed_in)],
)
def get_forms(db: Session = Depends(get_db)):
    return forms.all_forms(db)


@app.put(
    "/api/forms/{form}",
    response_model=list[schemas.FieldSpec],
    dependencies=[Depends(auth.admin)],
)
def save_form(form: str, body: list[schemas.FieldSpec], db: Session = Depends(get_db)):
    if form not in forms.FORMS:
        raise HTTPException(404, "Not found.")
    return forms.save(form, body, db)


# ---- Farmer entries ------------------------------------------------------


@app.post("/api/entries", response_model=schemas.Ok)
def save_entry(body: schemas.EntryIn, request: Request, db: Session = Depends(get_db)):
    """Public: sent from the farmer's phone."""
    slow_down(limits.entries_by_address, request)
    # A deleted lot is still accepted here: the farmer may have filled the
    # form before it was deleted and only now got a signal.
    lot = db.get(SeedLot, body.lot_id)
    if lot is None:
        raise HTTPException(404, "This code is not recognised.")

    db.add(
        FarmerEntry(
            **body.model_dump(exclude={"extra"}),
            extra=forms.farmer_answers(body.extra, db),
            ip_address=limits.client_address(request),
            lot_snapshot=schemas.LotOut.model_validate(lot).model_dump(mode="json"),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Already stored: the phone sent it again after a lost connection.
        db.rollback()
    return {}


MAX_IMPORT = 5000


@app.post(
    "/api/entries/import",
    response_model=schemas.Imported,
    dependencies=[Depends(auth.editor)],
)
def import_entries(body: list[schemas.ImportRow], db: Session = Depends(get_db)):
    """Entries the office uploads from an Excel file. The Users page reads
    the file and sends its rows here, up to MAX_IMPORT at a time. Either
    every row of a call is saved or none.

    A row names its seed lot by QR code, or carries the seed details: then
    the lot with that crop, variety and batch is used, and made if there is
    none. A row whose ID is already stored is left alone, so sending the
    same rows again adds nothing."""
    if len(body) > MAX_IMPORT:
        raise HTTPException(400, f"At most {MAX_IMPORT} rows can be sent at once.")
    snapshots: dict[str, dict] = {}
    lots_made = 0

    def remember(lot: SeedLot) -> str:
        snapshots[lot.id] = schemas.LotOut.model_validate(lot).model_dump(mode="json")
        return lot.id

    # The live lots for the seeds these rows describe, found in one lookup
    # by their keys rather than by reading every lot.
    wanted = {
        seed_key(row.seed.crop, row.seed.variety, row.seed.batch_no)
        for row in body
        if not row.lot_id and row.seed is not None
    }
    by_seed: dict[str, str] = {}
    if wanted:
        for lot in db.scalars(
            select(SeedLot)
            .where(SeedLot.seed_key.in_(wanted), SeedLot.deleted_at.is_(None))
            .order_by(SeedLot.created_at)
        ):
            by_seed[lot.seed_key] = remember(lot)

    def lot_for(number: int, row: schemas.ImportRow) -> str:
        nonlocal lots_made
        if row.lot_id:
            if row.lot_id not in snapshots:
                lot = db.get(SeedLot, row.lot_id)
                if lot is None or lot.deleted_at is not None:
                    raise HTTPException(
                        400, f"Row {number}: QR code “{row.lot_id}” is not recognised."
                    )
                remember(lot)
            return row.lot_id
        seed = row.seed
        if seed is None:
            raise HTTPException(400, f"Row {number}: there is no QR code and no seed details.")
        key = seed_key(seed.crop, seed.variety, seed.batch_no)
        if key not in by_seed:
            lot = SeedLot(
                id=new_lot_id(),
                **seed.model_dump(exclude={"date"}),
                date=seed.date or (row.received_at or utc_now()).date(),
                extra={},
            )
            db.add(lot)
            db.flush()
            by_seed[key] = remember(lot)
            lots_made += 1
        return by_seed[key]

    stored = set(
        db.scalars(select(FarmerEntry.id).where(FarmerEntry.id.in_({row.id for row in body})))
    )
    seen = set()
    for number, row in enumerate(body, start=1):
        lot_id = lot_for(number, row)
        if row.id in seen or row.id in stored:
            continue
        seen.add(row.id)
        entry = FarmerEntry(
            **row.model_dump(exclude={"lot_id", "seed", "received_at"}),
            lot_id=lot_id,
            ip_address="",
            lot_snapshot=snapshots[lot_id],
        )
        if row.received_at is not None:
            entry.received_at = row.received_at
        db.add(entry)
    db.commit()
    return {"count": len(seen), "lots_made": lots_made}


def matching(q: str, start: dt.datetime | None, end: dt.datetime | None, db: Session) -> list:
    """The conditions for a search and a range of received times.

    The search looks through the farmer's name, phone and channel, and the
    seed lot's crop and batch. The few lots that match are found first, so
    every condition is on the entries themselves: on PostgreSQL each one can
    then use its own index (see migration 0004) instead of reading every
    entry."""
    wanted = []
    if start:
        wanted.append(FarmerEntry.received_at >= stats.naive_utc(start))
    if end:
        wanted.append(FarmerEntry.received_at < stats.naive_utc(end))
    needle = " ".join(schemas.no_nul(q).split())[:100]
    if needle:
        for mark in "\\%_":
            needle = needle.replace(mark, "\\" + mark)

        def like(column):
            return column.ilike(f"%{needle}%", escape="\\")

        lot_ids = db.scalars(
            select(SeedLot.id).where(or_(like(SeedLot.crop), like(SeedLot.batch_no)))
        ).all()
        found = [like(FarmerEntry.farmer_name), like(FarmerEntry.contact), like(FarmerEntry.channel)]
        if lot_ids:
            found.append(FarmerEntry.lot_id.in_(lot_ids))
        wanted.append(or_(*found))
    return wanted


def entries_newest_first(wanted: list):
    return (
        select(FarmerEntry)
        .join(FarmerEntry.lot)
        .options(contains_eager(FarmerEntry.lot))
        .where(*wanted)
        # The same order as ix_farmer_entries_received_at_id, read backwards.
        .order_by(FarmerEntry.received_at.desc(), FarmerEntry.id.desc())
    )


def entry_out(entry: FarmerEntry) -> schemas.EntryOut:
    item = schemas.EntryOut.model_validate(entry)
    # Show the seed details the farmer saw, not a later edit of the lot.
    if entry.lot_snapshot:
        item.lot = schemas.LotOut.model_validate(entry.lot_snapshot)
    return item


@app.get("/api/entries", response_model=schemas.EntryPage)
def list_entries(
    page: int = Query(default=1, ge=1, le=100_000),
    size: int = Query(default=50, ge=1, le=1000),
    q: str = Query(default="", max_length=200),
    start: dt.datetime | None = Query(default=None, alias="from"),
    end: dt.datetime | None = Query(default=None, alias="to"),
    user: User = Depends(auth.signed_in),
    db: Session = Depends(get_db),
):
    """One page of entries, newest first. `from` and `to` are times: from
    is included, to is not."""
    wanted = matching(q, start, end, db)
    # Counting every match is the slow part of a page, and turning pages
    # does not change it, so the count is kept until the entries change.
    # The conditions are worked out again inside, so the count always
    # matches the lots as they were when it was kept.
    total = cache.remember(
        ("count", " ".join(q.split()).lower(), start and start.isoformat(), end and end.isoformat()),
        ("entries", "lots"),
        lambda: db.scalar(
            select(func.count()).select_from(FarmerEntry).where(*matching(q, start, end, db))
        ),
    )
    rows = db.scalars(
        entries_newest_first(wanted).limit(size).offset((page - 1) * size)
    ).all()
    items = [entry_out(entry) for entry in rows]
    if user.role == "viewer":
        # A viewer never receives a full ID number, only its last digits.
        for item in items:
            if len(item.id_number) > 4:
                item.id_number = "••••" + item.id_number[-4:]
    return {"items": items, "total": total}


@app.put("/api/entries/{entry_id}", response_model=schemas.EntryOut)
def update_entry(
    entry_id: str,
    body: schemas.EntryChange,
    user: User = Depends(auth.editor),
    db: Session = Depends(get_db),
):
    """Corrects what was written on an entry, and records who did it."""
    entry = db.get(FarmerEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "This entry is no longer there.")
    extra = {
        field["key"]: forms.check_custom(field, body.extra[field["key"]])
        for field in forms.load("farmer", db)
        if not field["builtin"] and field["key"] in body.extra
    }
    for name, value in body.model_dump(exclude={"extra"}).items():
        setattr(entry, name, value)
    # Answers to questions now hidden or removed are kept, not wiped.
    entry.extra = {**(entry.extra or {}), **extra}
    entry.updated_at = utc_now()
    entry.updated_by = user.username
    db.commit()
    return entry_out(entry)


@app.delete(
    "/api/entries/{entry_id}",
    response_model=schemas.Ok,
    dependencies=[Depends(auth.editor)],
)
def delete_entry(entry_id: str, db: Session = Depends(get_db)):
    """Removes an entry for good, for one made by mistake or sent twice.
    Unlike a seed lot, nothing of it is kept."""
    entry = db.get(FarmerEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "This entry is no longer there.")
    db.delete(entry)
    db.commit()
    return {}


def spreadsheet_safe(value) -> str:
    """A farmer could type a formula as an answer. A leading apostrophe makes
    Excel show it as plain text instead of running it."""
    value = "" if value is None else str(value)
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def export_columns(db: Session) -> list[tuple[str, object]]:
    """The spreadsheet's columns: a title, and how to read the cell from an
    entry and the seed details the farmer saw (a plain dict, see
    seed_details below)."""

    def custom(form: str):
        return [field for field in forms.load(form, db) if not field["builtin"]]

    def answer(key: str):
        return lambda e, _seed: (e.extra or {}).get(key, "")

    def seed_answer(key: str):
        return lambda _e, seed: (seed.get("extra") or {}).get(key, "")

    def seed(name: str):
        return lambda _e, seed: seed.get(name, "")

    return [
        ("Received", lambda e, _s: schemas.utc_iso(e.received_at)),
        ("Filled in", lambda e, _s: e.filled_at),
        ("Date", lambda e, _s: e.date),
        ("Filled by", lambda e, _s: e.filled_by),
        ("Farmer name", lambda e, _s: e.farmer_name),
        ("Document type", lambda e, _s: (e.kyc_other or "Other") if e.kyc_type == "Other" else e.kyc_type),
        ("ID number", lambda e, _s: e.id_number),
        ("Contact number", lambda e, _s: e.contact),
        ("Distribution channel", lambda e, _s: e.channel),
        ("Landholding size", lambda e, _s: e.landholding),
        ("Quantity of seed given", lambda e, _s: e.quantity),
        *((field["label"], answer(field["key"])) for field in custom("farmer")),
        ("Crop", seed("crop")),
        ("Variety", seed("variety")),
        ("Seed type", seed("seed_type")),
        ("Batch/lot number", seed("batch_no")),
        *((f"Seed: {field['label']}", seed_answer(field["key"])) for field in custom("lot")),
        ("QR code", lambda e, _s: e.lot_id),
        ("Device fingerprint", lambda e, _s: e.fingerprint),
        ("Device ID", lambda e, _s: e.device_id),
        ("Network address", lambda e, _s: e.ip_address),
        ("Device details", lambda e, _s: "; ".join(f"{k}: {v}" for k, v in (e.device or {}).items())),
        ("User agent", lambda e, _s: e.user_agent),
    ]


# Rows are sent in pieces of about this size rather than one by one.
EXPORT_CHUNK = 64 * 1024


@app.post("/api/entries/export")
def export_entries(
    token: str = Form(default=""),
    q: str = Form(default="", max_length=200),
    start: dt.datetime | None = Form(default=None, alias="from"),
    end: dt.datetime | None = Form(default=None, alias="to"),
    db: Session = Depends(get_db),
):
    """Every entry that matches, as a CSV file for Excel. Sent by a plain
    form on the Users page so the browser saves it straight to disk, which
    is why the token comes in the form and not in a header."""
    if auth.user_for_token(token, db).role not in ("admin", "editor"):
        raise HTTPException(403, "Your account is not allowed to do this.")
    columns = export_columns(db)
    query = entries_newest_first(matching(q, start, end, db)).execution_options(yield_per=500)

    def lines():
        buffer = io.StringIO()
        writer = csv.writer(buffer)

        def taken() -> str:
            text_so_far = buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
            return text_so_far

        # The mark at the start tells Excel the file is UTF-8. Titles come
        # from the office's own questions, so they are made safe too.
        writer.writerow([spreadsheet_safe(title) for title, _ in columns])
        yield "﻿" + taken()
        # Seed details for entries saved before snapshots existed, by lot.
        current: dict[str, dict] = {}
        # Its own session: the request's one may be closed while this runs.
        with SessionLocal() as session:
            for entry in session.scalars(query):
                seed = entry.lot_snapshot
                if not seed:
                    if entry.lot_id not in current:
                        current[entry.lot_id] = (
                            schemas.LotOut.model_validate(entry.lot).model_dump(mode="json")
                            if entry.lot
                            else {}
                        )
                    seed = current[entry.lot_id]
                writer.writerow([spreadsheet_safe(read(entry, seed)) for _, read in columns])
                if buffer.tell() >= EXPORT_CHUNK:
                    yield taken()
        yield taken()

    name = f"farmer-entries-{utc_now():%Y-%m-%d}.csv"
    return StreamingResponse(
        lines(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ---- The built frontend --------------------------------------------------
# In development Vite serves the pages. After `npm run build`, this backend
# serves them too, so one process runs the whole site.

DIST = BACKEND_DIR.parent / "frontend" / "dist"

if DIST.is_dir():

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found.")
        file = (DIST / path).resolve()
        if path and file.is_file() and DIST in file.parents:
            # Built files have a hash in their name, so they never change.
            cache_control = (
                "public, max-age=31536000, immutable"
                if path.startswith("assets/")
                else "no-cache"
            )
            return FileResponse(file, headers={"Cache-Control": cache_control})
        if Path(path).suffix:
            raise HTTPException(404, "Not found.")
        # Anything that is not a file is a page inside the app.
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
