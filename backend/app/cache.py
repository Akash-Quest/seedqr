"""Answers worth keeping for a little while: the dashboard's numbers, the
list of seed lots, the forms. Each kept answer names the kinds of data it
was made from; a change to one of them makes it stale at once.

    "entries"  farmer entries
    "lots"     seed lots
    "forms"    the questions on the forms

The middleware in main.py calls changed() around every request that writes,
so the routes themselves never have to remember to.

Kept in this process's memory. With several copies of the app, a change made
through one copy reaches the others only when their answers expire, so they
are never kept for longer than TTL seconds."""

import threading
import time
from collections import defaultdict
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

TTL = 60.0
# Answers kept at most. The dashboard asks for a handful of periods; this
# only stops a stream of odd requests from using up memory.
MOST = 300

_lock = threading.Lock()
_versions: dict[str, int] = defaultdict(int)
_kept: dict[tuple, tuple[tuple[int, ...], float, object]] = {}


def changed(*kinds: str) -> None:
    with _lock:
        for kind in kinds:
            _versions[kind] += 1


def remember(key: tuple, kinds: tuple[str, ...], make: Callable[[], T], ttl: float = TTL) -> T:
    """The answer kept for `key`, or a new one from make(). What comes back
    is shared with later callers, so it must not be changed."""
    with _lock:
        versions = tuple(_versions[kind] for kind in kinds)
        found = _kept.get(key)
        if found is not None and found[0] == versions and found[1] > time.monotonic():
            return found[2]  # type: ignore[return-value]
    value = make()
    with _lock:
        # Kept only if nothing it was made from changed while it was made.
        if versions == tuple(_versions[kind] for kind in kinds):
            if len(_kept) >= MOST:
                _kept.clear()
            _kept[(*key,)] = (versions, time.monotonic() + ttl, value)
    return value


def clear() -> None:
    with _lock:
        _kept.clear()
