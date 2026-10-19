"""What keeps the site safe on the open internet: limits, headers, and
input that must never break a request."""

import pytest

from app import limits
from app.database import SessionLocal
from app.models import FarmerEntry

from .conftest import LOT, sign_in


def wrong(client, username="boss", address="10.0.0.1"):
    return client.post(
        "/api/login",
        json={"username": username, "password": "not-this"},
        headers={"X-Forwarded-For": address},
    )


# ---- Signing in ----------------------------------------------------------


def test_guessing_a_password_is_stopped(client):
    for _ in range(limits.login_by_pair.limit):
        assert wrong(client).status_code == 403
    stopped = wrong(client)
    assert stopped.status_code == 429
    assert int(stopped.headers["retry-after"]) > 0
    # Even the right password waits, or guessing would carry on.
    right = client.post(
        "/api/login",
        json={"username": "boss", "password": "boss-password"},
        headers={"X-Forwarded-For": "10.0.0.1"},
    )
    assert right.status_code == 429
    # Someone else, elsewhere, is not held up.
    assert wrong(client, address="10.0.0.2").status_code == 403


def test_one_address_trying_many_usernames_is_stopped(client):
    limit = limits.login_by_address.limit
    for n in range(limit):
        assert wrong(client, username=f"someone-{n}").status_code == 403
    assert wrong(client, username="someone-else").status_code == 429


def test_signing_in_clears_earlier_mistakes(client):
    for _ in range(limits.login_by_pair.limit - 1):
        wrong(client)
    assert sign_in(client)
    assert wrong(client).status_code == 403


def test_an_endless_password_is_refused_without_checking_it(client):
    reply = client.post("/api/login", json={"username": "boss", "password": "x" * 100_000})
    assert reply.status_code in (400, 413)


def test_only_the_address_the_proxy_saw_is_trusted(client, lot):
    lot_id = lot()
    client.post(
        "/api/entries",
        json={"id": "entry-forwarded", "lotId": lot_id, "farmerName": "Asha"},
        # The caller wrote the first address; the proxy added the last.
        headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.9"},
    )
    with SessionLocal() as db:
        assert db.get(FarmerEntry, "entry-forwarded").ip_address == "203.0.113.9"


# ---- The public form -----------------------------------------------------


def test_one_address_cannot_flood_the_farmer_form(client, lot, monkeypatch):
    lot_id = lot()
    monkeypatch.setattr(limits.entries_by_address, "limit", 3)
    replies = [
        client.post(
            "/api/entries",
            json={"id": f"flood-{n:04d}", "lotId": lot_id, "farmerName": "Asha"},
            headers={"X-Forwarded-For": "198.51.100.7"},
        ).status_code
        for n in range(5)
    ]
    assert replies == [200, 200, 200, 429, 429]
    other = client.post(
        "/api/entries",
        json={"id": "flood-other", "lotId": lot_id, "farmerName": "Mohan"},
        headers={"X-Forwarded-For": "198.51.100.8"},
    )
    assert other.status_code == 200


def test_a_huge_entry_is_refused_before_it_is_read(client, lot):
    lot_id = lot()
    body = {"id": "too-big-entry", "lotId": lot_id, "farmerName": "A", "userAgent": "x" * 300_000}
    reply = client.post("/api/entries", json=body)
    assert reply.status_code == 413
    assert reply.json() == {"error": "That is more than can be sent at once."}


def test_a_huge_body_without_a_length_is_refused_too(client, lot):
    lot_id = lot()
    payload = (
        '{"id": "chunked-entry", "lotId": "%s", "farmerName": "A", "userAgent": "%s"}'
        % (lot_id, "x" * 300_000)
    ).encode()

    def pieces():
        for start in range(0, len(payload), 16_384):
            yield payload[start : start + 16_384]

    reply = client.post(
        "/api/entries", content=pieces(), headers={"Content-Type": "application/json"}
    )
    assert reply.status_code == 413


def test_answers_to_unknown_questions_are_not_stored(client, boss, lot):
    farmer = client.get("/api/forms", headers=boss).json()["farmer"]
    choice = {
        "key": "c_crop2", "label": "Second crop", "type": "select", "options": ["Maize", "Gram"],
    }
    client.put("/api/forms/farmer", json=[*farmer, choice], headers=boss)
    client.post(
        "/api/entries",
        json={
            "id": "extra-answers", "lotId": lot(), "farmerName": "Asha",
            "extra": {"c_crop2": "Wheat", "c_later9": "kept", "anything": "dropped"},
        },
    )
    with SessionLocal() as db:
        # Not one of its choices: dropped. An office-style key the form no
        # longer has (filled in offline): kept. Any other key: dropped.
        assert db.get(FarmerEntry, "extra-answers").extra == {"c_later9": "kept"}


