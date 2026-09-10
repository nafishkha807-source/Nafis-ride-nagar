"""Weekly digest emails via Emergent-managed Resend integration.

Sends three kinds of digests every Monday 08:00 IST (also manually via
POST /api/admin/digest/send):
  - Rider   : rides + spend + credits + leaderboard rank (last 7 days)
  - Captain : earnings + rides + rating + active-day streak (last 7 days)
  - Admin   : platform revenue + rides + top captains + leaderboard + streaks

Each weekly run ALSO grants:
  - Rider leaderboard credits (₹100 / ₹75 / ₹50 to top 3 spenders)
  - Captain streak bonus (₹200 to captains with 5+ consecutive active days)
Both grants are idempotent per ISO week via `last_leaderboard_week` /
`last_streak_week` flags on the user.

Follows the Emergent Resend playbook — every send goes through
`_assert_safe_email` and passes `from_name` (the app's own brand).
"""
from __future__ import annotations

import ipaddress
import logging
import os
import re
import zoneinfo
from datetime import datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

# =============================================================================
# Emergent-managed email proxy (constants — never read from env)
# =============================================================================
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Nafis Ride Alwar")  # G1: our own brand
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

APP_BRAND = "Nafis Ride Alwar"
APP_URL = "https://rideshare-mvp-21.preview.emergentagent.com"
IST = zoneinfo.ZoneInfo("Asia/Kolkata")

# Reward tuning
LEADERBOARD_CREDITS = [100.0, 75.0, 50.0]   # rank 1, 2, 3
STREAK_MIN_DAYS = 5
STREAK_BONUS = 200.0


# =============================================================================
# Guardrail gate (from playbook — never weaken)
# =============================================================================
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password", "cvv",
    "send us your password", "enter your password below", "confirm your card number",
    "your full card number", "seed phrase", "recovery phrase", "verify your card",
    "social security number", "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


# =============================================================================
# Sender
# =============================================================================
async def send_email(*, to: str, subject: str, html: str) -> str | None:
    """Send a single email via the Emergent proxy."""
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY missing — skipping send to %s", to)
        return None
    payload = {
        "to": [to],
        "subject": subject,
        "html": html,
        "from_name": EMAIL_FROM_NAME,
    }
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("Email send failed (%s): %s %s", to, e.response.status_code, e.response.text)
        return None
    except Exception as e:
        logger.error("Email send error (%s): %s", to, e)
        return None


# =============================================================================
# Time helpers
# =============================================================================
def _week_window() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    return now - timedelta(days=7), now


def _current_week_key() -> str:
    """ISO year-week string for idempotency, computed in IST so 'this week'
    matches the cron trigger (Mondays 08:00 IST)."""
    ist_now = datetime.now(IST)
    y, w, _ = ist_now.isocalendar()
    return f"{y}-W{w:02d}"


# =============================================================================
# Leaderboard (top 3 riders by spend, last 7 days) + credit grant
# =============================================================================
async def compute_rider_leaderboard(db) -> list[dict]:
    """Return top 3 riders by weekly spend (COMPLETED rides). Each entry:
    {rider_id, name, email, spend, rides}."""
    start, end = _week_window()
    cur = db.rides.aggregate([
        {"$match": {"status": "COMPLETED",
                    "completed_at": {"$gte": start, "$lt": end},
                    "rider_id": {"$ne": None}}},
        {"$group": {
            "_id": "$rider_id",
            "name": {"$last": "$rider_name"},
            "spend": {"$sum": "$fare"},
            "rides": {"$sum": 1},
        }},
        {"$sort": {"spend": -1}},
        {"$limit": 3},
    ])
    out: list[dict] = []
    async for d in cur:
        # look up rider for a fresh display name / email
        u = await db.users.find_one({"user_id": d["_id"]}, {"_id": 0}) or {}
        out.append({
            "rider_id": d["_id"],
            "name": u.get("name") or d.get("name") or (u.get("email") or "Rider").split("@")[0],
            "email": u.get("email"),
            "spend": round(float(d.get("spend", 0) or 0), 2),
            "rides": int(d.get("rides", 0) or 0),
        })
    return out


