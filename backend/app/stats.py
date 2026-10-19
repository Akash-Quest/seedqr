"""The numbers behind the dashboard, counted by the database so the browser
never has to load every entry.

An entry's crop is its seed lot's crop as it is now. (The entries list shows
the crop as it was when the farmer submitted; for charts the difference only
shows if a lot's crop is retyped later.)

Everything the dashboard shows comes in one answer, kept (see cache.py)
until an entry or a lot changes, so a dashboard left open and refreshing
itself costs the database almost nothing.
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import Integer, and_, case, cast, exists, extract, func, literal_column, select, text
from sqlalchemy.orm import Session

from . import cache, schemas
from .auth import signed_in
from .database import engine, get_db
from .models import FarmerEntry, SeedLot

router = APIRouter(prefix="/api")

DAY = 86_400
TOP_CHANNELS = 5
# A year of days is the widest chart asked for; anything longer uses wider
# columns (see the dashboard's "All time").
MOST_COLUMNS = 400
LATEST = 6
WAITING = 5


def naive_utc(value: dt.datetime) -> dt.datetime:
    """Times are stored in UTC without a timezone (see models.utc_now).
    A time far outside any real entry is refused rather than allowed to
    break the date arithmetic."""
    if not schemas.EARLIEST_YEAR <= value.year <= schemas.LATEST_YEAR:
        raise HTTPException(400, "That date is not one the app can use.")
    if value.tzinfo is not None:
        value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return value


def bucket(start: dt.datetime, seconds: int):
    """Which column an entry falls in: 0 for the first `seconds` after
    `start`, 1 for the next, and so on."""
    name = engine.dialect.name
    if name == "sqlite":
        return (
            cast(func.strftime("%s", FarmerEntry.received_at), Integer)
            - int(start.replace(tzinfo=dt.timezone.utc).timestamp())
        ) // seconds
    if name == "postgresql":
        elapsed = extract("epoch", FarmerEntry.received_at - start)
    else:  # MySQL
        elapsed = func.timestampdiff(text("SECOND"), start, FarmerEntry.received_at)
    return cast(func.floor(elapsed / seconds), Integer)


def weekday_and_hour(offset: int):
    """The day of the week (0 is Sunday) and the hour an entry came in, on
    the office's clock, `offset` minutes ahead of UTC. The offset is a
    checked whole number, so writing it into the SQL is safe; that keeps the
    expressions free of parameters, which GROUP BY needs to match them."""
    moment = FarmerEntry.received_at
    name = engine.dialect.name
    if name == "sqlite":
        shift = literal_column(f"'{offset:+d} minutes'")
        return (
            cast(func.strftime("%w", moment, shift), Integer),
            cast(func.strftime("%H", moment, shift), Integer),
        )
    if name == "postgresql":
        local = moment + literal_column(f"interval '{offset:d} minutes'")
        return cast(extract("dow", local), Integer), cast(extract("hour", local), Integer)
    local = func.date_add(moment, literal_column(f"INTERVAL {offset:d} MINUTE"))
    return func.dayofweek(local) - 1, func.hour(local)


def crop_key(crop: str | None) -> str:
    return (crop or "").strip().lower()


@router.get("/stats", response_model=schemas.Stats, dependencies=[Depends(signed_in)])
def stats(
    start: dt.datetime,
    days: int = Query(ge=1, le=36_600),
    size: int = Query(default=1, ge=1, le=366),
    by: str = Query(default="auto", pattern="^(auto|crop|variety)$"),
    tz: int = Query(default=0, ge=-14 * 60, le=14 * 60),
    db: Session = Depends(get_db),
):
    """Entry counts for `days` days from `start`, in columns of `size` days.
    `start` is midnight where the office is, which the browser knows, and
    `tz` is how many minutes the office's clock is ahead of UTC.

    The counts are split `by` crop or by variety. Left to "auto" it is by
    crop, unless every entry is of one crop: then a split by crop would say
    nothing, and it is by variety."""
    if days / size > MOST_COLUMNS:
        raise HTTPException(400, "That is too many columns for one chart.")
    start = naive_utc(start)
    key = ("stats", start.isoformat(), days, size, by, tz)
    return Response(
        cache.remember(
            key, ("entries", "lots"), lambda: numbers(db, start, days, size, by, tz)
        ),
        media_type="application/json",
    )


def lot_seeds(db: Session) -> dict[str, tuple[str, str]]:
    """Every lot's crop and variety by its ID, deleted lots too, since their
    entries still count. seen() counts per lot, a short key the database
    groups quickly without reading the lots table, and turns lots into
    crops here. Kept until a lot changes."""
    return cache.remember(
        ("lot-seeds",),
        ("lots",),
        lambda: {
            lot_id: (crop, variety)
            for lot_id, crop, variety in db.execute(select(SeedLot.id, SeedLot.crop, SeedLot.variety))
        },
    )


def seen(db: Session, by: str) -> list:
    """Each crop (or variety) with its first and last entry, in the order
    they first appeared over all time, so a crop keeps its place (and its
    colour) whatever period is shown. Reads every entry, so it is kept
    until the entries change, whichever period is asked for."""
    part = 1 if by == "variety" else 0

    def make() -> list:
        seeds = lot_seeds(db)
        spans: dict[str | None, list] = {}
        for lot_id, earliest, latest in db.execute(
            select(
                FarmerEntry.lot_id,
                func.min(FarmerEntry.received_at),
                func.max(FarmerEntry.received_at),
            ).group_by(FarmerEntry.lot_id)
        ):
            value = seeds.get(lot_id, (None, None))[part]
            span = spans.setdefault(value, [earliest, latest])
            span[0], span[1] = min(span[0], earliest), max(span[1], latest)
        return sorted(((value, *span) for value, span in spans.items()), key=lambda row: row[1])

    return cache.remember(("seen", by), ("entries", "lots"), make)


def numbers(db: Session, start: dt.datetime, days: int, size: int, by: str, tz: int) -> bytes:
    end = start + dt.timedelta(days=days)
    before = start - dt.timedelta(days=days)
    in_period = (FarmerEntry.received_at >= start, FarmerEntry.received_at < end)

    found = seen(db, by)
    if by == "auto":
        one_crop = len({crop_key(value) for value, _, _ in found}) == 1
        by = "variety" if one_crop else "crop"
        if one_crop:
            found = seen(db, "variety")

    names: dict[str, str] = {}
    # When the very first and the latest entry came in: what "All time" covers.
    first: dt.datetime | None = None
    last: dt.datetime | None = None
    for value, earliest, latest in found:
        names.setdefault(crop_key(value), (value or "").strip() or "Not given")
        first = first or earliest
        last = max(last, latest) if last else latest

    def name(crop: str | None) -> str:
        return names.get(crop_key(crop), "Not given")

    # Columns and channels are counted by crop itself, which keeps the
    # answer to a few rows however the entries are spread over lots.
    split = SeedLot.variety if by == "variety" else SeedLot.crop
    index = bucket(start, size * DAY).label("bucket")
    columns: list[dict[str, int]] = [{} for _ in range(-(-days // size))]
    for crop, number, n in db.execute(
        select(split, index, func.count())
        .select_from(FarmerEntry)
        .join(SeedLot, FarmerEntry.lot_id == SeedLot.id)
        .where(*in_period)
        .group_by(split, index)
    ):
        if 0 <= number < len(columns):
            column = columns[number]
            column[name(crop)] = column.get(name(crop), 0) + n

    channels: dict[str, dict[str, int]] = {}
    for channel, crop, n in db.execute(
        select(FarmerEntry.channel, split, func.count())
        .select_from(FarmerEntry)
        .join(SeedLot, FarmerEntry.lot_id == SeedLot.id)
        .where(*in_period)
        .group_by(FarmerEntry.channel, split)
    ):
        counts = channels.setdefault((channel or "").strip() or "Not given", {})
        counts[name(crop)] = counts.get(name(crop), 0) + n

    # The lots farmers' entries were for in the period. Grouping first is
    # much quicker than the database's own count(DISTINCT ...).
    per_lot = select(FarmerEntry.lot_id).where(*in_period).group_by(FarmerEntry.lot_id).subquery()
    lot_count = db.scalar(select(func.count()).select_from(per_lot))
    busiest = sorted(channels.items(), key=lambda item: (-sum(item[1].values()), item[0]))

    # Simple counts of the period, and the one before it, in one read.
    now = FarmerEntry.received_at >= start

    def counted(*conditions):
        return func.count(case((and_(*conditions), 1)))

    previous, with_id, with_contact, by_officer = db.execute(
        select(
            counted(~now),
            counted(now, FarmerEntry.id_number != ""),
            counted(now, FarmerEntry.contact != ""),
            counted(now, FarmerEntry.filled_by == "Field officer"),
        ).where(FarmerEntry.received_at >= before, FarmerEntry.received_at < end)
    ).one()

    # Different mobile numbers, and those given on more than one entry: the
    # same farmer twice, or one phone used for several farmers. Grouping
    # first is much quicker than the database's own count(DISTINCT ...).
    per_number = (
        select(func.count().label("entries"))
        .where(*in_period, FarmerEntry.contact != "")
        .group_by(FarmerEntry.contact)
        .subquery()
    )
    farmers, repeat_farmers = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(case((per_number.c.entries > 1, 1), else_=0)), 0),
        ).select_from(per_number)
    ).one()
    per_device = (
        select(FarmerEntry.device_id)
        .where(*in_period, FarmerEntry.device_id != "")
        .group_by(FarmerEntry.device_id)
        .subquery()
    )
    devices = db.scalar(select(func.count()).select_from(per_device))

    weekday, hour = weekday_and_hour(tz)
    heatmap = [[0] * 24 for _ in range(7)]
    for day, hour_of_day, n in db.execute(
        select(weekday, hour, func.count()).where(*in_period).group_by(weekday, hour)
    ):
        if day is not None and hour_of_day is not None and 0 <= day < 7 and 0 <= hour_of_day < 24:
            heatmap[int(day)][int(hour_of_day)] += n

    latest = [
        {
            "id": entry_id,
            "farmer_name": farmer_name,
            "crop": crop,
            "variety": variety,
            "quantity": quantity,
            "channel": channel,
            "received_at": received_at,
        }
        for entry_id, farmer_name, crop, variety, quantity, channel, received_at in db.execute(
            select(
                FarmerEntry.id,
                FarmerEntry.farmer_name,
                SeedLot.crop,
                SeedLot.variety,
                FarmerEntry.quantity,
                FarmerEntry.channel,
                FarmerEntry.received_at,
            )
            .join(SeedLot, FarmerEntry.lot_id == SeedLot.id)
            .where(*in_period)
            .order_by(FarmerEntry.received_at.desc(), FarmerEntry.id.desc())
            .limit(LATEST)
        )
    ]

    return schemas.Stats.model_validate(
        {
            "series": list(dict.fromkeys(names.values())),
            "by": by,
            "first": first,
            "last": last,
            "previous": previous,
            "columns": columns,
            "channel_count": len(channels),
            "lot_count": lot_count,
            "channels": [
                {"name": channel, "counts": counts} for channel, counts in busiest[:TOP_CHANNELS]
            ],
            "kpis": {
                "farmers": farmers,
                "repeat_farmers": repeat_farmers,
                "with_id": with_id,
                "with_contact": with_contact,
                "by_officer": by_officer,
                "devices": devices,
            },
            "heatmap": heatmap,
            "lots": lot_summary(db),
            "latest": latest,
        }
    ).model_dump_json(by_alias=True).encode()


def lot_summary(db: Session) -> dict:
    """Lots in use now, and the newest of those nobody has scanned yet."""
    live = SeedLot.deleted_at.is_(None)
    unscanned = ~exists().where(FarmerEntry.lot_id == SeedLot.id)
    total = db.scalar(select(func.count()).select_from(SeedLot).where(live))
    unused = db.scalar(select(func.count()).select_from(SeedLot).where(live, unscanned))
    waiting = db.scalars(
        select(SeedLot).where(live, unscanned).order_by(SeedLot.created_at.desc()).limit(WAITING)
    ).all()
    return {
        "total": total,
        "unused": unused,
        "waiting": [schemas.WaitingLot.model_validate(lot) for lot in waiting],
    }
