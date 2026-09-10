"""Backend tests for Nafis Ride API."""
import requests


# -------------------- Health --------------------
def test_root_ok(api_client, base_url):
    r = api_client.get(f"{base_url}/api/")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("service") == "Nafis Ride API"


# -------------------- Auth: dev-login & /auth/me --------------------
def test_dev_login_mints_token(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/dev-login", json={
        "email": "TEST_devlogin@nafis.dev", "name": "TEST DevLogin"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "session_token" in data and isinstance(data["session_token"], str)
    assert data["user"]["email"] == "test_devlogin@nafis.dev"
    assert "_id" not in data["user"]


def test_dev_login_requires_email(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/dev-login", json={})
    assert r.status_code == 400


def test_auth_me_returns_user(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/dev-login", json={
        "email": "TEST_me@nafis.dev", "name": "TEST Me"
    })
    token = r.json()["session_token"]
    r2 = api_client.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    body = r2.json()
    assert body["user"]["email"] == "test_me@nafis.dev"
    assert "_id" not in body["user"]


def test_auth_me_unauth(api_client, base_url):
    r = api_client.get(f"{base_url}/api/auth/me")
    assert r.status_code == 401
    r2 = api_client.get(f"{base_url}/api/auth/me", headers={"Authorization": "Bearer bogus"})
    assert r2.status_code == 401


# -------------------- Users role --------------------
def test_set_role_rider(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/dev-login", json={
        "email": "TEST_role_rider@nafis.dev", "name": "TEST Role Rider"
    })
    token = r.json()["session_token"]
    h = {"Authorization": f"Bearer {token}"}
    r2 = api_client.post(f"{base_url}/api/users/role", json={"role": "rider"}, headers=h)
    assert r2.status_code == 200
    assert r2.json()["user"]["role"] == "rider"


def test_set_role_captain_auto_approved(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/dev-login", json={
        "email": "TEST_role_cap@nafis.dev", "name": "TEST Role Captain"
    })
    token = r.json()["session_token"]
    h = {"Authorization": f"Bearer {token}"}
    r2 = api_client.post(f"{base_url}/api/users/role", json={"role": "captain"}, headers=h)
    assert r2.status_code == 200
    u = r2.json()["user"]
    assert u["role"] == "captain"
    assert u["captain_status"] == "approved"


# -------------------- Fare config --------------------
def test_get_fare_defaults(api_client, base_url):
    r = api_client.get(f"{base_url}/api/config/fare")
    assert r.status_code == 200
    body = r.json()
    assert "base_fare" in body and "per_km" in body
    # After admin update test, values may differ. We only require presence and numeric.
    assert isinstance(body["base_fare"], (int, float))
    assert isinstance(body["per_km"], (int, float))


# -------------------- Rides lifecycle --------------------
def test_ride_lifecycle(base_url, rider_ctx, captain_ctx):
    rs = rider_ctx["session"]
    cs = captain_ctx["session"]

    # Non-rider (captain) cannot create ride
    bad = cs.post(f"{base_url}/api/rides", json={
        "pickup_address": "A", "pickup": {"lat": 27.5, "lng": 76.6},
        "drop_address": "B", "drop": {"lat": 27.6, "lng": 76.7},
        "vehicle": "Nafis Bike", "distance_km": 5.0, "fare": 55.0,
    })
    assert bad.status_code == 400

    # Rider creates ride
    r = rs.post(f"{base_url}/api/rides", json={
        "pickup_address": "Company Bagh, Alwar",
        "pickup": {"lat": 27.5530, "lng": 76.6346},
        "drop_address": "Moti Doongri, Alwar",
        "drop": {"lat": 27.5730, "lng": 76.6100},
        "vehicle": "Nafis Bike",
        "distance_km": 4.2,
        "fare": 48.6,
    })
    assert r.status_code == 200, r.text
    ride = r.json()["ride"]
    assert ride["status"] == "REQUESTED"
    assert ride["rider_id"] == rider_ctx["user"]["user_id"]
    assert "_id" not in ride
    ride_id = ride["ride_id"]

    # Captain pending rides contains it
    p = cs.get(f"{base_url}/api/rides/pending")
    assert p.status_code == 200
    ids = [x["ride_id"] for x in p.json()["rides"]]
    assert ride_id in ids

    # Rider cannot call pending
    p2 = rs.get(f"{base_url}/api/rides/pending")
    assert p2.status_code == 403

    # Captain accepts
    a = cs.post(f"{base_url}/api/rides/{ride_id}/accept")
    assert a.status_code == 200, a.text
    assert a.json()["ride"]["status"] == "ACCEPTED"
    assert a.json()["ride"]["captain_id"] == captain_ctx["user"]["user_id"]

    # Second accept -> 409
    a2 = cs.post(f"{base_url}/api/rides/{ride_id}/accept")
    assert a2.status_code == 409

    # Update to COMPLETED
    u = cs.post(f"{base_url}/api/rides/{ride_id}/status", json={"status": "COMPLETED"})
    assert u.status_code == 200
    assert u.json()["ride"]["status"] == "COMPLETED"

    # Verify persistence via GET
    g = rs.get(f"{base_url}/api/rides/{ride_id}")
    assert g.status_code == 200
    assert g.json()["ride"]["status"] == "COMPLETED"


