"""Weekly digest emails via Emergent-managed Resend integration.

Sends three kinds of digests every Monday 08:00 IST (also manually via
POST /api/admin/digest/send):
  - Rider   : rides + spend + credits over last 7 days
  - Captain : earnings + rides + rating over last 7 days
  - Admin   : platform revenue + rides + top captains over last 7 days

Follows the Emergent Resend playbook — every send goes through
`_assert_safe_email` and passes `from_name` (the app's own brand).
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
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
# Digest data builders
# =============================================================================
def _week_window() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    end = now
    start = end - timedelta(days=7)
    return start, end


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


async def build_rider_digest(db, rider: dict) -> dict:
    start, end = _week_window()
    match = {
        "rider_id": rider["user_id"],
        "created_at": {"$gte": start, "$lt": end},
    }
    total = await db.rides.count_documents(match)
    completed_match = {**match, "status": "COMPLETED"}
    spend, completed = await _sum_fare(db, completed_match)
    cancelled = await db.rides.count_documents({**match, "status": "CANCELLED"})
    fresh = await db.users.find_one({"user_id": rider["user_id"]}, {"_id": 0})
    credits = round(float(fresh.get("credits", 0) or 0), 2) if fresh else 0.0
    return {
        "rides": total,
        "completed": completed,
        "cancelled": cancelled,
        "spend": spend,
        "credits": credits,
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
    return {
        "rides": rides,
        "earnings": earn,
        "avg_rating_week": avg,
        "ratings_count_week": n_ratings,
        "lifetime_avg": round(float((fresh or {}).get("avg_rating", 0) or 0), 2),
        "lifetime_ratings": int((fresh or {}).get("total_ratings", 0) or 0),
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
    return {
        "revenue": rev,
        "rides": rides,
        "cancelled": cancelled,
        "new_riders": new_riders,
        "new_captains": new_captains,
        "top_captains": top_captains,
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


def _rider_html(name: str, d: dict) -> str:
    body = (
        f'<h1 style="color:#FFCC00;font-size:24px;margin:12px 0 4px">Your week in Alwar</h1>'
        f'<p style="color:#bfbfbf;margin:0 0 20px">Hi {escape(name)}, here is your last 7 days on {escape(APP_BRAND)}.</p>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px">'
        f'<tr>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">{d["rides"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rides booked</div></td>'
        f'<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">&#8377;{int(d["spend"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Total spend</div></td>'
        f'<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">&#8377;{int(d["credits"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Credit balance</div></td>'
        '</tr></table>'
        f'<p style="color:#cfcfcf;margin:16px 0 0">Completed: <b>{d["completed"]}</b> · '
        f'Cancelled: <b>{d["cancelled"]}</b></p>'
        f'<p style="margin:24px 0 4px"><a href="{APP_URL}" style="background:#FFCC00;color:#111;padding:12px 20px;'
        f'border-radius:24px;text-decoration:none;font-weight:700;display:inline-block">Book your next ride</a></p>'
    )
    return _shell(body)


def _captain_html(name: str, d: dict) -> str:
    body = (
        f'<h1 style="color:#FFCC00;font-size:24px;margin:12px 0 4px">Your week on the road</h1>'
        f'<p style="color:#bfbfbf;margin:0 0 20px">Namaste {escape(name)}, here is your last 7 days.</p>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px">'
        f'<tr>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">&#8377;{int(d["earnings"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Earnings</div></td>'
        f'<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">{d["rides"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rides done</div></td>'
        f'<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:28px;font-weight:800;color:#FFCC00">{d["avg_rating_week"] or "-"}&#9733;</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rating (week)</div></td>'
        '</tr></table>'
        f'<p style="color:#cfcfcf;margin:16px 0 0">Lifetime: <b>{d["lifetime_avg"] or "-"}&#9733;</b> '
        f'from <b>{d["lifetime_ratings"]}</b> ratings</p>'
        f'<p style="margin:24px 0 4px"><a href="{APP_URL}" style="background:#FFCC00;color:#111;padding:12px 20px;'
        f'border-radius:24px;text-decoration:none;font-weight:700;display:inline-block">Go online</a></p>'
    )
    return _shell(body)


def _admin_html(d: dict) -> str:
    rows = ""
    for i, c in enumerate(d["top_captains"], 1):
        rows += (
            f'<tr><td style="padding:8px;border-bottom:1px solid #333;color:#eaeaea">{i}. {escape(c["name"])}</td>'
            f'<td style="padding:8px;border-bottom:1px solid #333;color:#FFCC00;text-align:right">&#8377;{int(c["earnings"])}</td>'
            f'<td style="padding:8px;border-bottom:1px solid #333;color:#bfbfbf;text-align:right">{c["rides"]} rides</td></tr>'
        )
    if not rows:
        rows = ('<tr><td colspan="3" style="padding:12px;color:#888;text-align:center">No completed rides this week.</td></tr>')
    body = (
        f'<h1 style="color:#FFCC00;font-size:24px;margin:12px 0 4px">Weekly platform digest</h1>'
        f'<p style="color:#bfbfbf;margin:0 0 20px">Last 7 days on {escape(APP_BRAND)}.</p>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px">'
        f'<tr>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:26px;font-weight:800;color:#FFCC00">&#8377;{int(d["revenue"])}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Revenue</div></td>'
        f'<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:26px;font-weight:800;color:#FFCC00">{d["rides"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Rides completed</div></td>'
        f'<td style="width:8px"></td>'
        f'<td style="padding:16px;background:#242424;border-radius:10px;text-align:center;width:33%">'
        f'<div style="font-size:26px;font-weight:800;color:#FFCC00">{d["cancelled"]}</div>'
        f'<div style="font-size:12px;color:#9a9a9a">Cancellations</div></td>'
        '</tr></table>'
        f'<p style="color:#cfcfcf;margin:16px 0 0">New riders: <b>{d["new_riders"]}</b> · '
        f'New captains: <b>{d["new_captains"]}</b></p>'
        '<h3 style="color:#eaeaea;margin:24px 0 8px">Top captains</h3>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px">{rows}</table>'
    )
    return _shell(body)


# =============================================================================
# Dispatch
# =============================================================================
async def send_weekly_digests(db) -> dict:
    """Send weekly digests to eligible riders, captains and admin recipients.
    Returns a summary dict of counts."""
    start, end = _week_window()
    sent = {"riders": 0, "captains": 0, "admins": 0, "skipped": 0, "failed": 0}

    # Riders: only those with at least 1 ride last week
    rider_ids = await db.rides.distinct("rider_id",
                                         {"created_at": {"$gte": start, "$lt": end}})
    riders = await db.users.find(
        {"user_id": {"$in": rider_ids}, "role": "rider"}, {"_id": 0}
    ).to_list(1000) if rider_ids else []
    for u in riders:
        if not u.get("email") or "@" not in u["email"]:
            sent["skipped"] += 1; continue
        try:
            data = await build_rider_digest(db, u)
            html = _rider_html(u.get("name") or u["email"].split("@")[0], data)
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
    cap_ids = await db.rides.distinct("captain_id",
                                       {"status": "COMPLETED",
                                        "completed_at": {"$gte": start, "$lt": end}})
    cap_ids = [c for c in cap_ids if c]
    captains = await db.users.find(
        {"user_id": {"$in": cap_ids}, "role": "captain"}, {"_id": 0}
    ).to_list(1000) if cap_ids else []
    for u in captains:
        if not u.get("email") or "@" not in u["email"]:
            sent["skipped"] += 1; continue
        try:
            data = await build_captain_digest(db, u)
            html = _captain_html(u.get("name") or u["email"].split("@")[0], data)
            res = await send_email(
                to=u["email"],
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


async def preview_digest(db, kind: str, email: str) -> dict:
    """Build (but don't necessarily send) a preview payload for an admin.
    Returns {subject, html, data}."""
    kind = (kind or "").lower()
    if kind == "rider":
        u = await db.users.find_one({"email": email.lower(), "role": "rider"}, {"_id": 0})
        if not u:
            return {}
        data = await build_rider_digest(db, u)
        return {
            "subject": f"Your {APP_BRAND} week: {data['rides']} rides, ₹{int(data['spend'])} spent",
            "html": _rider_html(u.get("name") or u["email"].split("@")[0], data),
            "data": data,
        }
    if kind == "captain":
        u = await db.users.find_one({"email": email.lower(), "role": "captain"}, {"_id": 0})
        if not u:
            return {}
        data = await build_captain_digest(db, u)
        return {
            "subject": f"You earned ₹{int(data['earnings'])} on {APP_BRAND} this week",
            "html": _captain_html(u.get("name") or u["email"].split("@")[0], data),
            "data": data,
        }
    if kind == "admin":
        data = await build_admin_digest(db)
        return {
            "subject": f"{APP_BRAND} weekly digest: ₹{int(data['revenue'])} · {data['rides']} rides",
            "html": _admin_html(data),
            "data": data,
        }
    return {}
