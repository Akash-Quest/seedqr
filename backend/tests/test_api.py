import datetime as dt

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.database import Base, engine

from .conftest import LOT, sign_in


def test_migrations_make_the_tables_the_models_describe():
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert differences == []


def test_health_needs_no_sign_in(client):
    assert client.get("/api/health").json() == {"ok": True}


# ---- Signing in and roles ------------------------------------------------


def test_wrong_password_is_refused(client):
    reply = client.post("/api/login", json={"username": "boss", "password": "not-this"})
    assert reply.status_code == 403


def test_office_pages_need_a_sign_in(client):
    for path in ("/api/lots", "/api/entries", "/api/forms", "/api/staff", "/api/stats?start=2026-01-01T00:00:00Z&days=7"):
        assert client.get(path).status_code == 401, path


def test_sign_out_ends_the_session(client, boss):
    assert client.get("/api/lots", headers=boss).status_code == 200
    client.post("/api/logout", json={}, headers=boss)
    assert client.get("/api/lots", headers=boss).status_code == 401


def test_viewer_can_read_but_not_change(client, staff, lot):
    lot_id = lot()
    viewer = staff("viewer")
    assert client.get("/api/lots", headers=viewer).status_code == 200
    assert client.get("/api/entries", headers=viewer).status_code == 200
    assert client.get("/api/forms", headers=viewer).status_code == 200
    assert client.post("/api/lots", json=LOT, headers=viewer).status_code == 403
    assert client.put(f"/api/lots/{lot_id}", json=LOT, headers=viewer).status_code == 403
    assert client.delete(f"/api/lots/{lot_id}", headers=viewer).status_code == 403
    assert client.post("/api/entries/import", json=[], headers=viewer).status_code == 403
    assert client.put("/api/forms/lot", json=[], headers=viewer).status_code == 403
    assert client.get("/api/staff", headers=viewer).status_code == 403


def test_editor_manages_lots_but_not_forms_or_staff(client, staff):
    editor = staff("editor")
    made = client.post("/api/lots", json=LOT, headers=editor)
    assert made.status_code == 200
    lot_id = made.json()["id"]
    assert client.put(f"/api/lots/{lot_id}", json={**LOT, "crop": "Rice"}, headers=editor).status_code == 200
    assert client.post("/api/entries/import", json=[], headers=editor).status_code == 200
    assert client.delete(f"/api/lots/{lot_id}", headers=editor).status_code == 200
    assert client.put("/api/forms/lot", json=[], headers=editor).status_code == 403
    assert client.get("/api/staff", headers=editor).status_code == 403


def test_admin_changes_forms(client, boss):
    assert client.put("/api/forms/lot", json=[], headers=boss).status_code == 200


# ---- Staff accounts ------------------------------------------------------


def test_usernames_are_unique_and_ignore_capitals(client, boss, staff):
    staff("viewer", "Meera")
    again = client.post(
        "/api/staff",
        json={"username": "meera", "password": "a-good-password", "role": "editor"},
        headers=boss,
    )
    assert again.status_code == 400
    assert sign_in(client, "MEERA", "a-good-password")


def test_short_passwords_are_refused(client, boss):
    reply = client.post(
        "/api/staff", json={"username": "ravi", "password": "short", "role": "viewer"}, headers=boss
    )
    assert reply.status_code == 400


def test_the_last_admin_cannot_be_removed(client, boss):
    me = client.get("/api/staff", headers=boss).json()[0]
    for change in ({"role": "viewer", "active": True}, {"role": "admin", "active": False}):
        reply = client.put(f"/api/staff/{me['id']}", json=change, headers=boss)
        assert reply.status_code == 400


def test_switching_an_account_off_signs_it_out(client, boss, staff):
    editor = staff("editor")
    account = next(u for u in client.get("/api/staff", headers=boss).json() if u["role"] == "editor")
    reply = client.put(
        f"/api/staff/{account['id']}", json={"role": "editor", "active": False}, headers=boss
    )
    assert reply.status_code == 200
    assert client.get("/api/lots", headers=editor).status_code == 401
    refused = client.post(
        "/api/login", json={"username": account["username"], "password": "a-good-password"}
    )
    assert refused.status_code == 403