def test_a_nul_character_never_breaks_saving(client, boss, lot):
    reply = client.post(
        "/api/entries",
        json={"id": "nul-entry", "lotId": lot(), "farmerName": "As\u0000ha", "extra": {"c_x1y2": "a\u0000"}},
    )
    assert reply.status_code == 200
    shown = client.get("/api/entries", headers=boss).json()["items"][0]
    assert shown["farmerName"] == "Asha"
    login = client.post("/api/login", json={"username": "bo\u0000ss", "password": "boss-password"})
    assert login.status_code == 200


def test_the_public_lot_keeps_hidden_questions_in_the_office(client, boss):
    lot_form = client.get("/api/forms", headers=boss).json()["lot"]
    for field in lot_form:
        if field["key"] == "storageLocation":
            field["hidden"] = True
    secret = {"key": "c_cost1", "label": "Cost price", "type": "text", "hidden": False}
    client.put("/api/forms/lot", json=[*lot_form, secret], headers=boss)
    made = client.post(
        "/api/lots", json={**LOT, "extra": {"c_cost1": "1200"}}, headers=boss
    ).json()
    secret["hidden"] = True
    client.put("/api/forms/lot", json=[*lot_form, secret], headers=boss)

    public = client.get(f"/api/lots/{made['id']}").json()
    assert public["storageLocation"] == ""
    assert public["extra"] == {}
    assert {"storageLocation", "c_cost1"}.isdisjoint(f["key"] for f in public["lotFields"])
    # The office still sees everything.
    office = client.get("/api/lots", headers=boss).json()[0]
    assert office["storageLocation"] == "Shed 1"
    assert office["extra"] == {"c_cost1": "1200"}


# ---- Odd input never makes a 500 -----------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/stats?start=0001-01-01T00:00:00&days=7",
        "/api/stats?start=9999-12-31T00:00:00&days=36600",
        "/api/stats?start=0001-01-01T00:00:00%2B05:00&days=7",
        "/api/entries?from=0001-01-01T00:00:00%2B05:00",
        "/api/entries?to=9999-12-31T23:59:59",
        "/api/entries?page=100000000000000000000",
        "/api/entries?q=" + "x" * 500,
        "/api/stats?start=2026-01-01T00:00:00Z&days=7&tz=99999",
    ],
)
def test_odd_queries_are_refused_politely(client, boss, path):
    reply = client.get(path, headers=boss)
    assert reply.status_code == 400, reply.text
    assert "error" in reply.json()


def test_an_import_with_an_impossible_time_is_refused(client, boss):
    row = {
        "id": "import-odd", "farmerName": "Asha", "receivedAt": "0001-01-01T00:00:00+05:00",
        "seed": {"crop": "Paddy", "variety": "Sona", "batchNo": "B1"},
    }
    assert client.post("/api/entries/import", json=[row], headers=boss).status_code == 400


def test_endless_option_lists_are_refused(client, boss):
    farmer = client.get("/api/forms", headers=boss).json()["farmer"]
    for field in farmer:
        if field["key"] == "channel":
            field["options"] = [f"Channel {n}" for n in range(2001)]
    assert client.put("/api/forms/farmer", json=farmer, headers=boss).status_code == 400


# ---- Exports -------------------------------------------------------------


def test_a_question_named_like_a_formula_is_plain_text_in_the_export(client, boss, lot, entry):
    farmer = client.get("/api/forms", headers=boss).json()["farmer"]
    formula = {"key": "c_sneaky", "label": "=1+2", "type": "text"}
    client.put("/api/forms/farmer", json=[*farmer, formula], headers=boss)
    entry(lot())
    token = boss["Authorization"].removeprefix("Bearer ")
    header = client.post("/api/entries/export", data={"token": token}).text.splitlines()[0]
    assert "'=1+2" in header.split(",")


# ---- Headers -------------------------------------------------------------