async def _grant_leaderboard_credits(db, leaders: list[dict]) -> list[dict]:
    """Idempotent per ISO week. Returns list of {rider_id, rank, credit}
    entries actually granted this run."""
    week_key = _current_week_key()
    granted: list[dict] = []
    for i, ldr in enumerate(leaders[:3]):
        credit = LEADERBOARD_CREDITS[i] if i < len(LEADERBOARD_CREDITS) else 0.0
        if credit <= 0:
            continue
        u = await db.users.find_one({"user_id": ldr["rider_id"]}, {"_id": 0})
        if not u:
            continue
        if u.get("last_leaderboard_week") == week_key:
            # already granted this week
            continue
        await db.users.update_one(
            {"user_id": ldr["rider_id"]},
            {
                "$inc": {"credits": credit},
                "$set": {"last_leaderboard_week": week_key,
                         "last_leaderboard_rank": i + 1,
                         "last_leaderboard_credit": credit},
            },
        )
        granted.append({"rider_id": ldr["rider_id"], "rank": i + 1, "credit": credit})
    return granted


# =============================================================================
# Captain streak (consecutive active days in the last 14 days) + bonus
# =============================================================================
async def compute_captain_streak(db, captain_id: str) -> int:
    """Return the number of consecutive days (ending today or yesterday IST)
    the captain had at least one COMPLETED ride. Walks the last 14 days."""
    if not captain_id:
        return 0
    start = (datetime.now(timezone.utc) - timedelta(days=14)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    cur = db.rides.aggregate([
        {"$match": {"captain_id": captain_id, "status": "COMPLETED",
                    "completed_at": {"$gte": start}}},
        {"$project": {"day": {"$dateToString": {
            "format": "%Y-%m-%d", "date": "$completed_at", "timezone": "Asia/Kolkata"}}}},
        {"$group": {"_id": "$day"}},
    ])
    active_days: set[str] = set()
    async for d in cur:
        if d.get("_id"):
            active_days.add(d["_id"])
    if not active_days:
        return 0

    today = datetime.now(IST).date()
    # allow streak to end today OR yesterday (captain may not have driven yet today)
    cursor_date = today if today.isoformat() in active_days else today - timedelta(days=1)
    streak = 0
    for _ in range(14):
        if cursor_date.isoformat() in active_days:
            streak += 1
            cursor_date -= timedelta(days=1)
        else:
            break
    return streak


async def _grant_streak_bonus(db, captain: dict, streak_days: int) -> float:
    """Idempotent per ISO week. Grants ₹STREAK_BONUS credit if streak >= threshold."""
    if streak_days < STREAK_MIN_DAYS:
        return 0.0
    week_key = _current_week_key()
    if captain.get("last_streak_week") == week_key:
        return 0.0
    await db.users.update_one(
        {"user_id": captain["user_id"]},
        {
            "$inc": {"credits": STREAK_BONUS},
            "$set": {"last_streak_week": week_key,
                     "last_streak_days": streak_days,
                     "last_streak_bonus": STREAK_BONUS},
        },
    )
    return STREAK_BONUS


async def compute_streaking_captains(db) -> list[dict]:
    """List of captains currently on a 5+ day streak. Used by admin digest."""
    cap_ids = await db.rides.distinct(
        "captain_id",
        {"status": "COMPLETED",
         "completed_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=14)}},
    )
    cap_ids = [c for c in cap_ids if c]
    out: list[dict] = []
    for cid in cap_ids:
        streak = await compute_captain_streak(db, cid)
        if streak >= STREAK_MIN_DAYS:
            u = await db.users.find_one({"user_id": cid}, {"_id": 0}) or {}
            out.append({
                "captain_id": cid,
                "name": u.get("name") or (u.get("email") or "Captain").split("@")[0],
                "streak_days": streak,
            })
    out.sort(key=lambda x: x["streak_days"], reverse=True)
    return out[:10]


# =============================================================================
# Digest data builders
# =============================================================================
async def _sum_fare(db, match: dict) -> tuple[float, int]:
    cur = db.rides.aggregate([
        {"$match": match},
        {"$group": {"_id": None, "sum": {"$sum": "$fare"}, "count": {"$sum": 1}}},
    ])
    s, c = 0.0, 0
    async for d in cur:
        s = float(d.get("sum", 0) or 0)
        c = int(d.get("count", 0) or 0)
    return round(s, 2), c


async def build_rider_digest(db, rider: dict, leaderboard: list[dict] | None = None) -> dict:
    start, end = _week_window()
    match = {"rider_id": rider["user_id"], "created_at": {"$gte": start, "$lt": end}}
    total = await db.rides.count_documents(match)
    spend, completed = await _sum_fare(db, {**match, "status": "COMPLETED"})
    cancelled = await db.rides.count_documents({**match, "status": "CANCELLED"})
    fresh = await db.users.find_one({"user_id": rider["user_id"]}, {"_id": 0})
    credits = round(float(fresh.get("credits", 0) or 0), 2) if fresh else 0.0

    lb = leaderboard if leaderboard is not None else await compute_rider_leaderboard(db)
    my_rank = next((i + 1 for i, r in enumerate(lb) if r["rider_id"] == rider["user_id"]), None)
    my_boost = LEADERBOARD_CREDITS[my_rank - 1] if my_rank and my_rank <= 3 else 0.0

    return {
        "rides": total,
        "completed": completed,
        "cancelled": cancelled,
        "spend": spend,
        "credits": credits,
        "leaderboard": lb,
        "my_rank": my_rank,
        "my_boost": my_boost,
    }


async def build_captain_digest(db, captain: dict) -> dict:
    start, end = _week_window()
    match = {
        "captain_id": captain["user_id"],
        "status": "COMPLETED",
        "completed_at": {"$gte": start, "$lt": end},
    }
    earn, rides = await _sum_fare(db, match)
    rating_cur = db.rides.aggregate([
        {"$match": {"captain_id": captain["user_id"], "rating": {"$ne": None},
                    "rated_at": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "n": {"$sum": 1}}},
    ])
    avg, n_ratings = 0.0, 0
    async for d in rating_cur:
        avg = round(float(d.get("avg", 0) or 0), 2)
        n_ratings = int(d.get("n", 0) or 0)
    fresh = await db.users.find_one({"user_id": captain["user_id"]}, {"_id": 0})
    streak = await compute_captain_streak(db, captain["user_id"])
    return {
        "rides": rides,
        "earnings": earn,
        "avg_rating_week": avg,
        "ratings_count_week": n_ratings,
        "lifetime_avg": round(float((fresh or {}).get("avg_rating", 0) or 0), 2),
        "lifetime_ratings": int((fresh or {}).get("total_ratings", 0) or 0),
        "streak_days": streak,
        "streak_eligible": streak >= STREAK_MIN_DAYS,
        "streak_bonus": STREAK_BONUS,
    }


async def build_admin_digest(db) -> dict:
    start, end = _week_window()
    rev, rides = await _sum_fare(db, {"status": "COMPLETED",
                                       "completed_at": {"$gte": start, "$lt": end}})
    cancelled = await db.rides.count_documents({"status": "CANCELLED",
                                                 "cancelled_at": {"$gte": start, "$lt": end}})
    new_riders = await db.users.count_documents({"role": "rider",
                                                  "created_at": {"$gte": start, "$lt": end}})
    new_captains = await db.users.count_documents({"role": "captain",
                                                    "created_at": {"$gte": start, "$lt": end}})
    top_cur = db.rides.aggregate([
        {"$match": {"status": "COMPLETED", "completed_at": {"$gte": start, "$lt": end},
                    "captain_id": {"$ne": None}}},
        {"$group": {
            "_id": "$captain_id",
            "name": {"$last": "$captain_name"},
            "earnings": {"$sum": "$fare"},
            "rides": {"$sum": 1},
        }},
        {"$sort": {"earnings": -1}},
        {"$limit": 5},
    ])
    top_captains = []
    async for d in top_cur:
        top_captains.append({
            "captain_id": d["_id"],
            "name": d.get("name") or "Unknown",
            "earnings": round(float(d.get("earnings", 0) or 0), 2),
            "rides": int(d.get("rides", 0) or 0),
        })
    leaderboard = await compute_rider_leaderboard(db)
    streakers = await compute_streaking_captains(db)
    return {
        "revenue": rev,
        "rides": rides,
        "cancelled": cancelled,
        "new_riders": new_riders,
        "new_captains": new_captains,
        "top_captains": top_captains,
        "leaderboard": leaderboard,
        "streaking_captains": streakers,
    }


# =============================================================================
# HTML templates (server-side only — never take HTML from callers)
# =============================================================================
_FOOTER = (
    f'<p style="font-size:12px;color:#888;margin-top:24px">'
    f'Sent by {escape(APP_BRAND)}. We never ask for your password or card details by email. '
    f'You are receiving this weekly summary because you signed up for {escape(APP_BRAND)}.'
    f'</p>'
)

_MEDAL = {1: "🥇", 2: "🥈", 3: "🥉"}


def _shell(inner_html: str) -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#111;padding:24px;font-family:Arial,sans-serif;color:#eaeaea">'
        '<tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="background:#1c1c1c;border-radius:12px;padding:28px;max-width:600px">'
        '<tr><td>'
        f'<div style="font-size:14px;color:#FFCC00;letter-spacing:1px;font-weight:700">{escape(APP_BRAND.upper())}</div>'
        f'{inner_html}'
        f'{_FOOTER}'
        '</td></tr></table></td></tr></table>'
    )


def _leaderboard_table(leaders: list[dict], highlight_rider_id: str | None = None) -> str:
    if not leaders:
        return ('<table role="presentation" width="100%" style="background:#1a1a1a;border-radius:8px">'
                '<tr><td style="padding:12px;color:#888;text-align:center">No completed rides this week.</td></tr></table>')
    rows = ""
    for i, r in enumerate(leaders, 1):
        boost = LEADERBOARD_CREDITS[i - 1] if i - 1 < len(LEADERBOARD_CREDITS) else 0
        medal = _MEDAL.get(i, "")
        is_me = highlight_rider_id and r["rider_id"] == highlight_rider_id
        row_bg = "#2a2114" if is_me else "transparent"
        name_color = "#FFCC00" if is_me else "#eaeaea"
        rows += (
            f'<tr style="background:{row_bg}">'
            f'<td style="padding:10px;border-bottom:1px solid #333;color:{name_color};font-weight:700">'
            f'{medal} {escape(r["name"])}{" (you)" if is_me else ""}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #333;color:#FFCC00;text-align:right">&#8377;{int(r["spend"])}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #333;color:#8ee0a1;text-align:right">+&#8377;{int(boost)}</td>'
            f'</tr>'
        )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px">{rows}</table>'


def _rider_html(name: str, d: dict, rider_id: str | None = None) -> str:
    stat_grid = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px">'
        '<tr>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">{d["rides"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rides booked</div></td>'
        '<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">&#8377;{int(d["spend"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Total spend</div></td>'
        '<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">&#8377;{int(d["credits"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Credit balance</div></td>'
        '</tr></table>'
    )

    rank_banner = ""
    if d.get("my_rank"):
        medal = _MEDAL.get(d["my_rank"], "")
        rank_banner = (
            f'<div style="margin:18px 0 8px;padding:16px;border-radius:12px;'
            f'background:linear-gradient(135deg,#FFCC00 0%,#e6a800 100%);color:#111">'
            f'<div style="font-size:12px;font-weight:800;letter-spacing:1px">TOP SPENDER {medal}</div>'
            f'<div style="font-size:20px;font-weight:900;margin-top:4px">You ranked #{d["my_rank"]} this week!</div>'
            f'<div style="font-size:13px;margin-top:4px">&#8377;{int(d["my_boost"])} bonus credit has been added to your wallet.</div>'
            f'</div>'
        )

    body = (
        f'<h1 style="color:#FFCC00;font-size:24px;margin:12px 0 4px">Your week in Alwar</h1>'
        f'<p style="color:#bfbfbf;margin:0 0 20px">Hi {escape(name)}, here is your last 7 days on {escape(APP_BRAND)}.</p>'
        f'{stat_grid}'
        f'<p style="color:#cfcfcf;margin:16px 0 0">Completed: <b>{d["completed"]}</b> · '
        f'Cancelled: <b>{d["cancelled"]}</b></p>'
        f'{rank_banner}'
        '<h3 style="color:#eaeaea;margin:24px 0 8px">This week\'s top spenders 🏆</h3>'
        f'{_leaderboard_table(d.get("leaderboard") or [], highlight_rider_id=rider_id)}'
        f'<p style="color:#9a9a9a;font-size:12px;margin:10px 0 0">Top 3 each week earn &#8377;100 / &#8377;75 / &#8377;50 credit — auto-added to your wallet.</p>'
        f'<p style="margin:24px 0 4px"><a href="{APP_URL}" style="background:#FFCC00;color:#111;padding:12px 20px;'
        f'border-radius:24px;text-decoration:none;font-weight:700;display:inline-block">Book your next ride</a></p>'
    )
    return _shell(body)


