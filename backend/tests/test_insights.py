"""The dashboard's insights: everything it shows comes in one answer."""

import datetime as dt

from .conftest import LOT


def test_the_period_in_numbers(client, boss, lot, entry):
    wheat, rice = lot(), lot(crop="Rice", batchNo="R-1")
    lot(crop="Maize", batchNo="M-1")  # nobody has scanned this one
    start = dt.datetime(2026, 6, 10, 18, 30)  # midnight in India, as UTC

    entry(wheat, received_at=start - dt.timedelta(hours=1), contact="9000000001")  # before
    entry(wheat, received_at=start + dt.timedelta(hours=2), contact="9000000001",
          idNumber="123456789012", kycType="Aadhaar ID", deviceId="phone-a")
    entry(wheat, received_at=start + dt.timedelta(hours=3), contact="9000000001",
          filledBy="Field officer", deviceId="phone-a")
    entry(rice, received_at=start + dt.timedelta(days=1, hours=5), contact="9000000002",
          deviceId="phone-b", farmerName="Newest")
    entry(rice, received_at=start + dt.timedelta(days=1, hours=4))

    got = client.get(
        "/api/stats",
        params={"start": "2026-06-10T18:30:00Z", "days": 2, "tz": 330},
        headers=boss,
    ).json()
    assert got["previous"] == 1
    assert got["kpis"] == {
        "farmers": 2, "repeatFarmers": 1, "withId": 1, "withContact": 3,
        "byOfficer": 1, "devices": 2,
    }
    assert got["lots"]["total"] == 3
    assert got["lots"]["unused"] == 1
    assert [w["crop"] for w in got["lots"]["waiting"]] == ["Maize"]
    latest = got["latest"]
    assert [e["farmerName"] for e in latest][0] == "Newest"
    assert latest[0]["crop"] == "Rice"
    assert latest[0]["receivedAt"] == "2026-06-11T23:30:00Z"
    assert len(latest) == 4


def test_adding_the_same_seed_finds_it_among_many(client, boss):
    # The same seed is found by its key, not by reading every lot.
    for n in range(30):
        client.post("/api/lots", json={**LOT, "batchNo": f"B-{n}"}, headers=boss)
    again = client.post("/api/lots", json={**LOT, "batchNo": " b-17 "}, headers=boss).json()
    assert again["existing"] is True
    assert again["batchNo"] == "B-17"
