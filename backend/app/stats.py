"""The numbers behind the dashboard, counted by the database so the browser
never has to load every entry.

An entry's crop is its seed lot's crop as it is now. (The entries list shows
the crop as it was when the farmer submitted; for charts the difference only
shows if a lot's crop is retyped later.)
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer, cast, extract, func, select, text
from sqlalchemy.orm import Session

from . import schemas
from .auth import signed_in
from .database import engine, get_db
from .models import FarmerEntry, SeedLot

router = APIRouter(prefix="/api")

DAY = 86_400
TOP_CHANNELS = 5
# A year of days is the widest chart asked for; anything longer uses wider
# columns (see the dashboard's "All time").
MOST_COLUMNS = 400


def naive_utc(value: dt.datetime) -> dt.datetime:
    """Times are stored in UTC without a timezone (see models.utc_now)."""
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


def crop_key(crop: str | None) -> str:
    return (crop or "").strip().lower()


@router.get("/stats", response_model=schemas.Stats, dependencies=[Depends(signed_in)])
def stats(
    start: dt.datetime,
    days: int = Query(ge=1, le=36_600),
    size: int = Query(default=1, ge=1, le=366),
    by: str = Query(default="auto", pattern="^(auto|crop|variety)$"),
    db: Session = Depends(get_db),
):
    """Entry counts for `days` days from `start`, in columns of `size` days.
    `start` is midnight where the office is, which the browser knows.

    The counts are split `by` crop or by variety. Left to "auto" it is by
    crop, unless every entry is of one crop: then a split by crop would say
    nothing, and it is by variety."""
    if days / size > MOST_COLUMNS:
        raise HTTPException(400, "That is too many columns for one chart.")
    start = naive_utc(start)
    end = start + dt.timedelta(days=days)
    in_period = (FarmerEntry.received_at >= start, FarmerEntry.received_at < end)
    joined = select().select_from(FarmerEntry).join(SeedLot, FarmerEntry.lot_id == SeedLot.id)

    def seen(column) -> list:
        """Each value of the column with its first and last entry, in the
        order they first appeared over all time, so a crop keeps its place
        (and its colour) whatever period is shown."""
        earliest = func.min(FarmerEntry.received_at)
        return db.execute(
            joined.add_columns(column, earliest, func.max(FarmerEntry.received_at))
            .group_by(column)
            .order_by(earliest)
        ).all()

    found = seen(SeedLot.variety if by == "variety" else SeedLot.crop)
    if by == "auto":
        one_crop = len({crop_key(value) for value, _, _ in found}) == 1
        by = "variety" if one_crop else "crop"
        if one_crop:
            found = seen(SeedLot.variety)
    split = SeedLot.variety if by == "variety" else SeedLot.crop

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

    index = bucket(start, size * DAY).label("bucket")
    columns: list[dict[str, int]] = [{} for _ in range(-(-days // size))]
    for crop, number, count in db.execute(
        joined.add_columns(split, index, func.count())
        .where(*in_period)
        .group_by(split, index)
    ):
        if 0 <= number < len(columns):
            column = columns[number]
            column[name(crop)] = column.get(name(crop), 0) + count

    channels: dict[str, dict[str, int]] = {}
    for channel, crop, count in db.execute(
        joined.add_columns(FarmerEntry.channel, split, func.count())
        .where(*in_period)
        .group_by(FarmerEntry.channel, split)
    ):
        counts = channels.setdefault((channel or "").strip() or "Not given", {})
        counts[name(crop)] = counts.get(name(crop), 0) + count
    busiest = sorted(channels.items(), key=lambda item: (-sum(item[1].values()), item[0]))

    previous = db.scalar(
        select(func.count())
        .select_from(FarmerEntry)
        .where(
            FarmerEntry.received_at >= start - dt.timedelta(days=days),
            FarmerEntry.received_at < start,
        )
    )
    return {
        "series": list(dict.fromkeys(names.values())),
        "by": by,
        "first": first,
        "last": last,
        "previous": previous,
        "columns": columns,
        "channel_count": len(channels),
        "channels": [
            {"name": channel, "counts": counts} for channel, counts in busiest[:TOP_CHANNELS]
        ],
    }
