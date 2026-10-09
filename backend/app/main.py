import hmac
import secrets
import socket
import time
from datetime import timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import forms, schemas
from .config import BACKEND_DIR, settings
from .database import Base, engine, get_db
from .models import AdminSession, FarmerEntry, SeedLot, utc_now

Base.metadata.create_all(engine)


def add_missing_columns() -> None:
    """create_all() never changes a table that already exists, so columns
    added to FarmerEntry later are added to the database here."""
    wanted = {
        "farmer_entries": {
            "device": "JSON", "ip_address": "VARCHAR(64)", "lot_snapshot": "JSON", "extra": "JSON",
            "date": "VARCHAR(20) DEFAULT ''",
        },
        "seed_lots": {"updated_at": "DATETIME", "deleted_at": "DATETIME", "extra": "JSON"},
    }
    with engine.begin() as connection:
        for table, columns in wanted.items():
            existing = {column["name"] for column in inspect(engine).get_columns(table)}
            for name, kind in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {kind}"))


add_missing_columns()

app = FastAPI(title="SeedCode", docs_url="/api/docs", openapi_url="/api/openapi.json")


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
async def never_cache_api(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def bearer(authorization: str) -> str:
    return authorization.removeprefix("Bearer ").strip()


def require_admin(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> None:
    session = db.get(AdminSession, bearer(authorization))
    if session is None or session.expires_at < utc_now():
        raise HTTPException(401, "Please sign in again.")


# ---- Sign-in -------------------------------------------------------------


@app.post("/api/login", response_model=schemas.Token)
def login(body: schemas.Login, db: Session = Depends(get_db)):
    # Both are always compared, so the reply does not reveal which was wrong.
    name_ok = hmac.compare_digest(
        body.username.lower().encode(), settings.admin_username.strip().lower().encode()
    )
    password_ok = hmac.compare_digest(
        body.password.encode(), settings.admin_password.encode()
    )
    if not (name_ok and password_ok):
        time.sleep(0.6)  # slow down guessing
        raise HTTPException(403, "That username or password is not correct.")

    db.execute(delete(AdminSession).where(AdminSession.expires_at < utc_now()))
    token = secrets.token_hex(32)
    db.add(
        AdminSession(
            token=token,
            expires_at=utc_now() + timedelta(hours=settings.session_hours),
        )
    )
    db.commit()
    return {"token": token, "username": settings.admin_username.strip()}


@app.post("/api/logout", response_model=schemas.Ok)
def logout(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    db.execute(delete(AdminSession).where(AdminSession.token == bearer(authorization)))
    db.commit()
    return {}


@app.get(
    "/api/address",
    response_model=schemas.Address,
    dependencies=[Depends(require_admin)],
)
def address():
    """This computer's address on the local network, so that a QR code made
    while the admin is on "localhost" still opens on a phone."""
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


@app.get(
    "/api/lots",
    response_model=list[schemas.LotOut],
    dependencies=[Depends(require_admin)],
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
    response_model=schemas.LotOut,
    dependencies=[Depends(require_admin)],
)
def create_lot(body: schemas.LotIn, db: Session = Depends(get_db)):
    extra = forms.check_lot(body, db)
    lot = SeedLot(
        id="".join(secrets.choice(ID_CHARS) for _ in range(8)),
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
    dependencies=[Depends(require_admin)],
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
    dependencies=[Depends(require_admin)],
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
    dependencies=[Depends(require_admin)],
)
def get_forms(db: Session = Depends(get_db)):
    return forms.all_forms(db)


@app.put(
    "/api/forms/{form}",
    response_model=list[schemas.FieldSpec],
    dependencies=[Depends(require_admin)],
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


@app.post(
    "/api/entries/import",
    response_model=schemas.Imported,
    dependencies=[Depends(require_admin)],
)
def import_entries(body: list[schemas.EntryIn], db: Session = Depends(get_db)):
    """Entries the office uploads from an Excel file. The Users page reads
    the file and sends its rows here. Either every row is saved or none."""
    if len(body) > MAX_IMPORT:
        raise HTTPException(400, f"A file can have at most {MAX_IMPORT} rows.")
    snapshots: dict[str, dict] = {}
    seen = set()
    for number, row in enumerate(body, start=1):
        if row.lot_id not in snapshots:
            lot = db.get(SeedLot, row.lot_id)
            if lot is None or lot.deleted_at is not None:
                raise HTTPException(
                    400, f"Row {number}: QR code “{row.lot_id}” is not recognised."
                )
            snapshots[row.lot_id] = schemas.LotOut.model_validate(lot).model_dump(mode="json")
        if row.id in seen or db.get(FarmerEntry, row.id) is not None:
            continue
        seen.add(row.id)
        db.add(
            FarmerEntry(**row.model_dump(), ip_address="", lot_snapshot=snapshots[row.lot_id])
        )
    db.commit()
    return {"count": len(seen)}


@app.get(
    "/api/entries",
    response_model=list[schemas.EntryOut],
    dependencies=[Depends(require_admin)],
)
def list_entries(db: Session = Depends(get_db)):
    entries = db.scalars(
        select(FarmerEntry).order_by(FarmerEntry.received_at.desc())
    ).all()
    out = []
    for entry in entries:
        item = schemas.EntryOut.model_validate(entry)
        # Show the seed details the farmer saw, not a later edit of the lot.
        if entry.lot_snapshot:
            item.lot = schemas.LotOut.model_validate(entry.lot_snapshot)
        out.append(item)
    return out


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
