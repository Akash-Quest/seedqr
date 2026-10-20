import datetime as dt

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.database import Base, engine

from .conftest import LOT, sign_in


def test_migrations_make_the_tables_the_models_describe():
    def described(name, kind, _parent):
        # PostgreSQL's search indexes (migration 0004) are not in the models.
        return not (kind == "index" and (name or "").startswith("trgm_"))

    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"include_name": described})
        differences = compare_metadata(context, Base.metadata)
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


def test_adding_the_same_seed_again_gives_the_same_qr_code(client, boss):
    first = client.post("/api/lots", json=LOT, headers=boss).json()
    assert first["existing"] is False

    # Capitals, spacing and the other details do not make it a new lot.
    again = client.post(
        "/api/lots",
        json={**LOT, "crop": " wheat", "variety": "hd  2967", "batchNo": "b-101", "storageLocation": "Shed 9"},
        headers=boss,
    ).json()
    assert again["existing"] is True
    assert again["id"] == first["id"]
    assert again["storageLocation"] == "Shed 1"
    assert len(client.get("/api/lots", headers=boss).json()) == 1

    other = client.post("/api/lots", json={**LOT, "batchNo": "B-102"}, headers=boss).json()
    assert other["existing"] is False
    assert other["id"] != first["id"]

    # A deleted lot's code is retired: the same details then make a new one.
    client.delete(f"/api/lots/{first['id']}", headers=boss)
    fresh = client.post("/api/lots", json=LOT, headers=boss).json()
    assert fresh["existing"] is False
    assert fresh["id"] != first["id"]


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


def test_admin_deletes_an_account(client, boss, staff):
    editor = staff("editor")
    account = next(u for u in client.get("/api/staff", headers=boss).json() if u["role"] == "editor")
    assert client.delete(f"/api/staff/{account['id']}", headers=editor).status_code == 403

    assert client.delete(f"/api/staff/{account['id']}", headers=boss).status_code == 200
    assert [u["username"] for u in client.get("/api/staff", headers=boss).json()] == ["boss"]
    # Signed out at once, and the username and password no longer work.
    assert client.get("/api/lots", headers=editor).status_code == 401
    gone = client.post(
        "/api/login", json={"username": account["username"], "password": "a-good-password"}
    )
    assert gone.status_code == 403
    assert client.delete(f"/api/staff/{account['id']}", headers=boss).status_code == 404


def test_nobody_deletes_their_own_account(client, boss, staff):
    staff("admin", "second-admin")
    me = next(u for u in client.get("/api/staff", headers=boss).json() if u["username"] == "boss")
    assert client.delete(f"/api/staff/{me['id']}", headers=boss).status_code == 400


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


# ---- Import --------------------------------------------------------------

SEED = {"crop": "Paddy", "variety": "Sabour Heera", "batchNo": "SHK0030", "date": "2026-06-02"}


def row(number: int, **changes) -> dict:
    return {"id": f"import-{number:05d}", "farmerName": f"Farmer {number}", "seed": SEED, **changes}


def test_import_makes_the_seed_lot_its_rows_describe(client, boss):
    reply = client.post("/api/entries/import", json=[row(1), row(2)], headers=boss)
    assert reply.json() == {"count": 2, "lotsMade": 1}

    lots = client.get("/api/lots", headers=boss).json()
    assert [(l["crop"], l["variety"], l["batchNo"], l["date"], l["entryCount"]) for l in lots] == [
        ("Paddy", "Sabour Heera", "SHK0030", "2026-06-02", 2)
    ]
    shown = client.get("/api/entries", headers=boss).json()["items"][0]
    assert shown["lotId"] == lots[0]["id"]
    assert shown["lot"]["variety"] == "Sabour Heera"


def test_import_uses_a_lot_that_is_already_there(client, boss, lot):
    lot_id = lot(crop="PADDY", variety="Sabour  Heera", batchNo="shk0030")
    other = {**SEED, "batchNo": "MDK0029"}
    reply = client.post(
        "/api/entries/import", json=[row(1), row(2, seed=other), row(3, lotId=lot_id, seed=None)], headers=boss
    )
    # Capitals and spacing do not make a different seed; another batch does.
    assert reply.json() == {"count": 3, "lotsMade": 1}
    counts = {l["batchNo"]: l["entryCount"] for l in client.get("/api/lots", headers=boss).json()}
    assert counts == {"shk0030": 2, "MDK0029": 1}


def test_import_keeps_the_time_the_file_gives(client, boss):
    client.post(
        "/api/entries/import",
        json=[row(1, receivedAt="2026-06-27T11:03:00+05:30"), row(2)],
        headers=boss,
    )
    found = client.get(
        "/api/entries", params={"from": "2026-06-27T05:33:00Z", "to": "2026-06-27T05:34:00Z"}, headers=boss
    ).json()
    assert [e["farmerName"] for e in found["items"]] == ["Farmer 1"]
    assert found["items"][0]["receivedAt"] == "2026-06-27T05:33:00Z"


