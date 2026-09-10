"""Backend tests for Nafis Ride digest feature + regression on core endpoints."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rideshare-mvp-21.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ------------------ helpers ------------------
def dev_login(email: str, name: str = "T") -> dict:
    r = requests.post(f"{API}/auth/dev-login", json={"email": email, "name": name}, timeout=20)
    assert r.status_code == 200, f"dev-login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def set_role(token: str, role: str) -> dict:
    r = requests.post(f"{API}/users/role",
                      headers={"Authorization": f"Bearer {token}"},
                      json={"role": role}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["user"]


@pytest.fixture(scope="module")
def admin():
    """Admin session token + user."""
    d = dev_login("admin@nafisride.local", "Admin")
    assert d["user"].get("is_admin") is True
    return d


@pytest.fixture(scope="module")
def rider():
    tag = uuid.uuid4().hex[:6]
    email = f"TEST_rider_{tag}@example.com"
    d = dev_login(email, f"TestRider{tag}")
    u = set_role(d["session_token"], "rider")
    return {"token": d["session_token"], "user": u, "email": email}


@pytest.fixture(scope="module")
def captain():
    tag = uuid.uuid4().hex[:6]
    email = f"TEST_captain_{tag}@example.com"
    d = dev_login(email, f"TestCap{tag}")
    u = set_role(d["session_token"], "captain")
    return {"token": d["session_token"], "user": u, "email": email}


def _make_ride(rider_token: str) -> dict:
    body = {
        "pickup_address": "Alwar station",
        "pickup": {"lat": 27.55, "lng": 76.60},
        "drop_address": "City Mall",
        "drop": {"lat": 27.56, "lng": 76.62},
        "vehicle": "Nafis Auto",
        "distance_km": 3.2,
        "fare": 42.0,
    }
    r = requests.post(f"{API}/rides",
                      headers={"Authorization": f"Bearer {rider_token}"},
                      json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["ride"]


@pytest.fixture(scope="module")
def seeded_completed_ride(rider, captain, admin):
    """Create a ride, accept it, then admin force-complete it."""
    ride = _make_ride(rider["token"])
    # Captain accepts
    r = requests.post(f"{API}/rides/{ride['ride_id']}/accept",
                      headers={"Authorization": f"Bearer {captain['token']}"}, timeout=20)
    assert r.status_code == 200, r.text
    # Admin force-completes to skip simulation timing
    r = requests.post(f"{API}/admin/rides/{ride['ride_id']}/force-complete",
                      headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=20)
    assert r.status_code == 200, r.text
    completed = r.json()["ride"]
    assert completed["status"] == "COMPLETED"
    return completed


# ============ Auth guards ============
class TestAuthGuards:
    def test_send_missing_token_401(self):
        r = requests.post(f"{API}/admin/digest/send", timeout=20)
        assert r.status_code == 401

    def test_send_non_admin_403(self, rider):
        r = requests.post(f"{API}/admin/digest/send",
                          headers={"Authorization": f"Bearer {rider['token']}"}, timeout=20)
        assert r.status_code == 403

    def test_preview_non_admin_403(self, rider):
        r = requests.post(f"{API}/admin/digest/preview",
                          headers={"Authorization": f"Bearer {rider['token']}"},
                          json={"kind": "admin"}, timeout=20)
        assert r.status_code == 403

    def test_test_send_non_admin_403(self, rider):
        r = requests.post(f"{API}/admin/digest/test-send",
                          headers={"Authorization": f"Bearer {rider['token']}"},
                          json={"to": "delivered@resend.dev"}, timeout=20)
        assert r.status_code == 403

    def test_runs_non_admin_403(self, rider):
        r = requests.get(f"{API}/admin/digest/runs",
                         headers={"Authorization": f"Bearer {rider['token']}"}, timeout=20)
        assert r.status_code == 403


# ============ Preview ============
class TestPreview:
    def test_preview_admin(self, admin, seeded_completed_ride):
        r = requests.post(f"{API}/admin/digest/preview",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"kind": "admin"}, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["subject"] and j["html"] and j["data"]
        assert j["data"]["rides"] >= 1
        assert j["data"]["revenue"] >= seeded_completed_ride["fare"]

    def test_preview_rider(self, admin, rider, seeded_completed_ride):
        r = requests.post(f"{API}/admin/digest/preview",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"kind": "rider", "email": rider["email"]}, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["subject"] and j["html"] and j["data"]
        assert j["data"]["rides"] >= 1
        assert j["data"]["spend"] >= seeded_completed_ride["fare"]

    def test_preview_captain(self, admin, captain, seeded_completed_ride):
        r = requests.post(f"{API}/admin/digest/preview",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"kind": "captain", "email": captain["email"]}, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["data"]["rides"] >= 1
        assert j["data"]["earnings"] >= seeded_completed_ride["fare"]

    def test_preview_unknown_email(self, admin):
        r = requests.post(f"{API}/admin/digest/preview",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"kind": "rider", "email": "nobody-xyz@example.com"}, timeout=20)
        assert r.status_code == 404

    def test_preview_unknown_kind(self, admin):
        r = requests.post(f"{API}/admin/digest/preview",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"kind": "nonsense"}, timeout=20)
        # Pydantic Literal rejects with 422
        assert r.status_code in (404, 422)


# ============ Test-send ============
class TestTestSend:
    def test_test_send_ok(self, admin):
        r = requests.post(f"{API}/admin/digest/test-send",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"to": "delivered@resend.dev"}, timeout=45)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j.get("email_id"), f"Missing email_id: {j}"

    def test_test_send_bad_email(self, admin):
        r = requests.post(f"{API}/admin/digest/test-send",
                          headers={"Authorization": f"Bearer {admin['session_token']}"},
                          json={"to": "not-an-email"}, timeout=20)
        assert r.status_code == 400


# ============ Send + Runs ============
class TestSendAndRuns:
    def test_send_full(self, admin, seeded_completed_ride):
        # Seed extra rider + captain with completed rides
        r2 = dev_login(f"TEST_r2_{uuid.uuid4().hex[:5]}@example.com", "R2")
        set_role(r2["session_token"], "rider")
        c2 = dev_login(f"TEST_c2_{uuid.uuid4().hex[:5]}@example.com", "C2")
        set_role(c2["session_token"], "captain")
        ride = _make_ride(r2["session_token"])
        requests.post(f"{API}/rides/{ride['ride_id']}/accept",
                      headers={"Authorization": f"Bearer {c2['session_token']}"}, timeout=20)
        requests.post(f"{API}/admin/rides/{ride['ride_id']}/force-complete",
                      headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=20)

        r = requests.post(f"{API}/admin/digest/send",
                          headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=90)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        s = j["summary"]
        for k in ("riders", "captains", "admins", "skipped", "failed"):
            assert k in s
        # Synthetic domains should fail (expected)
        assert s["failed"] > 0, f"Expected failed>0 for synthetic domains: {s}"

    def test_runs_list(self, admin):
        r = requests.get(f"{API}/admin/digest/runs",
                         headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "runs" in j
        assert len(j["runs"]) >= 1
        run = j["runs"][0]
        for k in ("run_at", "riders", "captains", "admins", "failed"):
            assert k in run


# ============ Regression: existing endpoints ============
class TestExistingEndpoints:
    def test_auth_me(self, admin):
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "admin@nafisride.local"

    def test_rides_create_regression(self, rider):
        ride = _make_ride(rider["token"])
        assert ride["status"] == "REQUESTED"
        assert ride["fare"] == 42.0

    def test_rides_pending_for_captain(self, captain):
        r = requests.get(f"{API}/rides/pending",
                         headers={"Authorization": f"Bearer {captain['token']}"}, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json().get("rides"), list)

    def test_admin_overview(self, admin):
        r = requests.get(f"{API}/admin/overview",
                         headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=20)
        assert r.status_code == 200
        j = r.json()
        for k in ("riders", "captains", "total_rides", "completed_rides", "total_revenue"):
            assert k in j

    def test_admin_revenue_weekly(self, admin):
        r = requests.get(f"{API}/admin/revenue/weekly",
                         headers={"Authorization": f"Bearer {admin['session_token']}"}, timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j["days"], list) and len(j["days"]) == 7