def test_ride_status_invalid(base_url, captain_ctx, rider_ctx):
    # create a ride first
    rs = rider_ctx["session"]
    cs = captain_ctx["session"]
    r = rs.post(f"{base_url}/api/rides", json={
        "pickup_address": "P", "pickup": {"lat": 27.5, "lng": 76.6},
        "drop_address": "D", "drop": {"lat": 27.6, "lng": 76.7},
        "vehicle": "Nafis Auto", "distance_km": 3.0, "fare": 39.0,
    })
    ride_id = r.json()["ride"]["ride_id"]
    bad = cs.post(f"{base_url}/api/rides/{ride_id}/status", json={"status": "FOO"})
    assert bad.status_code == 400

    # cancel it
    ok = rs.post(f"{base_url}/api/rides/{ride_id}/status", json={"status": "CANCELLED"})
    assert ok.status_code == 200
    assert ok.json()["ride"]["status"] == "CANCELLED"


# -------------------- Driver Locations --------------------
def test_driver_location_upsert(base_url, captain_ctx, rider_ctx):
    cs = captain_ctx["session"]
    rs = rider_ctx["session"]

    # rider can't post location
    bad = rs.post(f"{base_url}/api/driver-locations", json={"lat": 27.5, "lng": 76.6, "online": True})
    assert bad.status_code == 403

    ok = cs.post(f"{base_url}/api/driver-locations", json={"lat": 27.5530, "lng": 76.6346, "online": True})
    assert ok.status_code == 200
    assert ok.json()["ok"] is True

    lst = requests.get(f"{base_url}/api/driver-locations")
    assert lst.status_code == 200
    locs = lst.json()["locations"]
    ids = [loc["user_id"] for loc in locs]
    assert captain_ctx["user"]["user_id"] in ids


# -------------------- Admin --------------------
def test_admin_claim_and_overview(base_url, admin_ctx, rider_ctx):
    ad = admin_ctx["session"]
    rs = rider_ctx["session"]

    # non-admin -> 403
    r = rs.get(f"{base_url}/api/admin/overview")
    assert r.status_code == 403

    ov = ad.get(f"{base_url}/api/admin/overview")
    assert ov.status_code == 200
    body = ov.json()
    for k in ("riders", "captains", "active_captains", "live_rides", "total_rides"):
        assert k in body and isinstance(body[k], int)


def test_admin_claim_bad_code(base_url):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{base_url}/api/auth/dev-login", json={"email": "TEST_claimbad@nafis.dev", "name": "TEST CB"})
    tok = r.json()["session_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    bad = s.post(f"{base_url}/api/admin/claim", json={"code": "WRONG"})
    assert bad.status_code == 403


def test_admin_fare_update_reflects(base_url, admin_ctx, api_client):
    ad = admin_ctx["session"]
    # set unique values
    new = {"base_fare": 25.0, "per_km": 12.0}
    r = ad.put(f"{base_url}/api/admin/fare", json=new)
    assert r.status_code == 200
    body = r.json()
    assert body["base_fare"] == 25.0 and body["per_km"] == 12.0

    # read back publicly
    r2 = api_client.get(f"{base_url}/api/config/fare")
    assert r2.status_code == 200
    got = r2.json()
    assert got["base_fare"] == 25.0 and got["per_km"] == 12.0

    # restore defaults
    ad.put(f"{base_url}/api/admin/fare", json={"base_fare": 15.0, "per_km": 8.0})


def test_admin_captain_status(base_url, admin_ctx, captain_ctx):
    ad = admin_ctx["session"]
    cid = captain_ctx["user"]["user_id"]

    # block
    r = ad.post(f"{base_url}/api/admin/captains/{cid}/status", json={"status": "blocked"})
    assert r.status_code == 200

    # captain now sees empty pending list (not approved)
    p = captain_ctx["session"].get(f"{base_url}/api/rides/pending")
    assert p.status_code == 200
    assert p.json()["rides"] == []

    # bad status
    bad = ad.post(f"{base_url}/api/admin/captains/{cid}/status", json={"status": "nope"})
    assert bad.status_code == 400

    # restore approved
    ok = ad.post(f"{base_url}/api/admin/captains/{cid}/status", json={"status": "approved"})
    assert ok.status_code == 200


def test_admin_users_and_rides(base_url, admin_ctx):
    ad = admin_ctx["session"]
    u = ad.get(f"{base_url}/api/admin/users")
    assert u.status_code == 200
    assert isinstance(u.json()["users"], list)

    rd = ad.get(f"{base_url}/api/admin/rides")
    assert rd.status_code == 200
    assert isinstance(rd.json()["rides"], list)
