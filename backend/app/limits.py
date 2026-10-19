"""Protection against floods: how often one address may try something, and
how much it may send in one request.

The counts are kept in this process's memory. That is right for one copy of
the app; with several, each keeps its own counts, so the real limit is that
many times higher. nginx in front applies its own limits as well."""

import json
import math
import threading
import time
from collections import deque

from fastapi import HTTPException, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import settings


def client_address(request: Request) -> str:
    """The network address a request came from.

    Behind nginx (or the Vite dev server) the real address arrives in
    X-Forwarded-For, where the proxy adds the address it saw at the end.
    Anything before that was written by the caller and can be made up, so
    only the last one is used."""
    hops = [hop.strip() for hop in request.headers.get("x-forwarded-for", "").split(",")]
    hops = [hop for hop in hops if hop]
    if settings.behind_proxy and hops:
        return hops[-1][:64]
    return (request.client.host if request.client else "")[:64]


class Limiter:
    """At most `limit` hits in any `seconds` for each key (an address, a
    username, or both)."""

    # Keys remembered at most, so a flood of made-up keys cannot use up
    # memory. Past this, keys with nothing recent are forgotten.
    MOST_KEYS = 50_000

    def __init__(self, limit: int, seconds: float):
        self.limit = limit
        self.seconds = seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._tidied = time.monotonic()

    def _recent(self, key: str, now: float) -> deque[float] | None:
        hits = self._hits.get(key)
        if hits is not None:
            while hits and hits[0] <= now - self.seconds:
                hits.popleft()
        return hits

    def wait(self, key: str) -> float:
        """Seconds until `key` may try again, or 0 if it may now."""
        with self._lock:
            now = time.monotonic()
            hits = self._recent(key, now)
            if not hits or len(hits) < self.limit:
                return 0
            return max(hits[0] + self.seconds - now, 1)

    def hit(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            hits = self._recent(key, now)
            if hits is None:
                self._tidy(now)
                hits = self._hits[key] = deque()
            hits.append(now)
            # Only the newest `limit` hits ever matter.
            if len(hits) > self.limit:
                hits.popleft()

    def take(self, key: str) -> float:
        """Counts a hit unless `key` is over its limit. Returns the seconds
        to wait, or 0 when the hit was allowed and counted."""
        with self._lock:
            now = time.monotonic()
            hits = self._recent(key, now)
            if hits is not None and len(hits) >= self.limit:
                return max(hits[0] + self.seconds - now, 1)
            if hits is None:
                self._tidy(now)
                hits = self._hits[key] = deque()
            hits.append(now)
            return 0

    def forget(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)

    def _tidy(self, now: float) -> None:
        if len(self._hits) < self.MOST_KEYS and now - self._tidied < 300:
            return
        self._tidied = now
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= now - self.seconds]:
            del self._hits[key]
        if len(self._hits) >= self.MOST_KEYS:
            # Still full of live keys: start again rather than grow.
            self._hits.clear()


def too_many(wait: float) -> HTTPException:
    minutes = math.ceil(wait / 60)
    when = "a minute" if minutes <= 1 else f"{minutes} minutes"
    return HTTPException(
        429,
        f"Too many tries. Please wait {when} and try again.",
        headers={"Retry-After": str(math.ceil(wait))},
    )


class Trusted:
    """Address and username pairs that signed in correctly lately. Those
    skip the limits per address and per username, so strangers guessing at
    a username from many addresses cannot keep its owner out."""

    MOST = 20_000

    def __init__(self, days: float):
        self.seconds = days * 86_400
        self._until: dict[str, float] = {}
        self._lock = threading.Lock()

    def add(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            if len(self._until) >= self.MOST:
                self._until = {k: t for k, t in self._until.items() if t > now}
                if len(self._until) >= self.MOST:
                    self._until.clear()
            self._until[key] = now + self.seconds

    def has(self, key: str) -> bool:
        with self._lock:
            return self._until.get(key, 0) > time.monotonic()

    def forget(self) -> None:
        with self._lock:
            self._until.clear()


FIFTEEN_MINUTES = 15 * 60

# Wrong passwords. One address guessing one account is stopped soonest; one
# address trying many accounts, or many addresses trying one, a little later.
login_by_pair = Limiter(settings.login_attempts, FIFTEEN_MINUTES)
login_by_address = Limiter(settings.login_attempts * 3, FIFTEEN_MINUTES)
login_by_username = Limiter(settings.login_attempts * 5, FIFTEEN_MINUTES)
signed_in_from = Trusted(days=30)

# The two pages anyone may use without signing in.
entries_by_address = Limiter(settings.entries_per_minute, 60)
lots_by_address = Limiter(300, 60)

ALL = (
    login_by_pair,
    login_by_address,
    login_by_username,
    signed_in_from,
    entries_by_address,
    lots_by_address,
)


# ---- Size of a request ---------------------------------------------------

KB = 1024
MB = 1024 * KB
# Most requests are small. The few that may be bigger, by path.
DEFAULT_BODY = 1 * MB
BIGGER_BODIES = {
    "/api/entries": 128 * KB,  # one farmer entry, from anyone
    "/api/login": 4 * KB,
    "/api/entries/import": 25 * MB,  # up to 5,000 rows of an Excel file
    "/api/forms/farmer": 2 * MB,  # the long list of distribution channels
}


TOO_LARGE = "That is more than can be sent at once."


class TooLarge(StarletteHTTPException):
    """Raised while the body is being read. An HTTPException, so FastAPI
    passes it on as a 413 rather than calling it a body it could not read."""

    def __init__(self):
        super().__init__(413, TOO_LARGE)


class BodyLimit:
    """Refuses a request whose body is larger than its path allows, before
    any of it is parsed. Checks the declared length first, then counts what
    actually arrives, since a sender may leave the length out."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        limit = BIGGER_BODIES.get(scope["path"].rstrip("/"), DEFAULT_BODY)
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            await refuse(send)
            return

        received = 0
        started = False

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise TooLarge
            return message

        async def watched(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted, watched)
        except TooLarge:
            if not started:
                await refuse(send)


async def refuse(send: Send) -> None:
    body = json.dumps({"error": TOO_LARGE}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