def _captain_html(name: str, d: dict) -> str:
    stat_grid = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px">'
        '<tr>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">&#8377;{int(d["earnings"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Earnings</div></td>'
        '<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">{d["rides"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rides done</div></td>'
        '<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">{d["avg_rating_week"] or "-"}&#9733;</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rating (week)</div></td>'
        '</tr></table>'
    )

    if d.get("streak_eligible"):
        streak_block = (
            f'<div style="margin:18px 0 8px;padding:18px;border-radius:12px;'
            f'background:linear-gradient(135deg,#FF8C00 0%,#FFCC00 100%);color:#111">'
            f'<div style="font-size:12px;font-weight:800;letter-spacing:1px">🔥 STREAK BONUS UNLOCKED</div>'
            f'<div style="font-size:22px;font-weight:900;margin-top:4px">{d["streak_days"]} days straight!</div>'
            f'<div style="font-size:13px;margin-top:4px">&#8377;{int(d["streak_bonus"])} bonus credit added to your wallet.</div>'
            f'</div>'
        )
    elif d.get("streak_days"):
        need = STREAK_MIN_DAYS - d["streak_days"]
        streak_block = (
            f'<div style="margin:18px 0 8px;padding:14px;border-radius:12px;'
            f'background:#242424;border:1px dashed #FFCC00;color:#eaeaea">'
            f'<div style="font-size:12px;font-weight:800;letter-spacing:1px;color:#FFCC00">CURRENT STREAK</div>'
            f'<div style="font-size:16px;font-weight:800;margin-top:4px">{d["streak_days"]} day(s) — '
            f'{need} more for &#8377;{int(STREAK_BONUS)} bonus!</div>'
            f'</div>'
        )
    else:
        streak_block = ""

    body = (
        f'<h1 style="color:#FFCC00;font-size:24px;margin:12px 0 4px">Your week on the road</h1>'
        f'<p style="color:#bfbfbf;margin:0 0 20px">Namaste {escape(name)}, here is your last 7 days.</p>'
        f'{stat_grid}'
        f'<p style="color:#cfcfcf;margin:16px 0 0">Lifetime: <b>{d["lifetime_avg"] or "-"}&#9733;</b> '
        f'from <b>{d["lifetime_ratings"]}</b> ratings</p>'
        f'{streak_block}'
        f'<p style="margin:24px 0 4px"><a href="{APP_URL}" style="background:#FFCC00;color:#111;padding:12px 20px;'
        f'border-radius:24px;text-decoration:none;font-weight:700;display:inline-block">Go online</a></p>'
    )
    return _shell(body)


