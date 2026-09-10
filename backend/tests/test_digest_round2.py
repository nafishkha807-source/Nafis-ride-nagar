"""Round-2 digest tests: preview auto-pick, leaderboard credits, captain streak bonus.

Focuses only on the new behavior. Round-1 endpoints are only smoke-tested.
"""
import os
import uuid
import pytest
import requests
import zoneinfo
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rideshare-mvp-21.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

IST = zoneinfo.ZoneInfo("Asia/Kolkata")


# ---------------- helpers ----------------
def _current_week_key() -> str:
    now_ist = datetime.now(IST)
    y, w, _ = now_ist.isocalendar()
    return f"{y}-W{w:02d}"


def dev_login(email, name="T"):
    r = requests.post(f"{API}/auth/dev-login", json={"email": email, "name": name}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def set_role(token, role):
    r = requests.post(
        f"{API}/users/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": role}, timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["user"]


def get_me(token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["user"]


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin():
    d = dev_login("admin@nafisride.local", "Admin")
    assert d["user"].get("is_admin") is True
    return d


def _reset_week_flags(mongo, user_ids):
    """Clear last_leaderboard_week / last_streak_week for a fresh run."""
    if not user_ids:
        return
    mongo.users.update_many(
        {"user_id": {"$in": list(user_ids)}},
        {"$unset": {"last_leaderboard_week": "", "last_streak_week": ""}},
    )


def _seed_completed_ride(mongo, rider_id, captain_id, fare, completed_at_utc):
    """Insert a completed ride directly."""
    ride = {
        "ride_id": f"ride_{uuid.uuid4().hex[:12]}",
        "rider_id": rider_id,
        "rider_name": "Seed",
        "captain_id": captain_id,
        "captain_name": "Cap",
        "pickup_address": "A",
        "pickup": {"lat": 27.55, "lng": 76.60},
        "drop_address": "B",
        "drop": {"lat": 27.56, "lng": 76.62},
        "vehicle": "Nafis Auto",
        "distance_km": 2.0,
        "fare": float(fare),
        "status": "COMPLETED",
        "completed_at": completed_at_utc,
        "created_at": completed_at_utc,
        "updated_at": completed_at_utc,
    }
    mongo.rides.insert_one(ride)
    return ride["ride_id"]


# ============ Preview auto-pick + no-credit-grant ============
class TestPreviewAutoPick:
    def test_preview_admin_no_target_email(self, admin):
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"kind": "admin"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["subject"] and j["html"] and j["data"]
        assert j.get("target_email") is None
        # New fields on admin
        assert "leaderboard" in j["data"] and isinstance(j["data"]["leaderboard"], list)
        assert "streaking_captains" in j["data"] and isinstance(j["data"]["streaking_captains"], list)

    def test_preview_rider_auto_pick(self, admin, mongo):
        # Ensure at least one rider exists
        r_tok = dev_login(f"TEST_rprev_{uuid.uuid4().hex[:5]}@example.com", "RPrev")
        set_role(r_tok["session_token"], "rider")
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"kind": "rider"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("target_email"), "rider preview must include target_email"
        assert "leaderboard" in j["data"]
        assert "my_rank" in j["data"]
        assert "my_boost" in j["data"]

    def test_preview_captain_auto_pick(self, admin, mongo):
        c_tok = dev_login(f"TEST_cprev_{uuid.uuid4().hex[:5]}@example.com", "CPrev")
        set_role(c_tok["session_token"], "captain")
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"kind": "captain"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("target_email"), "captain preview must include target_email"
        assert "streak_days" in j["data"]
        assert "streak_eligible" in j["data"]
        assert "streak_bonus" in j["data"]

    def test_preview_does_not_grant_credits(self, admin, mongo):
        # Create a fresh rider, snapshot credits, hit preview 5 times, assert unchanged.
        email = f"TEST_nocredit_{uuid.uuid4().hex[:5]}@example.com"
        d = dev_login(email, "NoCredit")
        set_role(d["session_token"], "rider")
        u_before = get_me(d["session_token"])
        credits_before = float(u_before.get("credits") or 0)
        for _ in range(5):
            r = requests.post(
                f"{API}/admin/digest/preview",
                headers={"Authorization": f"Bearer {admin['session_token']}"},
                json={"kind": "rider", "email": email}, timeout=30,
            )
            assert r.status_code == 200, r.text
        u_after = get_me(d["session_token"])
        credits_after = float(u_after.get("credits") or 0)
        assert credits_after == credits_before, (
            f"Preview must not grant credits — before={credits_before}, after={credits_after}"
        )
        # And the week flag should not have been set by preview
        udoc = mongo.users.find_one({"user_id": u_after["user_id"]})
        assert udoc.get("last_leaderboard_week") is None


# ============ Rider Leaderboard grant + idempotency ============
class TestLeaderboardGrant:
    @pytest.fixture(scope="class")
    def three_riders(self, mongo):
        """Create 3 riders + 1 captain with distinct weekly spend."""
        cap = dev_login(f"TEST_lbcap_{uuid.uuid4().hex[:5]}@example.com", "LBCap")
        set_role(cap["session_token"], "captain")
        cap_id = cap["user"]["user_id"]

        riders = []
        spends = [200.0, 150.0, 100.0]
        now = datetime.now(timezone.utc) - timedelta(hours=2)
        # Clear prior test rides that could shift leaderboard: not needed —
        # we use unusually large distinct fares so ranking is deterministic
        # among freshly-seeded users. But the leaderboard only returns top 3
        # across ALL riders — so pre-existing spend could outrank us.
        # To be safe, purge any prior TEST_lb rides in this week's window and
        # bump our fares high enough.
        # We'll assert on the presence + our credits, and on granted count relative delta.
        for i, spend in enumerate(spends):
            email = f"TEST_lb{i}_{uuid.uuid4().hex[:5]}@example.com"
            d = dev_login(email, f"LB{i}")
            set_role(d["session_token"], "rider")
            uid = d["user"]["user_id"]
            _seed_completed_ride(mongo, uid, cap_id, spend, now - timedelta(minutes=i))
            u_fresh = get_me(d["session_token"])
            riders.append({
                "email": email,
                "token": d["session_token"],
                "user_id": uid,
                "expected_spend": spend,
                "credits_before": float(u_fresh.get("credits") or 0),
            })
        return {"riders": riders, "captain_id": cap_id}

    def test_leaderboard_grants_top3(self, admin, mongo, three_riders):
        rider_ids = [r["user_id"] for r in three_riders["riders"]]
        # Ensure no prior grant this week for these riders
        _reset_week_flags(mongo, rider_ids)

        # To ensure our 3 are the top 3 for this week, bump their fares so they
        # dominate any other TEST_* ride currently in the window.
        # (Already 200/150/100 which should dominate 42.0 rides from round-1 fixture.)

        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        # All 7 keys must be present (regression)
        for k in ("riders", "captains", "admins", "skipped", "failed",
                  "leaderboard_granted", "streak_granted"):
            assert k in s, f"missing key {k} in summary {s}"

        # Query DB directly to see which riders got the leaderboard grant this week
        week_key = _current_week_key()
        granted_docs = list(mongo.users.find(
            {"user_id": {"$in": rider_ids}, "last_leaderboard_week": week_key},
            {"_id": 0, "user_id": 1, "last_leaderboard_rank": 1,
             "last_leaderboard_credit": 1, "credits": 1},
        ))
        # All three of our seeded riders should have been credited (they have highest weekly spend)
        assert len(granted_docs) == 3, (
            f"Expected all 3 seeded riders to receive leaderboard credit; got {granted_docs}. "
            f"summary={s}"
        )
        # Map user_id -> rank/credit
        by_uid = {d["user_id"]: d for d in granted_docs}
        expected_credits = {1: 100.0, 2: 75.0, 3: 50.0}
        for rd in three_riders["riders"]:
            uid = rd["user_id"]
            info = by_uid[uid]
            rank = info["last_leaderboard_rank"]
            got_credit = info["last_leaderboard_credit"]
            assert got_credit == expected_credits[rank], (
                f"rider {uid} rank={rank} credit={got_credit} expected={expected_credits[rank]}"
            )
            # And total credits went up by that credit amount
            delta = float(info["credits"]) - rd["credits_before"]
            assert abs(delta - expected_credits[rank]) < 0.01, (
                f"rider {uid} credit delta={delta} expected={expected_credits[rank]}"
            )
        # Ranking should follow spend: 200 -> #1, 150 -> #2, 100 -> #3
        rank_by_spend = {rd["expected_spend"]: by_uid[rd["user_id"]]["last_leaderboard_rank"]
                          for rd in three_riders["riders"]}
        assert rank_by_spend[200.0] == 1
        assert rank_by_spend[150.0] == 2
        assert rank_by_spend[100.0] == 3

    def test_leaderboard_idempotent(self, admin, mongo, three_riders):
        rider_ids = [r["user_id"] for r in three_riders["riders"]]
        # Snapshot credits AFTER first grant
        snap = {
            d["user_id"]: float(d.get("credits") or 0)
            for d in mongo.users.find({"user_id": {"$in": rider_ids}},
                                       {"_id": 0, "user_id": 1, "credits": 1})
        }
        # Re-run send immediately — same week => no re-grant
        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        assert s["leaderboard_granted"] == 0, (
            f"Expected leaderboard_granted=0 on re-run, got {s['leaderboard_granted']}"
        )
        # Credits unchanged
        after = {
            d["user_id"]: float(d.get("credits") or 0)
            for d in mongo.users.find({"user_id": {"$in": rider_ids}},
                                       {"_id": 0, "user_id": 1, "credits": 1})
        }
        for uid, before_c in snap.items():
            assert abs(after[uid] - before_c) < 0.01, (
                f"credits changed on idempotent re-run for {uid}: before={before_c} after={after[uid]}"
            )


# ============ Captain streak grant + idempotency + <5 no-grant ============
class TestCaptainStreak:
    def _seed_streak(self, mongo, captain_id, days: int):
        """Insert `days` consecutive daily completed rides ending today IST."""
        today_ist = datetime.now(IST).date()
        for i in range(days):
            d = today_ist - timedelta(days=i)
            # 12:00 IST on that date, converted to UTC
            dt_ist = datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=IST)
            dt_utc = dt_ist.astimezone(timezone.utc)
            _seed_completed_ride(mongo, f"seedrider_{uuid.uuid4().hex[:6]}", captain_id,
                                 50.0, dt_utc)

    def test_streak_5days_grants_200(self, admin, mongo):
        email = f"TEST_streak_{uuid.uuid4().hex[:5]}@example.com"
        d = dev_login(email, "StreakCap")
        set_role(d["session_token"], "captain")
        cap_id = d["user"]["user_id"]
        _reset_week_flags(mongo, [cap_id])

        u_before = get_me(d["session_token"])
        credits_before = float(u_before.get("credits") or 0)

        self._seed_streak(mongo, cap_id, days=5)

        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        assert s["streak_granted"] >= 1, f"streak_granted should be >=1: {s}"

        u_after = mongo.users.find_one({"user_id": cap_id})
        credits_after = float(u_after.get("credits") or 0)
        assert abs((credits_after - credits_before) - 200.0) < 0.01, (
            f"Expected +₹200 streak bonus; before={credits_before} after={credits_after}"
        )
        assert u_after.get("last_streak_week") == _current_week_key()

        # Idempotency: re-run
        r2 = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        s2 = r2.json()["summary"]
        u_after2 = mongo.users.find_one({"user_id": cap_id})
        assert float(u_after2.get("credits") or 0) == credits_after, (
            "Streak bonus must not be granted twice in the same week"
        )
        # streak_granted for THIS captain must be 0 — since other captains may exist,
        # we assert credits unchanged (above) which is the ground truth.
        # Also verify no additional flag change:
        assert u_after2.get("last_streak_week") == _current_week_key()
        # If no other captain is eligible we expect s2['streak_granted'] == 0
        # (weak assertion — just log)
        assert isinstance(s2["streak_granted"], int)

    def test_streak_4days_no_grant(self, admin, mongo):
        email = f"TEST_short_{uuid.uuid4().hex[:5]}@example.com"
        d = dev_login(email, "ShortCap")
        set_role(d["session_token"], "captain")
        cap_id = d["user"]["user_id"]
        _reset_week_flags(mongo, [cap_id])

        u_before = get_me(d["session_token"])
        credits_before = float(u_before.get("credits") or 0)

        # 4 consecutive days only
        self._seed_streak(mongo, cap_id, days=4)

        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        u_after = mongo.users.find_one({"user_id": cap_id})
        credits_after = float(u_after.get("credits") or 0)
        assert credits_after == credits_before, (
            f"Captain with 4-day streak must NOT be granted; before={credits_before} after={credits_after}"
        )
        assert u_after.get("last_streak_week") is None


# ============ Regression smoke ============
class TestRegressionSmoke:
    def test_send_summary_has_7_keys(self, admin):
        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        for k in ("riders", "captains", "admins", "skipped", "failed",
                  "leaderboard_granted", "streak_granted"):
            assert k in s

    def test_test_send_still_works(self, admin):
        r = requests.post(
            f"{API}/admin/digest/test-send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"to": "delivered@resend.dev"}, timeout=45,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j.get("email_id")

    def test_runs_endpoint(self, admin):
        r = requests.get(
            f"{API}/admin/digest/runs",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json()["runs"], list)

    def test_auth_guards(self):
        r = requests.post(f"{API}/admin/digest/send", timeout=20)
        assert r.status_code == 401
        # non-admin
        d = dev_login(f"TEST_nonadmin_{uuid.uuid4().hex[:5]}@example.com", "NonA")
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {d['session_token']}"},
            json={"kind": "admin"}, timeout=20,
        )
        assert r.status_code == 403