def test_a_new_role_applies_at_once(client, boss, staff):
    editor = staff("editor")
    account = next(u for u in client.get("/api/staff", headers=boss).json() if u["role"] == "editor")
    client.put(f"/api/staff/{account['id']}", json={"role": "viewer", "active": True}, headers=boss)
    # The old sign-in is gone; the new one has the new role.
    assert client.post("/api/lots", json=LOT, headers=editor).status_code == 401
    viewer = sign_in(client, account["username"], "a-good-password")
    assert client.post("/api/lots", json=LOT, headers=viewer).status_code == 403


def test_admin_sets_a_new_password(client, boss, staff):
    staff("viewer", "meera")
    account = next(u for u in client.get("/api/staff", headers=boss).json() if u["username"] == "meera")
    client.put(
        f"/api/staff/{account['id']}",
        json={"role": "viewer", "active": True, "password": "another-password"},
        headers=boss,
    )
    assert sign_in(client, "meera", "another-password")
    old = client.post("/api/login", json={"username": "meera", "password": "a-good-password"})
    assert old.status_code == 403


# ---- Farmers -------------------------------------------------------------


def test_a_farmer_scans_and_submits_without_signing_in(client, boss, lot, entry):
    lot_id = lot()
    seen = client.get(f"/api/lots/{lot_id}")
    assert seen.status_code == 200
    assert seen.json()["crop"] == "Wheat"
    assert seen.json()["farmerFields"]

    entry(lot_id, id="same-entry-id")
    entry(lot_id, id="same-entry-id")  # sent twice after a lost connection
    assert client.get("/api/entries", headers=boss).json()["total"] == 1


# ---- The entries list ----------------------------------------------------


def test_entries_come_a_page_at_a_time(client, boss, lot, entry):
    lot_id = lot()
    now = dt.datetime(2026, 6, 10, 12, 0)
    for minutes in range(5):
        entry(lot_id, received_at=now + dt.timedelta(minutes=minutes))

    first = client.get("/api/entries?size=2", headers=boss).json()
    assert first["total"] == 5
    assert [e["farmerName"] for e in first["items"]] == ["Farmer 5", "Farmer 4"]
    last = client.get("/api/entries?size=2&page=3", headers=boss).json()
    assert [e["farmerName"] for e in last["items"]] == ["Farmer 1"]
    assert client.get("/api/entries?size=2&page=9", headers=boss).json()["items"] == []
    assert client.get("/api/entries?size=5000", headers=boss).status_code == 400


def test_search_looks_at_farmer_and_seed(client, boss, lot, entry):
    wheat, rice = lot(), lot(crop="Rice", batchNo="R-7")
    entry(wheat, farmerName="Asha Devi", contact="9876543210")
    entry(rice, farmerName="Mohan Lal", channel="100% Organic Co-op")

    def names(q: str) -> list[str]:
        found = client.get("/api/entries", params={"q": q}, headers=boss).json()
        assert found["total"] == len(found["items"])
        return sorted(e["farmerName"] for e in found["items"])

    assert names("asha") == ["Asha Devi"]
    assert names("98765") == ["Asha Devi"]
    assert names("rice") == ["Mohan Lal"]
    assert names("r-7") == ["Mohan Lal"]
    assert names("a") == ["Asha Devi", "Mohan Lal"]
    # % and _ are looked for as typed, not as "anything".
    assert names("100%") == ["Mohan Lal"]
    assert names("%") == ["Mohan Lal"]
    assert names("_") == []


def test_entries_between_two_times(client, boss, lot, entry):
    lot_id = lot()
    entry(lot_id, received_at=dt.datetime(2026, 6, 9, 23, 59))
    entry(lot_id, received_at=dt.datetime(2026, 6, 10, 0, 0))
    entry(lot_id, received_at=dt.datetime(2026, 6, 11, 0, 0))

    found = client.get(
        "/api/entries",
        params={"from": "2026-06-10T00:00:00Z", "to": "2026-06-11T00:00:00Z"},
        headers=boss,
    ).json()
    assert [e["farmerName"] for e in found["items"]] == ["Farmer 2"]
    # A time with an offset is the same moment: 05:30 in India is midnight UTC.
    india = client.get(
        "/api/entries", params={"from": "2026-06-11T05:30:00+05:30"}, headers=boss
    ).json()
    assert [e["farmerName"] for e in india["items"]] == ["Farmer 3"]