def _admin_html(d: dict) -> str:
    # Top captains table
    cap_rows = ""
    for i, c in enumerate(d["top_captains"], 1):
        cap_rows += (
            f'<tr><td style="padding:8px;border-bottom:1px solid #333;color:#eaeaea">{i}. {escape(c["name"])}</td>'
            f'<td style="padding:8px;border-bottom:1px solid #333;color:#FFCC00;text-align:right">&#8377;{int(c["earnings"])}</td>'
            f'<td style="padding:8px;border-bottom:1px solid #333;color:#bfbfbf;text-align:right">{c["rides"]} rides</td></tr>'
        )
    if not cap_rows:
        cap_rows = ('<tr><td colspan="3" style="padding:12px;color:#888;text-align:center">No completed rides this week.</td></tr>')

    # Streaking captains
    streak_rows = ""
    for c in d.get("streaking_captains") or []:
        streak_rows += (
            f'<tr><td style="padding:8px;border-bottom:1px solid #333;color:#eaeaea">{escape(c["name"])}</td>'
            f'<td style="padding:8px;border-bottom:1px solid #333;color:#FF8C00;text-align:right;font-weight:800">🔥 {c["streak_days"]} days</td></tr>'
        )
    streak_section = ""
    if streak_rows:
        streak_section = (
            '<h3 style="color:#eaeaea;margin:24px 0 8px">Captains on a streak 🔥</h3>'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px">{streak_rows}</table>'
            f'<p style="color:#9a9a9a;font-size:12px;margin:6px 0 0">Every captain with {STREAK_MIN_DAYS}+ consecutive active days gets &#8377;{int(STREAK_BONUS)}.</p>'
        )

    body = (
        f'<h1 style="color:#FFCC00;font-size:24px;margin:12px 0 4px">Weekly platform digest</h1>'
        f'<p style="color:#bfbfbf;margin:0 0 20px">Last 7 days on {escape(APP_BRAND)}.</p>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px">'
        '<tr>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:26px;font-weight:800;color:#FFCC00">&#8377;{int(d["revenue"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Revenue</div></td>'
        '<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:26px;font-weight:800;color:#FFCC00">{d["rides"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rides completed</div></td>'
        '<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:26px;font-weight:800;color:#FFCC00">{d["cancelled"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Cancellations</div></td>'
        '</tr></table>'
        f'<p style="color:#cfcfcf;margin:16px 0 0">New riders: <b>{d["new_riders"]}</b> · '
        f'New captains: <b>{d["new_captains"]}</b></p>'
        '<h3 style="color:#eaeaea;margin:24px 0 8px">Top captains</h3>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px">{cap_rows}</table>'
        '<h3 style="color:#eaeaea;margin:24px 0 8px">Rider leaderboard 🏆</h3>'
        f'{_leaderboard_table(d.get("leaderboard") or [])}'
        f'{streak_section}'
    )
    return _shell(body)


