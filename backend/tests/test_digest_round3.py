"""Round-3 digest tests: rider referral leaderboard (top inviters).

Focuses only on the new referral leaderboard behavior. Round-1/2 endpoints
are only smoke-tested for regression on the summary shape (8 keys).
"""
import os
import uuid
import zoneinfo
from datetime import datetime

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rideshare-mvp-21.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
IST = zoneinfo.ZoneInfo("Asia/Kolkata")

EXPECTED_REFERRAL_CREDITS = {1: 150.0, 2: 100.0, 3: 50.0}


# ------------- helpers -------------
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


def get_rewards(token):
    r = requests.get(f"{API}/rewards/me", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def apply_referral(token, code):
    r = requests.post(
        f"{API}/referral/apply",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": code}, timeout=20,
    )
    return r


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


def _reset_referral_week(mongo, user_ids):
    if not user_ids:
        return
    mongo.users.update_many(
        {"user_id": {"$in": list(user_ids)}},
        {"$unset": {"last_referral_leaderboard_week": "",
                    "last_referral_leaderboard_rank": "",
                    "last_referral_leaderboard_credit": ""}},
    )


@pytest.fixture(scope="module")
def three_referrers(mongo):
    """Seed 3 rider referrers with 3/2/1 fresh invitees each. Returns list
    ordered by expected rank (rank1 first).

    Before seeding, clear `referred_by` on any pre-existing TEST_* users so
    stale referrer data from earlier rounds doesn't dominate the top-3.
    """
    from datetime import timedelta
    now_utc = datetime.utcnow()
    week_start = now_utc - timedelta(days=7)
    mongo.users.update_many(
        {"referred_by": {"$ne": None, "$exists": True},
         "created_at": {"$gte": week_start}},
        {"$unset": {"referred_by": ""}},
    )
    referrers = []
    invite_counts = [3, 2, 1]
    for i, n_invites in enumerate(invite_counts):
        r_email = f"TEST_ref{i}_{uuid.uuid4().hex[:5]}@example.com"
        d = dev_login(r_email, f"Ref{i}")
        set_role(d["session_token"], "rider")
        code = get_rewards(d["session_token"])["referral_code"]
        # Snapshot credits BEFORE any grant
        udoc = mongo.users.find_one({"user_id": d["user"]["user_id"]})
        credits_before = float(udoc.get("credits") or 0)
        # Invitees
        for j in range(n_invites):
            inv_email = f"TEST_inv{i}_{j}_{uuid.uuid4().hex[:5]}@example.com"
            inv = dev_login(inv_email, f"Inv{i}{j}")
            set_role(inv["session_token"], "rider")
            resp = apply_referral(inv["session_token"], code)
            assert resp.status_code == 200, f"apply_referral failed: {resp.status_code} {resp.text}"
        referrers.append({
            "email": r_email,
            "token": d["session_token"],
            "user_id": d["user"]["user_id"],
            "code": code,
            "n_invites": n_invites,
            "credits_before": credits_before,
        })
    # Reset week flag in case of prior run this same ISO week
    _reset_referral_week(mongo, [r["user_id"] for r in referrers])
    return referrers


# ============ Preview does NOT grant credits ============
class TestPreviewNoGrant:
    def test_preview_admin_has_referral_leaderboard(self, admin, three_referrers):
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"kind": "admin"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "referral_leaderboard" in j["data"]
        assert isinstance(j["data"]["referral_leaderboard"], list)
        html = j["html"].lower()
        assert "referral" in html and "leaderboard" in html, "admin HTML missing referral leaderboard section"

    def test_preview_rider_has_referral_fields(self, admin, three_referrers):
        rider = three_referrers[0]
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"kind": "rider", "email": rider["email"]}, timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        d = j["data"]
        assert isinstance(d.get("weekly_referrals"), int)
        assert d["weekly_referrals"] == rider["n_invites"]
        # my_referral_rank may be int or None
        assert d.get("my_referral_rank") is None or isinstance(d["my_referral_rank"], int)
        assert isinstance(d.get("my_referral_boost"), (int, float))
        assert isinstance(d.get("referral_leaderboard"), list)
        assert "top inviters" in j["html"].lower(), "rider HTML missing 'top inviters' section"

    def test_preview_does_not_grant_referral_credits(self, admin, mongo, three_referrers):
        rider = three_referrers[0]
        uid = rider["user_id"]
        _reset_referral_week(mongo, [uid])
        u_before = mongo.users.find_one({"user_id": uid})
        credits_before = float(u_before.get("credits") or 0)
        for _ in range(3):
            r = requests.post(
                f"{API}/admin/digest/preview",
                headers={"Authorization": f"Bearer {admin['session_token']}"},
                json={"kind": "rider", "email": rider["email"]}, timeout=30,
            )
            assert r.status_code == 200, r.text
        u_after = mongo.users.find_one({"user_id": uid})
        credits_after = float(u_after.get("credits") or 0)
        assert credits_after == credits_before, (
            f"Preview must not grant credits — before={credits_before}, after={credits_after}"
        )
        assert u_after.get("last_referral_leaderboard_week") is None

    def test_rider_with_no_referrals_not_on_board(self, admin, mongo):
        # Fresh rider with 0 referrals this week
        email = f"TEST_noref_{uuid.uuid4().hex[:5]}@example.com"
        d = dev_login(email, "NoRef")
        set_role(d["session_token"], "rider")
        uid = d["user"]["user_id"]
        r = requests.post(
            f"{API}/admin/digest/preview",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"kind": "rider", "email": email}, timeout=30,
        )
        assert r.status_code == 200
        j = r.json()
        board_ids = [e["rider_id"] for e in j["data"]["referral_leaderboard"]]
        assert uid not in board_ids, f"Zero-referral rider {uid} should not be on referral leaderboard"
        assert j["data"]["weekly_referrals"] == 0
        assert j["data"]["my_referral_rank"] is None
        assert j["data"]["my_referral_boost"] == 0


