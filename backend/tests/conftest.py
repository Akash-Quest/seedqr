"""Tests run against a throwaway database: a SQLite file unless DATABASE_URL
is already set (the CI sets it to a PostgreSQL made for the run)."""

import datetime as dt
import os
import tempfile
from pathlib import Path

import pytest

if "DATABASE_URL" not in os.environ:
    folder = tempfile.mkdtemp(prefix="seedcode-tests-")
    os.environ["DATABASE_URL"] = f"sqlite:///{(Path(folder) / 'test.db').as_posix()}"
os.environ["ADMIN_USERNAME"] = "boss"
os.environ["ADMIN_PASSWORD"] = "boss-password"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.migrate import upgrade  # noqa: E402
from app.models import AdminSession, FarmerEntry, FormSettings, SeedLot, User  # noqa: E402

upgrade()


@pytest.fixture(autouse=True)
def empty_database():
    """Every test starts with only the first admin, "boss"."""
    with SessionLocal() as db:
        db.execute(delete(AdminSession))
        db.execute(delete(FarmerEntry))
        db.execute(delete(SeedLot))
        db.execute(delete(FormSettings))
        db.execute(delete(User).where(User.username != "boss"))
        db.commit()


@pytest.fixture
def client():
    return TestClient(app)


def sign_in(client, username="boss", password="boss-password") -> dict:
    reply = client.post("/api/login", json={"username": username, "password": password})
    assert reply.status_code == 200, reply.text
    return {"Authorization": f"Bearer {reply.json()['token']}"}


@pytest.fixture
def boss(client):
    return sign_in(client)


@pytest.fixture
def staff(client, boss):
    """Makes an account with a role and returns its sign-in headers."""

    def make(role: str, username: str | None = None) -> dict:
        username = username or f"{role}-one"
        reply = client.post(
            "/api/staff",
            json={"username": username, "password": "a-good-password", "role": role},
            headers=boss,
        )
        assert reply.status_code == 200, reply.text
        return sign_in(client, username, "a-good-password")

    return make


LOT = {
    "date": "2026-06-01", "seedType": "Certified", "crop": "Wheat", "variety": "HD 2967",
    "batchNo": "B-101", "productionSource": "Farm A", "storageLocation": "Shed 1",
}


@pytest.fixture
def lot(client, boss):
    def make(**changes) -> str:
        reply = client.post("/api/lots", json={**LOT, **changes}, headers=boss)
        assert reply.status_code == 200, reply.text
        return reply.json()["id"]

    return make


@pytest.fixture
def entry(client):
    """Sends an entry the way a farmer's phone does, optionally backdated."""
    count = 0

    def make(lot_id: str, received_at: dt.datetime | None = None, **changes) -> str:
        nonlocal count
        count += 1
        body = {
            "id": f"entry-{count:06d}", "lotId": lot_id, "farmerName": f"Farmer {count}",
            "channel": "Village shop", "quantity": "5 kg", **changes,
        }
        reply = client.post("/api/entries", json=body)
        assert reply.status_code == 200, reply.text
        if received_at is not None:
            with SessionLocal() as db:
                db.get(FarmerEntry, body["id"]).received_at = received_at
                db.commit()
        return body["id"]

    return make
