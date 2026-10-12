import csv
import datetime as dt
import io
import secrets
import socket
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import auth, forms, schemas, stats
from .config import BACKEND_DIR, settings
from .database import SessionLocal, get_db
from .models import FarmerEntry, SeedLot, User, utc_now

# The tables are made and changed by `python -m app.migrate`, not here: several
# copies of the app start at once and must not all alter the database.

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
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _exc: RequestValidationError):
    return JSONResponse(
        {"error": "Some details are missing or not valid."}, status_code=400
    )


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.get("/api/health", response_model=schemas.Ok)
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


@app.get(
    "/api/lots",
    response_model=list[schemas.LotOut],
    dependencies=[Depends(auth.signed_in)],
)
def list_lots(db: Session = Depends(get_db)):
    rows = db.execute(
        select(SeedLot, func.count(FarmerEntry.id))
        .outerjoin(FarmerEntry, FarmerEntry.lot_id == SeedLot.id)
        .where(SeedLot.deleted_at.is_(None))
        .group_by(SeedLot.id)
        .order_by(SeedLot.created_at.desc())
    ).all()
    lots = []
    for lot, count in rows:
        out = schemas.LotOut.model_validate(lot)
        out.entry_count = count
        lots.append(out)
    return lots


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
    wanted = same_seed(body.crop, body.variety, body.batch_no)
    for lot in db.scalars(
        select(SeedLot).where(SeedLot.deleted_at.is_(None)).order_by(SeedLot.created_at)
    ):
        if same_seed(lot.crop, lot.variety, lot.batch_no) == wanted:
            return {**schemas.LotOut.model_validate(lot).model_dump(), "existing": True}
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