# =============================================================================
# Dispatch
# =============================================================================
async def send_weekly_digests(db) -> dict:
    """Send weekly digests to eligible riders, captains and admin recipients.
    Also grants leaderboard credits + streak bonuses (idempotent per ISO week).
    Returns a summary dict of counts."""
    start, end = _week_window()
    sent = {"riders": 0, "captains": 0, "admins": 0, "skipped": 0, "failed": 0,
            "leaderboard_granted": 0, "streak_granted": 0}

    # 1) Compute + grant rewards FIRST so digests reflect the just-credited bonuses.
    leaderboard = await compute_rider_leaderboard(db)
    lb_grants = await _grant_leaderboard_credits(db, leaderboard)
    sent["leaderboard_granted"] = len(lb_grants)

    # Riders: only those with at least 1 ride last week
    rider_ids = await db.rides.distinct(
        "rider_id", {"created_at": {"$gte": start, "$lt": end}})
    riders = await db.users.find(
        {"user_id": {"$in": rider_ids}, "role": "rider"}, {"_id": 0}
    ).to_list(1000) if rider_ids else []
    for u in riders:
        if not u.get("email") or "@" not in u["email"]:
            sent["skipped"] += 1; continue
        try:
            data = await build_rider_digest(db, u, leaderboard=leaderboard)
            html = _rider_html(u.get("name") or u["email"].split("@")[0], data,
                                rider_id=u["user_id"])
            res = await send_email(
                to=u["email"],
                subject=f"Your {APP_BRAND} week: {data['rides']} rides, ₹{int(data['spend'])} spent",
                html=html,
            )
            sent["riders" if res else "failed"] += 1
        except Exception as e:
            logger.exception("Rider digest failed for %s: %s", u.get("email"), e)
            sent["failed"] += 1

    # Captains: only those with at least 1 completed ride last week
    cap_ids = await db.rides.distinct(
        "captain_id", {"status": "COMPLETED",
                        "completed_at": {"$gte": start, "$lt": end}})
    cap_ids = [c for c in cap_ids if c]
    captains = await db.users.find(
        {"user_id": {"$in": cap_ids}, "role": "captain"}, {"_id": 0}
    ).to_list(1000) if cap_ids else []
    for u in captains:
        # streak bonus (idempotent per week)
        streak_days = await compute_captain_streak(db, u["user_id"])
        if streak_days >= STREAK_MIN_DAYS:
            granted = await _grant_streak_bonus(db, u, streak_days)
            if granted > 0:
                sent["streak_granted"] += 1
        if not u.get("email") or "@" not in u["email"]:
            sent["skipped"] += 1; continue
        try:
            # Re-fetch after possible credit grant so template shows fresh credit balance.
            u_fresh = await db.users.find_one({"user_id": u["user_id"]}, {"_id": 0}) or u
            data = await build_captain_digest(db, u_fresh)
            html = _captain_html(u_fresh.get("name") or u_fresh["email"].split("@")[0], data)
            res = await send_email(
                to=u_fresh["email"],
                subject=f"You earned ₹{int(data['earnings'])} on {APP_BRAND} this week",
                html=html,
            )
            sent["captains" if res else "failed"] += 1
        except Exception as e:
            logger.exception("Captain digest failed for %s: %s", u.get("email"), e)
            sent["failed"] += 1

    # Admins: every user with is_admin=True + optional DIGEST_ADMIN_EMAIL
    admin_users = await db.users.find({"is_admin": True}, {"_id": 0}).to_list(50)
    admin_emails = {u["email"] for u in admin_users if u.get("email") and "@" in u["email"]}
    extra = (os.environ.get("DIGEST_ADMIN_EMAIL") or "").strip().lower()
    if extra and "@" in extra:
        admin_emails.add(extra)
    if admin_emails:
        try:
            data = await build_admin_digest(db)
            html = _admin_html(data)
            subj = f"{APP_BRAND} weekly digest: ₹{int(data['revenue'])} · {data['rides']} rides"
            for email in admin_emails:
                res = await send_email(to=email, subject=subj, html=html)
                sent["admins" if res else "failed"] += 1
        except Exception as e:
            logger.exception("Admin digest failed: %s", e)
            sent["failed"] += 1

    # Record run
    await db.digest_runs.insert_one({
        "run_at": datetime.now(timezone.utc),
        "window_start": start,
        "window_end": end,
        **sent,
    })
    logger.info("Weekly digest sent: %s", sent)
    return sent