def test_importing_the_same_rows_again_adds_nothing(client, boss):
    rows = [row(1), row(2), row(2)]
    assert client.post("/api/entries/import", json=rows, headers=boss).json()["count"] == 2
    again = client.post("/api/entries/import", json=[*rows, row(3)], headers=boss).json()
    assert again == {"count": 1, "lotsMade": 0}
    assert client.get("/api/entries", headers=boss).json()["total"] == 3


def test_import_saves_all_of_a_call_or_none(client, boss):
    bad = [row(1), row(2, seed=None)]
    reply = client.post("/api/entries/import", json=bad, headers=boss)
    assert reply.status_code == 400
    assert client.get("/api/entries", headers=boss).json()["total"] == 0
    assert client.get("/api/lots", headers=boss).json() == []
    unknown = client.post("/api/entries/import", json=[row(1, lotId="NOSUCH11", seed=None)], headers=boss)
    assert unknown.status_code == 400


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


# ---- Correcting an entry -------------------------------------------------

CHANGE = {"filledBy": "Field officer", "farmerName": "Asha Devi", "contact": "9876543210",
          "kycType": "Aadhaar ID", "idNumber": "123456789012", "channel": "Depot", "quantity": "2KG"}


def test_an_editor_corrects_an_entry(client, boss, staff, lot, entry):
    lot_id = lot()
    entry_id = entry(lot_id, farmerName="Asha Dvi", received_at=dt.datetime(2026, 6, 10, 12, 0))
    before = client.get("/api/entries", headers=boss).json()["items"][0]
    assert before["updatedAt"] is None

    reply = client.put(f"/api/entries/{entry_id}", json=CHANGE, headers=staff("editor"))
    assert reply.status_code == 200
    after = client.get("/api/entries", headers=boss).json()["items"][0]
    assert after["farmerName"] == "Asha Devi"
    assert after["contact"] == "9876543210"
    assert after["idNumber"] == "123456789012"
    assert after["filledBy"] == "Field officer"
    # Who corrected it is recorded; where it came from is untouched.
    assert after["updatedBy"] == "editor-one"
    assert after["updatedAt"]
    assert after["lotId"] == lot_id
    assert after["receivedAt"] == before["receivedAt"] == "2026-06-10T12:00:00Z"
    assert client.get("/api/entries", params={"q": "asha devi"}, headers=boss).json()["total"] == 1


def test_a_correction_is_checked_like_a_new_entry(client, boss, staff, lot, entry):
    entry_id = entry(lot())
    assert client.put(f"/api/entries/{entry_id}", json=CHANGE, headers=staff("viewer")).status_code == 403
    assert client.put(f"/api/entries/{entry_id}", json=CHANGE).status_code == 401
    nameless = client.put(f"/api/entries/{entry_id}", json={**CHANGE, "farmerName": " "}, headers=boss)
    assert nameless.status_code == 400
    assert client.put("/api/entries/no-such-entry", json=CHANGE, headers=boss).status_code == 404
    assert client.get("/api/entries", headers=boss).json()["items"][0]["farmerName"] == "Farmer 1"


def test_an_editor_deletes_an_entry(client, boss, staff, lot, entry):
    lot_id = lot()
    keep, drop = entry(lot_id), entry(lot_id)
    assert client.delete(f"/api/entries/{drop}", headers=staff("viewer")).status_code == 403
    assert client.delete(f"/api/entries/{drop}").status_code == 401

    assert client.delete(f"/api/entries/{drop}", headers=staff("editor")).status_code == 200
    left = client.get("/api/entries", headers=boss).json()
    assert [e["id"] for e in left["items"]] == [keep]
    assert client.get("/api/lots", headers=boss).json()[0]["entryCount"] == 1
    assert client.delete(f"/api/entries/{drop}", headers=boss).status_code == 404


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
    assert got["lotCount"] == 2
    assert got["columns"] == [{"Wheat": 2}, {"Rice": 1}, {"Rice": 1}]
    assert got["channels"] == [
        {"name": "Depot", "counts": {"Wheat": 2, "Rice": 1}},
        {"name": "Not given", "counts": {"Rice": 1}},
    ]