def test_every_answer_carries_the_safety_headers(client):
    for path in ("/api/health", "/api/lots/NOSUCH11"):
        headers = client.get(path).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["cross-origin-opener-policy"] == "same-origin"
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert "script-src 'self'" in headers["content-security-policy"]
        assert headers["cache-control"] == "no-store"


def test_the_api_pages_are_off_unless_asked_for(client):
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_big_answers_are_compressed(client, boss):
    reply = client.get("/api/forms", headers={**boss, "Accept-Encoding": "gzip"})
    assert reply.headers.get("content-encoding") == "gzip"


# ---- Kept answers stay right ---------------------------------------------


def test_kept_answers_change_as_soon_as_the_data_does(client, boss, lot, entry):
    lot_id = lot()
    params = {"start": "2020-01-01T00:00:00Z", "days": 3650, "size": 30, "by": "crop"}
    before = client.get("/api/stats", params=params, headers=boss).json()
    assert client.get("/api/lots", headers=boss).json()[0]["entryCount"] == 0
    assert client.get("/api/entries", headers=boss).json()["total"] == 0

    entry(lot_id)
    after = client.get("/api/stats", params=params, headers=boss).json()
    assert sum(map(sum, after["heatmap"])) == sum(map(sum, before["heatmap"])) + 1
    assert client.get("/api/lots", headers=boss).json()[0]["entryCount"] == 1
    assert client.get("/api/entries", headers=boss).json()["total"] == 1

    client.put(f"/api/lots/{lot_id}", json={**LOT, "crop": "Barley"}, headers=boss)
    renamed = client.get("/api/stats", params=params, headers=boss).json()
    assert renamed["series"] == ["Barley"]


def test_uptime_monitors_may_ask_with_head(client):
    assert client.head("/api/health").status_code == 200


# ---- Found in review -----------------------------------------------------


def test_strangers_guessing_cannot_keep_the_owner_out(client):
    owner = {"X-Forwarded-For": "10.1.1.1"}
    assert client.post("/api/login", json={"username": "boss", "password": "boss-password"}, headers=owner).status_code == 200
    # Many addresses, each staying under its own limit, use up the
    # username's limit.
    for n in range(limits.login_by_username.limit):
        wrong(client, address=f"203.0.113.{n // 5}")
    assert wrong(client, address="203.0.113.99").status_code == 429
    # The owner, where they signed in before, still gets in.
    again = client.post("/api/login", json={"username": "boss", "password": "boss-password"}, headers=owner)
    assert again.status_code == 200


def test_a_nul_in_the_address_is_refused_with_the_usual_headers(client, boss):
    for path in ("/api/entries?q=%00", "/api/lots/AB%00CD"):
        reply = client.get(path, headers=boss)
        assert reply.status_code == 400
        assert reply.headers["x-frame-options"] == "DENY"
    token = boss["Authorization"].removeprefix("Bearer ")
    assert client.post("/api/entries/export", data={"token": token, "q": "a\x00b"}).status_code == 200


def test_a_failure_still_carries_the_safety_headers(boss, monkeypatch):
    from fastapi.testclient import TestClient

    from app import stats
    from app.main import app

    def broken(*args):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(stats, "numbers", broken)
    client = TestClient(app, raise_server_exceptions=False)
    reply = client.get("/api/stats", params={"start": "2026-06-01T00:00:00Z", "days": 7}, headers=boss)
    assert reply.status_code == 500
    assert reply.json() == {"error": "Something went wrong on the server. Please try again."}
    assert "the database went away" not in reply.text
    assert reply.headers["x-content-type-options"] == "nosniff"
    assert reply.headers["cache-control"] == "no-store"


def test_a_refused_write_keeps_the_kept_answers(client, boss):
    from app import cache

    before = dict(cache._versions)
    assert client.post("/api/lots", json=LOT).status_code == 401
    assert client.post("/api/entries", json={"id": "nothing-here", "lotId": "NOSUCH11", "farmerName": "A"}).status_code == 404
    assert dict(cache._versions) == before


def test_a_size_refusal_carries_the_safety_headers(client):
    reply = client.post("/api/login", content=b"x" * 10_000, headers={"Content-Type": "application/json"})
    assert reply.status_code == 413
    assert reply.headers["x-frame-options"] == "DENY"


def test_the_excel_reader_may_start_its_worker(client):
    policy = client.get("/api/health").headers["content-security-policy"]
    assert "worker-src 'self' blob:" in policy
