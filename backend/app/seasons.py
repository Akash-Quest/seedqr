"""The crop seasons the dashboard can show, and when each one runs.

The office's own dates, the same every year. To change a season, change its
first and last day here; the dashboard picks it up on the next load.

On the dashboard a season covers every year at once: Kharif is every entry
from 13 May to 10 August, whichever year it came in (see in_season).
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import TypeAdapter
from sqlalchemy import Integer, and_, case, cast, extract, func, literal_column, or_, select
from sqlalchemy.orm import Session

from . import cache, schemas
from .auth import signed_in
from .database import engine, get_db
from .models import FarmerEntry

router = APIRouter(prefix="/api")

# Name, first day and last day, each as (month, day); both days count. A
# season whose last day comes before its first runs into the next year.
SEASONS = (
    ("Rabi", (10, 15), (1, 10)),  # 15 October to 10 January
    ("Kharif", (5, 13), (8, 10)),  # 13 May to 10 August
    ("Garma", (2, 10), (5, 12)),  # 10 February to 12 May
)


def month_day(offset: int):
    """The month and day an entry came in on the office's clock, `offset`
    minutes ahead of UTC, as one number: 15 October is 1015. The offset is a
    checked whole number, so writing it into the SQL is safe."""
    moment = FarmerEntry.received_at
    name = engine.dialect.name
    if name == "sqlite":
        return cast(func.strftime("%m%d", moment, literal_column(f"'{offset:+d} minutes'")), Integer)
    if name == "postgresql":
        local = moment + literal_column(f"interval '{offset:d} minutes'")
        return cast(extract("month", local) * 100 + extract("day", local), Integer)
    local = func.date_add(moment, literal_column(f"INTERVAL {offset:d} MINUTE"))
    return func.month(local) * 100 + func.dayofmonth(local)


def in_season(name: str, offset: int):
    """A condition for entries that came in during the season `name`, in
    any year. A season that runs into the next year (Rabi) is the end of one
    year and the start of the next."""
    for season, (month, day), (end_month, end_day) in SEASONS:
        if season.lower() == name.strip().lower():
            first, last = month * 100 + day, end_month * 100 + end_day
            when = month_day(offset)
            if last < first:
                return or_(when >= first, when <= last)
            return and_(when >= first, when <= last)
    raise HTTPException(400, f"There is no season called {name!r}.")


# A crop year begins with Kharif: 2025–26 is Kharif from May 2025, Rabi from
# October 2025, and Garma from February 2026. Every season is named by its
# crop year, so all of them list the same years.
CROP_YEAR_START = (5, 13)


def crop_year(day: dt.date) -> int:
    """The year a day's crop year began in: 20 Feb 2026 is in 2025–26."""
    return day.year if (day.month, day.day) >= CROP_YEAR_START else day.year - 1


def occurrences(first_year: int, last_year: int) -> list[tuple[str, str, dt.date, dt.date]]:
    """Every season of the crop years from `first_year` to `last_year`,
    whether or not it has entries, so each season lists the same years.
    Newest first: (season, label, first day, last day)."""
    found = []
    for year in range(first_year, last_year + 1):
        label = f"{year}–{str(year + 1)[-2:]}"
        for name, (month, day), (end_month, end_day) in SEASONS:
            # Seasons from before the crop year's start in a calendar year
            # (Garma, in February) come at the end of the crop year.
            begins_in = year if (month, day) >= CROP_YEAR_START else year + 1
            begin = dt.date(begins_in, month, day)
            crosses = (end_month, end_day) < (month, day)
            finish = dt.date(begins_in + 1 if crosses else begins_in, end_month, end_day)
            found.append((name, f"{name} {label}", begin, finish))
    return sorted(found, key=lambda season: season[2], reverse=True)


@router.get("/seasons", response_model=list[schemas.Season], dependencies=[Depends(signed_in)])
def season_list(
    tz: int = Query(default=0, ge=-14 * 60, le=14 * 60),
    db: Session = Depends(get_db),
):
    """Each season of every crop year from the first entry's to this one,
    newest first, with its days and how many entries came in during it,
    none or many. `tz` is how many minutes
    the office's clock is ahead of UTC, so a season starts at the office's
    midnight."""
    offset = dt.timedelta(minutes=tz)
    today = (dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) + offset).date()
    return Response(
        cache.remember(
            ("seasons", tz, today.isoformat()), ("entries",), lambda: season_numbers(db, today, offset)
        ),
        media_type="application/json",
    )


def season_numbers(db: Session, today: dt.date, offset: dt.timedelta) -> bytes:
    def local_day(moment: dt.datetime | None) -> dt.date | None:
        return (moment + offset).date() if moment else None

    oldest, newest = db.execute(
        select(func.min(FarmerEntry.received_at), func.max(FarmerEntry.received_at))
    ).one()
    first = local_day(oldest) or today
    last = max(today, local_day(newest) or today)
    found = occurrences(crop_year(first), crop_year(last))

    def utc_midnight(day: dt.date) -> dt.datetime:
        return dt.datetime.combine(day, dt.time()) - offset

    # Every season's entries in one read.
    counts = (
        db.execute(
            select(
                *(
                    func.count(
                        case(
                            (
                                and_(
                                    FarmerEntry.received_at >= utc_midnight(begin),
                                    FarmerEntry.received_at < utc_midnight(finish + dt.timedelta(days=1)),
                                ),
                                1,
                            )
                        )
                    )
                    for _, _, begin, finish in found
                )
            )
        ).one()
        if found
        else ()
    )
    seasons = SEASON_LIST.validate_python(
        [
            {"season": name, "label": label, "start": begin, "end": finish, "entries": n}
            for (name, label, begin, finish), n in zip(found, counts)
        ]
    )
    return SEASON_LIST.dump_json(seasons, by_alias=True)


SEASON_LIST = TypeAdapter(list[schemas.Season])