def test_seasons_have_the_offices_dates():
    from app.seasons import occurrences

    # Every season of every crop year asked for, newest first. A crop year
    # begins with Kharif; its Garma is in the next calendar year.
    found = occurrences(2025, 2026)
    assert [(label, begin, finish) for _, label, begin, finish in found] == [
        ("Garma 2026–27", dt.date(2027, 2, 10), dt.date(2027, 5, 12)),
        ("Rabi 2026–27", dt.date(2026, 10, 15), dt.date(2027, 1, 10)),
        ("Kharif 2026–27", dt.date(2026, 5, 13), dt.date(2026, 8, 10)),
        ("Garma 2025–26", dt.date(2026, 2, 10), dt.date(2026, 5, 12)),
        ("Rabi 2025–26", dt.date(2025, 10, 15), dt.date(2026, 1, 10)),
        ("Kharif 2025–26", dt.date(2025, 5, 13), dt.date(2025, 8, 10)),
    ]


def test_seasons_count_their_entries_on_the_offices_clock(client, boss, lot, entry):
    lot_id = lot()
    utc = dt.datetime
    entry(lot_id, received_at=utc(2025, 10, 14, 18, 29))  # 14 Oct, 23:59 in India
    entry(lot_id, received_at=utc(2025, 10, 14, 18, 30))  # 15 Oct, Rabi begins
    entry(lot_id, received_at=utc(2026, 1, 10, 18, 29))  # 10 Jan, 23:59: still Rabi
    entry(lot_id, received_at=utc(2026, 1, 10, 18, 30))  # 11 Jan: no season
    entry(lot_id, received_at=utc(2026, 5, 12, 12, 0))  # Garma's last day
    entry(lot_id, received_at=utc(2026, 5, 13, 12, 0))  # Kharif's first

    got = client.get("/api/seasons", params={"tz": 330}, headers=boss).json()
    by_label = {season["label"]: season for season in got}
    assert by_label["Rabi 2025–26"] == {
        "season": "Rabi", "label": "Rabi 2025–26", "start": "2025-10-15", "end": "2026-01-10",
        "entries": 2,
    }
    assert by_label["Garma 2025–26"]["entries"] == 1
    assert by_label["Kharif 2026–27"]["entries"] == 1
    # Newest first, and every season of every crop year listed, entries or not.
    assert [season["start"] for season in got] == sorted((s["start"] for s in got), reverse=True)
    assert by_label["Kharif 2025–26"]["entries"] == 0
    assert "Rabi 2024–25" not in by_label
    assert "Garma 2024–25" not in by_label

    assert client.get("/api/seasons").status_code == 401


def test_a_season_counts_its_days_in_every_year(client, boss, lot, entry):
    lot_id = lot()
    utc = dt.datetime
    entry(lot_id, received_at=utc(2024, 6, 1, 12), channel="Depot")  # Kharif 2024
    entry(lot_id, received_at=utc(2025, 8, 10, 18, 29), channel="Shop")  # 10 Aug, 23:59 in India
    entry(lot_id, received_at=utc(2025, 8, 10, 18, 30), channel="Shop")  # 11 Aug: no season
    entry(lot_id, received_at=utc(2025, 12, 31, 12), channel="Depot")  # Rabi, before the new year
    entry(lot_id, received_at=utc(2026, 1, 5, 12), channel="Depot")  # Rabi, after it
    entry(lot_id, received_at=utc(2026, 3, 1, 12), channel="Depot")  # Garma

    def total(season):
        params = {
            "start": "2024-01-01T00:00:00Z", "days": 1000, "size": 30, "tz": 330, "season": season,
        }
        got = client.get("/api/stats", params=params, headers=boss).json()
        return sum(n for column in got["columns"] for n in column.values())

    assert total("Kharif") == 2
    assert total("rabi") == 2
    assert total("Garma") == 1

    channels = client.get(
        "/api/channels", params={"season": "Kharif", "tz": 330}, headers=boss
    ).json()
    assert [(c["name"], sum(c["counts"].values())) for c in channels["channels"]] == [
        ("Depot", 1), ("Shop", 1),
    ]

    params = {"start": "2024-01-01T00:00:00Z", "days": 7, "season": "Monsoon"}
    assert client.get("/api/stats", params=params, headers=boss).status_code == 400


def test_every_channel_is_listed_busiest_first(client, boss, staff, lot, entry):
    wheat, rice = lot(crop="WHEAT"), lot(crop="Rice")
    start = dt.datetime(2026, 6, 10)
    # Wheat first, so it is first in the series (the same time would tie).
    entry(wheat, received_at=start, channel="Shop")
    entry(rice, received_at=start + dt.timedelta(hours=1), channel="Depot")
    entry(wheat, received_at=start + dt.timedelta(days=1), channel="Depot")
    entry(rice, received_at=start + dt.timedelta(days=2), channel=" Depot ")
    entry(rice, received_at=start + dt.timedelta(days=5), channel="Market")

    got = client.get("/api/channels", headers=boss).json()
    assert got["series"] == ["Wheat", "Rice"]
    assert got["total"] == 5
    assert got["channels"] == [
        {"name": "Depot", "counts": {"Rice": 2, "Wheat": 1}},
        {"name": "Market", "counts": {"Rice": 1}},
        {"name": "Shop", "counts": {"Wheat": 1}},
    ]

    # Only the entries between two times, the second not included.
    params = {"from": "2026-06-10T00:00:00Z", "to": "2026-06-11T00:00:00Z"}
    between = client.get("/api/channels", params=params, headers=boss).json()
    assert between["total"] == 2
    assert [c["name"] for c in between["channels"]] == ["Depot", "Shop"]

    assert client.get("/api/channels", headers=staff("viewer")).status_code == 200
    assert client.get("/api/channels").status_code == 401