@app.get("/api/lots/{lot_id}", response_model=schemas.PublicLot)
def get_lot(lot_id: str, db: Session = Depends(get_db)):
    """Public: this is what a farmer's phone loads after scanning. The forms
    come with it, so the phone can show the right questions offline."""
    lot = schemas.LotOut.model_validate(live_lot(lot_id, db)).model_dump()
    return schemas.PublicLot.model_validate(
        {**lot, "lot_fields": forms.load("lot", db), "farmer_fields": forms.load("farmer", db)}
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


def client_address(request: Request) -> str:
    # Behind the Vite dev server or a reverse proxy, the phone's address
    # arrives in this header. It can be faked, so treat it as a hint.
    forwarded = request.headers.get("x-forwarded-for", "")
    address = forwarded.split(",")[0].strip() or (request.client.host if request.client else "")
    return address[:64]


@app.post("/api/entries", response_model=schemas.Ok)
def save_entry(body: schemas.EntryIn, request: Request, db: Session = Depends(get_db)):
    """Public: sent from the farmer's phone."""
    # A deleted lot is still accepted here: the farmer may have filled the
    # form before it was deleted and only now got a signal.
    lot = db.get(SeedLot, body.lot_id)
    if lot is None:
        raise HTTPException(404, "This code is not recognised.")

    # The phone may send the same entry twice after a lost connection.
    if db.get(FarmerEntry, body.id) is None:
        db.add(
            FarmerEntry(
                **body.model_dump(),
                ip_address=client_address(request),
                lot_snapshot=schemas.LotOut.model_validate(lot).model_dump(mode="json"),
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # the other copy arrived at the same moment
    return {}


MAX_IMPORT = 5000


def same_seed(crop: str, variety: str, batch_no: str) -> tuple:
    """Two rows are the same seed when these match, whatever the capitals
    and spacing."""
    return tuple(" ".join(part.split()).lower() for part in (crop, variety, batch_no))


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
    # Live lots by crop, variety and batch. Filled when first needed.
    by_seed: dict[tuple, str] | None = None
    lots_made = 0

    def remember(lot: SeedLot) -> str:
        snapshots[lot.id] = schemas.LotOut.model_validate(lot).model_dump(mode="json")
        return lot.id

    def lot_for(number: int, row: schemas.ImportRow) -> str:
        nonlocal by_seed, lots_made
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
        if by_seed is None:
            live = db.scalars(
                select(SeedLot).where(SeedLot.deleted_at.is_(None)).order_by(SeedLot.created_at)
            )
            by_seed = {same_seed(lot.crop, lot.variety, lot.batch_no): remember(lot) for lot in live}
        key = same_seed(seed.crop, seed.variety, seed.batch_no)
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


# What the search box on the Users page looks through.
SEARCHED = (
    FarmerEntry.farmer_name,
    FarmerEntry.contact,
    FarmerEntry.channel,
    SeedLot.crop,
    SeedLot.batch_no,
)


def matching(q: str, start: dt.datetime | None, end: dt.datetime | None) -> list:
    """The conditions for a search and a range of received times."""
    wanted = []
    if start:
        wanted.append(FarmerEntry.received_at >= stats.naive_utc(start))
    if end:
        wanted.append(FarmerEntry.received_at < stats.naive_utc(end))
    needle = " ".join(q.split())[:100]
    if needle:
        for mark in "\\%_":
            needle = needle.replace(mark, "\\" + mark)
        wanted.append(or_(*(column.ilike(f"%{needle}%", escape="\\") for column in SEARCHED)))
    return wanted


def entries_newest_first(wanted: list):
    return (
        select(FarmerEntry)
        .join(FarmerEntry.lot)
        .options(contains_eager(FarmerEntry.lot))
        .where(*wanted)
        .order_by(FarmerEntry.received_at.desc(), FarmerEntry.id)
    )


def entry_out(entry: FarmerEntry) -> schemas.EntryOut:
    item = schemas.EntryOut.model_validate(entry)
    # Show the seed details the farmer saw, not a later edit of the lot.
    if entry.lot_snapshot:
        item.lot = schemas.LotOut.model_validate(entry.lot_snapshot)
    return item


@app.get("/api/entries", response_model=schemas.EntryPage)
def list_entries(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=1000),
    q: str = "",
    start: dt.datetime | None = Query(default=None, alias="from"),
    end: dt.datetime | None = Query(default=None, alias="to"),
    user: User = Depends(auth.signed_in),
    db: Session = Depends(get_db),
):
    """One page of entries, newest first. `from` and `to` are times: from
    is included, to is not."""
    wanted = matching(q, start, end)
    total = db.scalar(
        select(func.count()).select_from(FarmerEntry).join(FarmerEntry.lot).where(*wanted)
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
    """The spreadsheet's columns: a title and how to read it from an entry."""

    def custom(form: str):
        return [field for field in forms.load(form, db) if not field["builtin"]]

    def answer(key: str):
        return lambda e: (e.extra or {}).get(key, "")

    def seed_answer(key: str):
        return lambda e: e.lot.extra.get(key, "") if e.lot else ""

    def seed(name: str):
        return lambda e: getattr(e.lot, name) if e.lot else ""

    return [
        ("Received", lambda e: schemas.utc_iso(e.received_at)),
        ("Filled in", lambda e: e.filled_at),
        ("Date", lambda e: e.date),
        ("Filled by", lambda e: e.filled_by),
        ("Farmer name", lambda e: e.farmer_name),
        ("Document type", lambda e: (e.kyc_other or "Other") if e.kyc_type == "Other" else e.kyc_type),
        ("ID number", lambda e: e.id_number),
        ("Contact number", lambda e: e.contact),
        ("Distribution channel", lambda e: e.channel),
        ("Landholding size", lambda e: e.landholding),
        ("Quantity of seed given", lambda e: e.quantity),
        *((field["label"], answer(field["key"])) for field in custom("farmer")),
        ("Crop", seed("crop")),
        ("Variety", seed("variety")),
        ("Seed type", seed("seed_type")),
        ("Batch/lot number", seed("batch_no")),
        *((f"Seed: {field['label']}", seed_answer(field["key"])) for field in custom("lot")),
        ("QR code", lambda e: e.lot_id),
        ("Device fingerprint", lambda e: e.fingerprint),
        ("Device ID", lambda e: e.device_id),
        ("Network address", lambda e: e.ip_address),
        ("Device details", lambda e: "; ".join(f"{k}: {v}" for k, v in e.device.items())),
        ("User agent", lambda e: e.user_agent),
    ]


@app.post("/api/entries/export")
def export_entries(
    token: str = Form(default=""),
    q: str = Form(default=""),
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
    query = entries_newest_first(matching(q, start, end)).execution_options(yield_per=500)

    def lines():
        buffer = io.StringIO()
        writer = csv.writer(buffer)

        def line(cells) -> str:
            writer.writerow(cells)
            text_line = buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
            return text_line

        # The mark at the start tells Excel the file is UTF-8.
        yield "\ufeff" + line([title for title, _ in columns])
        # Its own session: the request's one may be closed while this runs.
        with SessionLocal() as session:
            for entry in session.scalars(query):
                item = entry_out(entry)
                yield line([spreadsheet_safe(read(item)) for _, read in columns])

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

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found.")
        file = (DIST / path).resolve()
        if path and file.is_file() and DIST in file.parents:
            cache = (
                "public, max-age=31536000, immutable"
                if path.startswith("assets/")
                else "no-cache"
            )
            return FileResponse(file, headers={"Cache-Control": cache})
        if Path(path).suffix:
            raise HTTPException(404, "Not found.")
        # Anything that is not a file is a page inside the app.
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