# ============ Referral Leaderboard grant + amounts + idempotency ============
class TestReferralLeaderboardGrant:
    def test_grants_top3_with_correct_credits(self, admin, mongo, three_referrers):
        # Reset week flags so this fresh send actually grants
        rider_ids = [r["user_id"] for r in three_referrers]
        _reset_referral_week(mongo, rider_ids)

        # Snapshot pre-send credits
        pre = {d["user_id"]: float(d.get("credits") or 0)
               for d in mongo.users.find({"user_id": {"$in": rider_ids}},
                                          {"_id": 0, "user_id": 1, "credits": 1})}

        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]

        # 8-key regression
        for k in ("riders", "captains", "admins", "skipped", "failed",
                  "leaderboard_granted", "streak_granted", "referral_leaderboard_granted"):
            assert k in s, f"missing key {k} in summary {s}"

        assert s["referral_leaderboard_granted"] == 3, (
            f"Expected referral_leaderboard_granted=3, got {s['referral_leaderboard_granted']}: {s}"
        )

        week_key = _current_week_key()
        docs = list(mongo.users.find(
            {"user_id": {"$in": rider_ids}, "last_referral_leaderboard_week": week_key},
            {"_id": 0, "user_id": 1, "last_referral_leaderboard_rank": 1,
             "last_referral_leaderboard_credit": 1, "credits": 1},
        ))
        assert len(docs) == 3, f"Expected 3 docs with week_key, got {docs}"

        by_uid = {d["user_id"]: d for d in docs}
        # Ranking should follow invite counts: 3 -> #1 (150), 2 -> #2 (100), 1 -> #3 (50)
        for rd in three_referrers:
            uid = rd["user_id"]
            info = by_uid[uid]
            rank = info["last_referral_leaderboard_rank"]
            credit = info["last_referral_leaderboard_credit"]
            assert rank in (1, 2, 3), f"rank {rank} not in 1..3"
            assert credit in (150.0, 100.0, 50.0), f"credit {credit} not valid"
            assert credit == EXPECTED_REFERRAL_CREDITS[rank], (
                f"rider {uid} rank={rank} credit={credit} expected={EXPECTED_REFERRAL_CREDITS[rank]}"
            )
            delta = float(info["credits"]) - pre[uid]
            # Delta could be higher if the rider also happens to be on spend leaderboard,
            # but these fresh test riders have no completed rides, only referrals.
            assert abs(delta - EXPECTED_REFERRAL_CREDITS[rank]) < 0.01, (
                f"rider {uid} credits delta={delta} expected={EXPECTED_REFERRAL_CREDITS[rank]}"
            )

        # Verify rank by invite count
        rank_by_invites = {rd["n_invites"]: by_uid[rd["user_id"]]["last_referral_leaderboard_rank"]
                            for rd in three_referrers}
        assert rank_by_invites[3] == 1
        assert rank_by_invites[2] == 2
        assert rank_by_invites[1] == 3

    def test_idempotent_no_regrant(self, admin, mongo, three_referrers):
        rider_ids = [r["user_id"] for r in three_referrers]
        snap = {d["user_id"]: float(d.get("credits") or 0)
                for d in mongo.users.find({"user_id": {"$in": rider_ids}},
                                           {"_id": 0, "user_id": 1, "credits": 1})}
        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        assert s["referral_leaderboard_granted"] == 0, (
            f"Expected referral_leaderboard_granted=0 on re-run, got {s}"
        )
        after = {d["user_id"]: float(d.get("credits") or 0)
                 for d in mongo.users.find({"user_id": {"$in": rider_ids}},
                                            {"_id": 0, "user_id": 1, "credits": 1})}
        for uid, before_c in snap.items():
            assert abs(after[uid] - before_c) < 0.01, (
                f"credits changed on idempotent re-run for {uid}: before={before_c} after={after[uid]}"
            )


# ============ Regression smoke ============
class TestRegressionSmoke:
    def test_send_summary_has_8_keys(self, admin):
        r = requests.post(
            f"{API}/admin/digest/send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        s = r.json()["summary"]
        expected = {"riders", "captains", "admins", "skipped", "failed",
                    "leaderboard_granted", "streak_granted", "referral_leaderboard_granted"}
        assert expected.issubset(set(s.keys())), f"summary missing keys: {expected - set(s.keys())}"

    def test_runs_endpoint(self, admin):
        r = requests.get(
            f"{API}/admin/digest/runs",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json()["runs"], list)
        assert len(r.json()["runs"]) >= 1

    def test_test_send_once(self, admin):
        # Called ONCE — do not repeat (Resend rate limit).
        # If the emergent proxy is currently rate-limited (429 -> ok=false),
        # skip because it's an env constraint, not a code bug.
        r = requests.post(
            f"{API}/admin/digest/test-send",
            headers={"Authorization": f"Bearer {admin['session_token']}"},
            json={"to": "delivered@resend.dev"}, timeout=45,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        if j.get("ok") is not True:
            pytest.skip(f"Resend rate-limited or unavailable this run: {j}")
        assert j.get("email_id")