# =============================================================================
# Scheduler
# =============================================================================
_scheduler: AsyncIOScheduler | None = None


def start_scheduler(db) -> None:
    """Start APScheduler cron: every Monday 08:00 IST (Asia/Kolkata)."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return
    _scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

    async def _job():
        try:
            await send_weekly_digests(db)
        except Exception as e:
            logger.exception("Scheduled digest failed: %s", e)

    _scheduler.add_job(
        _job,
        CronTrigger(day_of_week="mon", hour=8, minute=0, timezone="Asia/Kolkata"),
        id="weekly_digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    _scheduler.start()
    logger.info("Digest scheduler started (Mondays 08:00 IST)")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        _scheduler = None


# =============================================================================
# Preview (never grants credits / never sends)
# =============================================================================
async def _pick_rider(db, email: str | None) -> dict | None:
    if email:
        return await db.users.find_one({"email": email.lower(), "role": "rider"}, {"_id": 0})
    # auto-pick the most recent rider with a ride in the last 7 days
    start, end = _week_window()
    ids = await db.rides.distinct("rider_id", {"created_at": {"$gte": start, "$lt": end}})
    if ids:
        return await db.users.find_one({"user_id": {"$in": ids}, "role": "rider"}, {"_id": 0})
    return await db.users.find_one({"role": "rider"}, {"_id": 0})


async def _pick_captain(db, email: str | None) -> dict | None:
    if email:
        return await db.users.find_one({"email": email.lower(), "role": "captain"}, {"_id": 0})
    start, end = _week_window()
    ids = await db.rides.distinct("captain_id", {"status": "COMPLETED",
                                                  "completed_at": {"$gte": start, "$lt": end}})
    ids = [c for c in ids if c]
    if ids:
        return await db.users.find_one({"user_id": {"$in": ids}, "role": "captain"}, {"_id": 0})
    return await db.users.find_one({"role": "captain"}, {"_id": 0})


async def preview_digest(db, kind: str, email: str | None) -> dict:
    """Build (but do NOT send / grant) a preview payload for an admin.
    Returns {subject, html, data, target_email?}."""
    kind = (kind or "").lower()
    if kind == "rider":
        u = await _pick_rider(db, email)
        if not u:
            return {}
        data = await build_rider_digest(db, u)
        return {
            "subject": f"Your {APP_BRAND} week: {data['rides']} rides, ₹{int(data['spend'])} spent",
            "html": _rider_html(u.get("name") or u["email"].split("@")[0], data, rider_id=u["user_id"]),
            "data": data,
            "target_email": u.get("email"),
        }
    if kind == "captain":
        u = await _pick_captain(db, email)
        if not u:
            return {}
        data = await build_captain_digest(db, u)
        return {
            "subject": f"You earned ₹{int(data['earnings'])} on {APP_BRAND} this week",
            "html": _captain_html(u.get("name") or u["email"].split("@")[0], data),
            "data": data,
            "target_email": u.get("email"),
        }
    if kind == "admin":
        data = await build_admin_digest(db)
        return {
            "subject": f"{APP_BRAND} weekly digest: ₹{int(data['revenue'])} · {data['rides']} rides",
            "html": _admin_html(data),
            "data": data,
            "target_email": None,
        }
    return {}