def test_stats_in_weeks(client, boss, lot, entry):
    lot_id = lot()
    start = dt.datetime(2026, 6, 1)
    for day in (0, 6, 7, 13):
        entry(lot_id, received_at=start + dt.timedelta(days=day, hours=1))

    got = client.get(
        "/api/stats",
        params={"start": "2026-06-01T00:00:00Z", "days": 14, "size": 7, "by": "crop"},
        headers=boss,
    ).json()
    assert got["columns"] == [{"Wheat": 2}, {"Wheat": 2}]


def test_stats_of_one_crop_are_split_by_variety(client, boss, lot, entry):
    sona, heera = lot(variety="Sona"), lot(variety="Heera", batchNo="B-102")
    start = dt.datetime(2026, 6, 1)
    entry(sona, received_at=start + dt.timedelta(hours=1), channel="Depot")
    entry(heera, received_at=start + dt.timedelta(hours=2), channel="Depot")
    entry(heera, received_at=start + dt.timedelta(days=1), channel="Shop")
    params = {"start": "2026-06-01T00:00:00Z", "days": 2}

    # Everything is wheat, so a split by crop would be one colour.
    got = client.get("/api/stats", params=params, headers=boss).json()
    assert got["by"] == "variety"
    assert got["series"] == ["Sona", "Heera"]
    assert got["columns"] == [{"Sona": 1, "Heera": 1}, {"Heera": 1}]
    assert got["channels"][0] == {"name": "Depot", "counts": {"Sona": 1, "Heera": 1}}
    assert got["channelCount"] == 2
    assert (got["first"], got["last"]) == ("2026-06-01T01:00:00Z", "2026-06-02T00:00:00Z")
    # The varieties are the series already.
    assert got["varieties"] == {}

    asked = client.get("/api/stats", params={**params, "by": "crop"}, headers=boss).json()
    assert (asked["by"], asked["series"]) == ("crop", ["Wheat"])
    # Each crop's varieties, largest first, for when its name is pointed at.
    assert list(asked["varieties"]["Wheat"].items()) == [("Heera", 2), ("Sona", 1)]
    # A second crop makes the split by crop worth showing again.
    entry(lot(crop="Rice"), received_at=start + dt.timedelta(hours=3))
    mixed = client.get("/api/stats", params=params, headers=boss).json()
    assert (mixed["by"], mixed["series"]) == ("crop", ["Wheat", "Rice"])


def test_stats_with_nothing_yet(client, boss):
    got = client.get(
        "/api/stats", params={"start": "2026-06-01T00:00:00Z", "days": 7}, headers=boss
    ).json()
    assert got == {
        "series": [], "by": "crop", "first": None, "last": None, "channelCount": 0,
        "lotCount": 0, "varieties": {}, "previous": 0, "columns": [{}] * 7, "channels": [],
        "kpis": {
            "farmers": 0, "repeatFarmers": 0, "withId": 0, "withContact": 0,
            "byOfficer": 0, "devices": 0,
        },
        "lots": {"total": 0, "unused": 0, "waiting": []},
        "latest": [],
    }


def test_stats_say_when_the_first_entry_came_in(client, boss, lot, entry):
    lot_id = lot()
    entry(lot_id, received_at=dt.datetime(2026, 6, 10, 9, 0))
    entry(lot_id, received_at=dt.datetime(2025, 1, 5, 18, 31))  # "all time" starts here
    params = {"start": "2026-06-01T00:00:00Z", "days": 7}
    assert client.get("/api/stats", params=params, headers=boss).json()["first"] == "2025-01-05T18:31:00Z"

    # All time is drawn in wider columns: here two of 365 days.
    wide = client.get(
        "/api/stats",
        params={"start": "2024-06-11T00:00:00Z", "days": 730, "size": 365, "by": "crop"},
        headers=boss,
    ).json()
    assert wide["columns"] == [{"Wheat": 1}, {"Wheat": 1}]
    too_many = client.get(
        "/api/stats", params={"start": "2020-01-01T00:00:00Z", "days": 3000}, headers=boss
    )
    assert too_many.status_code == 400