def test_an_entry_keeps_the_seed_details_the_farmer_saw(client, boss, lot, entry):
    lot_id = lot()
    entry(lot_id)
    client.put(f"/api/lots/{lot_id}", json={**LOT, "variety": "Changed later"}, headers=boss)
    shown = client.get("/api/entries", headers=boss).json()["items"][0]
    assert shown["lot"]["variety"] == "HD 2967"


def test_a_viewer_never_gets_a_full_id_number(client, boss, staff, lot, entry):
    entry(lot(), kycType="Aadhaar ID", idNumber="123456789012")
    full = client.get("/api/entries", headers=boss).json()["items"][0]
    assert full["idNumber"] == "123456789012"
    masked = client.get("/api/entries", headers=staff("viewer")).json()["items"][0]
    assert masked["idNumber"] == "••••9012"


# ---- Export --------------------------------------------------------------


def token_of(headers: dict) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


def test_export_is_a_csv_of_what_matches(client, boss, lot, entry):
    lot_id = lot()
    entry(lot_id, farmerName="Asha Devi", idNumber="123456789012")
    entry(lot_id, farmerName="=HYPERLINK(1)")
    entry(lot_id, farmerName="Mohan, Lal")

    reply = client.post("/api/entries/export", data={"token": token_of(boss)})
    assert reply.status_code == 200
    assert reply.headers["content-type"].startswith("text/csv")
    assert "attachment" in reply.headers["content-disposition"]
    text = reply.content.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0].startswith("Received,Filled in,Date,Filled by,Farmer name,")
    assert len(lines) == 4
    assert "123456789012" in text
    assert '"Mohan, Lal"' in text
    # A formula typed as an answer is written as plain text.
    assert "'=HYPERLINK(1)" in text

    one = client.post("/api/entries/export", data={"token": token_of(boss), "q": "asha"})
    assert len(one.text.strip().splitlines()) == 2


def test_export_needs_an_editor(client, staff):
    viewer = staff("viewer")
    assert client.post("/api/entries/export", data={"token": token_of(viewer)}).status_code == 403
    assert client.post("/api/entries/export", data={"token": "made-up"}).status_code == 401
    assert client.post("/api/entries/export", data={}).status_code == 401


# ---- Dashboard numbers ---------------------------------------------------


def test_stats_count_by_day_crop_and_channel(client, boss, lot, entry):
    wheat, rice = lot(), lot(crop="Rice")
    start = dt.datetime(2026, 6, 10, 18, 30)  # midnight in India, as UTC

    entry(wheat, received_at=start - dt.timedelta(days=20))  # long before
    entry(wheat, received_at=start - dt.timedelta(seconds=1))  # the period before
    entry(wheat, received_at=start, channel="Depot")
    entry(wheat, received_at=start + dt.timedelta(hours=23, minutes=59), channel="Depot")
    entry(rice, received_at=start + dt.timedelta(days=1), channel="Depot")
    entry(rice, received_at=start + dt.timedelta(days=2, hours=5), channel="  ")
    entry(rice, received_at=start + dt.timedelta(days=3))  # after the period

    got = client.get(
        "/api/stats", params={"start": "2026-06-10T18:30:00Z", "days": 3}, headers=boss
    ).json()
    assert got["series"] == ["Wheat", "Rice"]
    assert got["previous"] == 1
    assert got["columns"] == [{"Wheat": 2}, {"Rice": 1}, {"Rice": 1}]
    assert got["channels"] == [
        {"name": "Depot", "counts": {"Wheat": 2, "Rice": 1}},
        {"name": "Not given", "counts": {"Rice": 1}},
    ]


def test_stats_in_weeks(client, boss, lot, entry):
    lot_id = lot()
    start = dt.datetime(2026, 6, 1)
    for day in (0, 6, 7, 13):
        entry(lot_id, received_at=start + dt.timedelta(days=day, hours=1))

    got = client.get(
        "/api/stats", params={"start": "2026-06-01T00:00:00Z", "days": 14, "size": 7}, headers=boss
    ).json()
    assert got["columns"] == [{"Wheat": 2}, {"Wheat": 2}]


def test_stats_with_nothing_yet(client, boss):
    got = client.get(
        "/api/stats", params={"start": "2026-06-01T00:00:00Z", "days": 7}, headers=boss
    ).json()
    assert got == {"series": [], "previous": 0, "columns": [{}] * 7, "channels": []}
