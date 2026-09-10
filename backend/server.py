from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Digest emails (must import AFTER load_dotenv so env vars are available)
from digest import (
    send_weekly_digests,
    start_scheduler,
    stop_scheduler,
    preview_digest,
    send_email as _send_email,
)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
}

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============================================================================
# Models
# ============================================================================
Role = Literal["rider", "captain", "unset"]
CaptainStatus = Literal["pending", "approved", "blocked"]
RideStatus = Literal["REQUESTED", "ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]


class User(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    phone: Optional[str] = None
    vehicle_number: Optional[str] = None
    role: Role = "unset"
    is_admin: bool = False
    captain_status: CaptainStatus = "pending"
    online: bool = False
    credits: float = 0.0
    avg_rating: float = 0.0
    total_ratings: int = 0
    referral_code: Optional[str] = None
    referred_by: Optional[str] = None  # referrer's user_id
    referral_bonus_granted: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SessionExchange(BaseModel):
    session_id: str


class RoleUpdate(BaseModel):
    role: Role


class ProfileUpdate(BaseModel):
    phone: Optional[str] = None
    name: Optional[str] = None


class LatLng(BaseModel):
    lat: float
    lng: float


class DriverLocationUpdate(BaseModel):
    lat: float
    lng: float
    online: bool = True


class RideCreate(BaseModel):
    pickup_address: str
    pickup: LatLng
    drop_address: str
    drop: LatLng
    vehicle: Literal["Nafis Bike", "Nafis Auto"]
    distance_km: float
    fare: float
    apply_credits: bool = False


class Ride(BaseModel):
    ride_id: str
    rider_id: str
    rider_name: Optional[str] = None
    rider_phone: Optional[str] = None
    captain_id: Optional[str] = None
    captain_name: Optional[str] = None
    captain_vehicle_number: Optional[str] = None
    pickup_address: str
    pickup: LatLng
    drop_address: str
    drop: LatLng
    vehicle: str
    distance_km: float
    fare: float
    payment_method: str = "cash"
    status: RideStatus = "REQUESTED"
    cancel_reason: Optional[str] = None
    cancelled_by: Optional[str] = None
    rating: Optional[int] = None
    rated_at: Optional[datetime] = None
    credits_applied: float = 0.0
    reward_granted: float = 0.0
    accepted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FareConfig(BaseModel):
    base_fare: float = 15.0
    per_km: float = 8.0


# ============================================================================
# Auth
# ============================================================================
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


@api_router.post("/auth/session")
async def exchange_session(body: SessionExchange):
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email", "").lower()
    name = data.get("name")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Bad session data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # promote admin if email in list
        if email in ADMIN_EMAILS and not existing.get("is_admin"):
            await db.users.update_one({"user_id": user_id}, {"$set": {"is_admin": True}})
            existing["is_admin"] = True
        user = existing
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = User(
            user_id=user_id,
            email=email,
            name=name,
            picture=picture,
            role="unset",
            is_admin=email in ADMIN_EMAILS,
        ).dict()
        await db.users.insert_one(dict(user))
        user.pop("_id", None)

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })

    user.pop("_id", None)
    return {"session_token": session_token, "user": user}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user}


@api_router.post("/auth/dev-login")
async def dev_login(body: dict):
    """Dev-only: mint a session for a test email. Guarded by DEV_MODE env."""
    if os.environ.get("DEV_MODE", "true").lower() not in ("1", "true", "yes"):
        raise HTTPException(status_code=404, detail="Not found")
    email = (body.get("email") or "").lower().strip()
    name = body.get("name") or email.split("@")[0]
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        if email in ADMIN_EMAILS and not existing.get("is_admin"):
            await db.users.update_one({"user_id": user_id}, {"$set": {"is_admin": True}})
            existing["is_admin"] = True
        user = existing
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = User(
            user_id=user_id, email=email, name=name, role="unset",
            is_admin=email in ADMIN_EMAILS,
        ).dict()
        await db.users.insert_one(dict(user))
    user.pop("_id", None)
    session_token = f"dev_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    return {"session_token": session_token, "user": user}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        await db.user_sessions.delete_one({"session_token": authorization[7:]})
    return {"ok": True}


# ============================================================================
# User
# ============================================================================
@api_router.post("/users/role")
async def set_role(body: RoleUpdate, user: dict = Depends(get_current_user)):
    updates = {"role": body.role}
    if body.role == "captain":
        if user.get("captain_status") == "pending":
            updates["captain_status"] = "approved"
        if not user.get("vehicle_number"):
            # RJ 02 (Alwar) plate format
            import random
            letters = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=2))
            digits = f"{random.randint(1000, 9999)}"
            updates["vehicle_number"] = f"RJ 02 {letters} {digits}"
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": updated}


@api_router.patch("/users/me")
async def update_profile(body: ProfileUpdate, user: dict = Depends(get_current_user)):
    updates = {}
    if body.phone is not None: updates["phone"] = body.phone.strip()
    if body.name is not None: updates["name"] = body.name.strip()
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": updated}


# ============================================================================
# Rides
# ============================================================================
def haversine_km(a: LatLng, b: LatLng) -> float:
    R = 6371
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = math.radians(b.lat - a.lat)
    dlng = math.radians(b.lng - a.lng)
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(h))


async def get_fare_config() -> FareConfig:
    doc = await db.config.find_one({"key": "fare"}, {"_id": 0})
    if not doc:
        cfg = FareConfig()
        await db.config.insert_one({"key": "fare", **cfg.dict()})
        return cfg
    return FareConfig(base_fare=doc.get("base_fare", 15.0), per_km=doc.get("per_km", 8.0))


@api_router.get("/config/fare")
async def get_fare():
    cfg = await get_fare_config()
    return cfg.dict()


@api_router.post("/rides")
async def create_ride(body: RideCreate, user: dict = Depends(get_current_user)):
    if user.get("role") != "rider":
        raise HTTPException(status_code=400, detail="Only riders can book")
    credits_applied = 0.0
    final_fare = body.fare
    if body.apply_credits and (user.get("credits") or 0) > 0:
        credits_applied = min(user["credits"], body.fare)
        final_fare = max(0.0, body.fare - credits_applied)
        await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"credits": -credits_applied}})
    ride = Ride(
        ride_id=f"ride_{uuid.uuid4().hex[:12]}",
        rider_id=user["user_id"],
        rider_name=user.get("name") or user.get("email"),
        rider_phone=user.get("phone"),
        pickup_address=body.pickup_address,
        pickup=body.pickup,
        drop_address=body.drop_address,
        drop=body.drop,
        vehicle=body.vehicle,
        distance_km=body.distance_km,
        fare=final_fare,
        credits_applied=credits_applied,
        status="REQUESTED",
    )
    doc = ride.dict()
    doc["pickup"] = ride.pickup.dict()
    doc["drop"] = ride.drop.dict()
    await db.rides.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"ride": doc}


@api_router.get("/rides/mine")
async def my_rides(user: dict = Depends(get_current_user)):
    q = {"rider_id": user["user_id"]} if user.get("role") == "rider" else {"captain_id": user["user_id"]}
    rides = await db.rides.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"rides": rides}


@api_router.get("/rides/pending")
async def pending_rides(user: dict = Depends(get_current_user)):
    if user.get("role") != "captain":
        raise HTTPException(status_code=403, detail="Captains only")
    if user.get("captain_status") != "approved":
        return {"rides": []}
    rides = await db.rides.find({"status": "REQUESTED"}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return {"rides": rides}


# Simulation constants: how long each phase lasts (seconds)
PHASE_APPROACH_SECONDS = 30   # captain moves from starting point to pickup
PHASE_TRIP_SECONDS     = 90   # captain moves from pickup to drop


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * max(0.0, min(1.0, t))


def _simulate_ride(ride: dict) -> tuple[dict, Optional[dict]]:
    """Attach simulated captain location + auto-advance status based on time elapsed
    since accepted_at. Returns (ride_dict, pending_update_or_None)."""
    status = ride.get("status")
    if status not in ("ACCEPTED", "ARRIVING", "IN_PROGRESS"):
        return ride, None

    accepted_at = ride.get("accepted_at")
    if not accepted_at:
        return ride, None
    if isinstance(accepted_at, datetime) and accepted_at.tzinfo is None:
        accepted_at = accepted_at.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - accepted_at).total_seconds()

    pickup = ride.get("pickup") or {}
    drop = ride.get("drop") or {}
    plat, plng = pickup.get("lat"), pickup.get("lng")
    dlat, dlng = drop.get("lat"), drop.get("lng")
    if None in (plat, plng, dlat, dlng):
        return ride, None

    start_lat = plat - 0.005
    start_lng = plng - 0.005

    if elapsed < PHASE_APPROACH_SECONDS:
        t = elapsed / PHASE_APPROACH_SECONDS
        cap_lat = _lerp(start_lat, plat, t)
        cap_lng = _lerp(start_lng, plng, t)
        new_status = "ARRIVING" if elapsed > 5 else "ACCEPTED"
    elif elapsed < PHASE_APPROACH_SECONDS + PHASE_TRIP_SECONDS:
        t = (elapsed - PHASE_APPROACH_SECONDS) / PHASE_TRIP_SECONDS
        cap_lat = _lerp(plat, dlat, t)
        cap_lng = _lerp(plng, dlng, t)
        new_status = "IN_PROGRESS"
    else:
        cap_lat, cap_lng = dlat, dlng
        new_status = "COMPLETED"

    ride["captain_location"] = {"lat": cap_lat, "lng": cap_lng}

    pending = None
    if new_status != status:
        ride["status"] = new_status
        pending = {"status": new_status, "updated_at": datetime.now(timezone.utc)}
        if new_status == "COMPLETED":
            ride["completed_at"] = datetime.now(timezone.utc)
            pending["completed_at"] = ride["completed_at"]
    return ride, pending


@api_router.get("/rides/{ride_id}")
async def get_ride(ride_id: str, user: dict = Depends(get_current_user)):
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Not found")
    ride, pending = _simulate_ride(ride)
    if pending:
        await db.rides.update_one({"ride_id": ride_id}, {"$set": pending})
        if pending.get("status") == "COMPLETED" and ride.get("rider_id"):
            await _grant_reward_if_due(ride["rider_id"], ride_id)
            await _grant_referral_bonus_if_due(ride["rider_id"])
            ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0}) or ride
    return {"ride": ride}


@api_router.post("/rides/{ride_id}/accept")
async def accept_ride(ride_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "captain":
        raise HTTPException(status_code=403, detail="Captains only")
    if user.get("captain_status") != "approved":
        raise HTTPException(status_code=403, detail="Captain not approved")
    now = datetime.now(timezone.utc)
    result = await db.rides.update_one(
        {"ride_id": ride_id, "status": "REQUESTED"},
        {"$set": {
            "status": "ACCEPTED",
            "captain_id": user["user_id"],
            "captain_name": user.get("name") or user.get("email"),
            "captain_vehicle_number": user.get("vehicle_number"),
            "accepted_at": now,
            "updated_at": now,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Ride not available")
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    return {"ride": ride}


REWARD_AMOUNT = 50.0
REWARD_EVERY = 5
REFERRAL_BONUS = 50.0


def _gen_referral_code() -> str:
    import random, string
    return "NAF" + "".join(random.choices(string.ascii_uppercase + string.digits, k=5))


async def _ensure_referral_code(user_id: str) -> str:
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if u and u.get("referral_code"):
        return u["referral_code"]
    # try until unique
    for _ in range(6):
        code = _gen_referral_code()
        exists = await db.users.find_one({"referral_code": code}, {"_id": 0})
        if not exists:
            await db.users.update_one({"user_id": user_id}, {"$set": {"referral_code": code}})
            return code
    # fallback
    code = _gen_referral_code() + str(uuid.uuid4().hex[:2])
    await db.users.update_one({"user_id": user_id}, {"$set": {"referral_code": code}})
    return code


async def _grant_referral_bonus_if_due(rider_id: str) -> float:
    """If rider was referred and this is their 1st completed ride, grant ₹REFERRAL_BONUS to
    both parties. Idempotent via `referral_bonus_granted`."""
    rider = await db.users.find_one({"user_id": rider_id}, {"_id": 0})
    if not rider or rider.get("referral_bonus_granted") or not rider.get("referred_by"):
        return 0.0
    completed = await db.rides.count_documents({"rider_id": rider_id, "status": "COMPLETED"})
    if completed < 1:
        return 0.0
    referrer_id = rider["referred_by"]
    await db.users.update_one({"user_id": rider_id}, {
        "$inc": {"credits": REFERRAL_BONUS},
        "$set": {"referral_bonus_granted": True},
    })
    await db.users.update_one({"user_id": referrer_id}, {"$inc": {"credits": REFERRAL_BONUS}})
    return REFERRAL_BONUS


async def _grant_reward_if_due(rider_id: str, ride_id: str) -> float:
    """Grant ₹REWARD_AMOUNT credit if rider's completed count is a multiple of REWARD_EVERY.
    Idempotent per ride via `reward_granted` flag. Returns granted amount."""
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    if not ride or ride.get("reward_granted"):
        return 0.0
    completed = await db.rides.count_documents({"rider_id": rider_id, "status": "COMPLETED"})
    if completed > 0 and completed % REWARD_EVERY == 0:
        await db.users.update_one({"user_id": rider_id}, {"$inc": {"credits": REWARD_AMOUNT}})
        await db.rides.update_one({"ride_id": ride_id}, {"$set": {"reward_granted": REWARD_AMOUNT}})
        return REWARD_AMOUNT
    return 0.0


@api_router.post("/rides/{ride_id}/status")
async def update_status(ride_id: str, body: dict, user: dict = Depends(get_current_user)):
    new_status = body.get("status")
    if new_status not in ("ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Bad status")
    update = {"status": new_status, "updated_at": datetime.now(timezone.utc)}
    if new_status == "COMPLETED":
        update["completed_at"] = datetime.now(timezone.utc)
    if new_status == "CANCELLED":
        update["cancelled_at"] = datetime.now(timezone.utc)
        update["cancelled_by"] = user.get("role") or "unknown"
        reason = (body.get("reason") or "").strip()
        if reason:
            update["cancel_reason"] = reason[:120]
    await db.rides.update_one({"ride_id": ride_id}, {"$set": update})
    if new_status == "COMPLETED":
        ride0 = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
        if ride0 and ride0.get("rider_id"):
            await _grant_reward_if_due(ride0["rider_id"], ride_id)
            await _grant_referral_bonus_if_due(ride0["rider_id"])
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    return {"ride": ride}


@api_router.post("/rides/{ride_id}/rate")
async def rate_ride(ride_id: str, body: dict, user: dict = Depends(get_current_user)):
    """Rider rates the captain 1-5 stars after ride completion."""
    stars = body.get("rating")
    if not isinstance(stars, int) or stars < 1 or stars > 5:
        raise HTTPException(status_code=400, detail="rating must be 1-5")
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.get("rider_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the rider can rate")
    if ride.get("status") != "COMPLETED":
        raise HTTPException(status_code=400, detail="Rate only completed rides")
    if ride.get("rating"):
        raise HTTPException(status_code=409, detail="Already rated")

    await db.rides.update_one({"ride_id": ride_id}, {"$set": {
        "rating": stars,
        "rated_at": datetime.now(timezone.utc),
    }})
    cap_id = ride.get("captain_id")
    if cap_id:
        # Recompute captain's avg rating
        cursor = db.rides.aggregate([
            {"$match": {"captain_id": cap_id, "rating": {"$ne": None}}},
            {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "n": {"$sum": 1}}},
        ])
        avg, n = 0.0, 0
        async for d in cursor:
            avg = round(d.get("avg", 0), 2); n = d.get("n", 0)
        await db.users.update_one({"user_id": cap_id}, {"$set": {"avg_rating": avg, "total_ratings": n}})
    return {"ok": True, "rating": stars}


@api_router.get("/rewards/me")
async def my_rewards(user: dict = Depends(get_current_user)):
    code = await _ensure_referral_code(user["user_id"])
    completed = await db.rides.count_documents({"rider_id": user["user_id"], "status": "COMPLETED"})
    remaining = REWARD_EVERY - (completed % REWARD_EVERY) if completed % REWARD_EVERY != 0 else REWARD_EVERY
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {
        "credits": round(fresh.get("credits", 0), 2),
        "completed_rides": completed,
        "rides_until_next_reward": remaining if completed > 0 else REWARD_EVERY,
        "reward_amount": REWARD_AMOUNT,
        "reward_every": REWARD_EVERY,
        "referral_code": code,
        "referral_bonus": REFERRAL_BONUS,
        "referred_by": fresh.get("referred_by"),
    }


class ReferralApply(BaseModel):
    code: str


@api_router.post("/referral/apply")
async def apply_referral(body: ReferralApply, user: dict = Depends(get_current_user)):
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Code required")
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if me.get("referred_by"):
        raise HTTPException(status_code=409, detail="Already used a referral code")
    completed = await db.rides.count_documents({"rider_id": user["user_id"], "status": "COMPLETED"})
    if completed > 0:
        raise HTTPException(status_code=409, detail="Referral must be applied before your first ride")
    referrer = await db.users.find_one({"referral_code": code}, {"_id": 0})
    if not referrer:
        raise HTTPException(status_code=404, detail="Invalid code")
    if referrer["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="You can't refer yourself")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referred_by": referrer["user_id"]}})
    return {"ok": True, "referrer_name": referrer.get("name") or referrer.get("email")}


@api_router.get("/peak/now")
async def peak_now(user: dict = Depends(get_current_user)):
    """Is this hour a peak hour based on last 30 days? Used by captain rush banner."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    cursor = db.rides.aggregate([
        {"$match": {"created_at": {"$gte": since}}},
        {"$project": {"hour": {"$hour": {"date": "$created_at", "timezone": "Asia/Kolkata"}}}},
        {"$group": {"_id": "$hour", "n": {"$sum": 1}}},
    ])
    counts = {i: 0 for i in range(24)}
    async for d in cursor:
        if d["_id"] is not None:
            counts[d["_id"]] = d.get("n", 0)
    total = sum(counts.values())
    avg = total / 24 if total else 0
    # current hour in IST
    import zoneinfo
    ist = datetime.now(zoneinfo.ZoneInfo("Asia/Kolkata"))
    hour = ist.hour
    current = counts.get(hour, 0)
    is_peak = current > 0 and current >= max(2, avg * 1.5)
    bonus_multiplier = 1.5 if is_peak else 1.0
    return {
        "is_peak": is_peak,
        "current_hour": hour,
        "current_hour_rides": current,
        "avg_hour_rides": round(avg, 1),
        "bonus_multiplier": bonus_multiplier,
        "message": (
            f"🔥 Rush hour in Alwar — earn {int((bonus_multiplier - 1) * 100)}% more right now!"
            if is_peak else "No rush right now — you'll be notified when it hits."
        ),
    }


class RideMessageBody(BaseModel):
    text: str


CANNED_MESSAGES = [
    "I'm here",
    "I'm on my way",
    "5 min late",
    "Can't find you",
    "Please call me",
    "Almost there",
    "Please wait",
    "Thanks!",
]


@api_router.get("/rides/{ride_id}/messages/canned")
async def canned_list(ride_id: str, user: dict = Depends(get_current_user)):
    return {"canned": CANNED_MESSAGES}


@api_router.get("/rides/{ride_id}/messages")
async def get_messages(ride_id: str, user: dict = Depends(get_current_user)):
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0, "messages": 1, "rider_id": 1, "captain_id": 1})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if user["user_id"] not in (ride.get("rider_id"), ride.get("captain_id")) and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not your ride")
    return {"messages": ride.get("messages") or []}


@api_router.post("/rides/{ride_id}/messages")
async def send_message(ride_id: str, body: RideMessageBody, user: dict = Depends(get_current_user)):
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0, "rider_id": 1, "captain_id": 1, "status": 1})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if user["user_id"] not in (ride.get("rider_id"), ride.get("captain_id")):
        raise HTTPException(status_code=403, detail="Not your ride")
    if ride.get("status") in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Ride ended")
    text = (body.text or "").strip()[:200]
    if not text:
        raise HTTPException(status_code=400, detail="Empty message")
    role = "rider" if user["user_id"] == ride.get("rider_id") else "captain"
    msg = {
        "id": uuid.uuid4().hex[:10],
        "from": role,
        "from_name": user.get("name") or user.get("email"),
        "text": text,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rides.update_one({"ride_id": ride_id}, {"$push": {"messages": msg}})
    return {"ok": True, "message": msg}


@api_router.post("/admin/rides/{ride_id}/force-complete")
async def admin_force_complete(ride_id: str, user: dict = Depends(require_admin)):
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.get("status") in ("COMPLETED", "CANCELLED"):
        return {"ride": ride, "changed": False}
    now = datetime.now(timezone.utc)
    await db.rides.update_one({"ride_id": ride_id}, {"$set": {
        "status": "COMPLETED", "completed_at": now, "updated_at": now,
    }})
    if ride.get("rider_id"):
        await _grant_reward_if_due(ride["rider_id"], ride_id)
        await _grant_referral_bonus_if_due(ride["rider_id"])
    ride = await db.rides.find_one({"ride_id": ride_id}, {"_id": 0})
    return {"ride": ride, "changed": True}


@api_router.get("/captains/me/earnings")
async def captain_earnings(user: dict = Depends(get_current_user)):
    """Today + all-time earnings for the current captain."""
    if user.get("role") != "captain":
        raise HTTPException(status_code=403, detail="Captains only")
    from datetime import time as _time
    now = datetime.now(timezone.utc)
    sod = datetime.combine(now.date(), _time.min, tzinfo=timezone.utc)

    async def _sum(match):
        cursor = db.rides.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "sum": {"$sum": "$fare"}, "count": {"$sum": 1}}},
        ])
        s, c = 0, 0
        async for d in cursor:
            s = d.get("sum", 0); c = d.get("count", 0)
        return round(s, 2), c

    today_earn, today_rides = await _sum(
        {"status": "COMPLETED", "captain_id": user["user_id"], "completed_at": {"$gte": sod}}
    )
    total_earn, total_rides = await _sum(
        {"status": "COMPLETED", "captain_id": user["user_id"]}
    )
    active = await db.rides.count_documents(
        {"captain_id": user["user_id"], "status": {"$in": ["ACCEPTED", "ARRIVING", "IN_PROGRESS"]}}
    )
    return {
        "today_earnings": today_earn,
        "today_rides": today_rides,
        "total_earnings": total_earn,
        "total_rides": total_rides,
        "active_rides": active,
    }


# ============================================================================
# Driver locations
# ============================================================================
@api_router.post("/driver-locations")
async def update_location(body: DriverLocationUpdate, user: dict = Depends(get_current_user)):
    if user.get("role") != "captain":
        raise HTTPException(status_code=403, detail="Captains only")
    await db.driver_locations.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "user_id": user["user_id"],
            "name": user.get("name") or user.get("email"),
            "lat": body.lat,
            "lng": body.lng,
            "online": body.online,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"online": body.online}})
    return {"ok": True}


@api_router.get("/driver-locations")
async def list_locations():
    locs = await db.driver_locations.find({"online": True}, {"_id": 0}).to_list(200)
    return {"locations": locs}


# ============================================================================
# Admin
# ============================================================================
@api_router.get("/admin/peak-hours")
async def admin_peak_hours(user: dict = Depends(require_admin)):
    """Aggregate rides + cancellations by hour of day (IST). Last 30 days."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    IST_OFFSET_MIN = 330  # +05:30
    cursor = db.rides.aggregate([
        {"$match": {"created_at": {"$gte": since}}},
        {"$project": {
            "hour": {"$hour": {"date": "$created_at", "timezone": "Asia/Kolkata"}},
            "status": 1,
        }},
        {"$group": {
            "_id": "$hour",
            "rides": {"$sum": 1},
            "cancellations": {"$sum": {"$cond": [{"$eq": ["$status", "CANCELLED"]}, 1, 0]}},
        }},
    ])
    by_hour = {i: {"hour": i, "rides": 0, "cancellations": 0} for i in range(24)}
    async for d in cursor:
        h = d["_id"]
        if h is None: continue
        by_hour[h] = {"hour": h, "rides": d.get("rides", 0), "cancellations": d.get("cancellations", 0)}
    return {"hours": [by_hour[i] for i in range(24)]}


@api_router.get("/admin/revenue/weekly")
async def admin_weekly_revenue(user: dict = Depends(require_admin)):
    """Revenue and ride counts for each of the last 7 days (ending today)."""
    from datetime import time as _time
    now = datetime.now(timezone.utc)
    sod_today = datetime.combine(now.date(), _time.min, tzinfo=timezone.utc)
    days = []
    for i in range(6, -1, -1):
        start = sod_today - timedelta(days=i)
        end = start + timedelta(days=1)
        cursor = db.rides.aggregate([
            {"$match": {"status": "COMPLETED", "completed_at": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": None, "sum": {"$sum": "$fare"}, "count": {"$sum": 1}}},
        ])
        s, c = 0, 0
        async for d in cursor:
            s = d.get("sum", 0); c = d.get("count", 0)
        days.append({
            "date": start.date().isoformat(),
            "weekday": start.strftime("%a"),
            "revenue": round(s, 2),
            "rides": c,
        })
    return {"days": days}


@api_router.get("/admin/cancel-reasons")
async def admin_cancel_reasons(user: dict = Depends(require_admin)):
    """Aggregate cancellation reasons (last 30 days)."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    cursor = db.rides.aggregate([
        {"$match": {"status": "CANCELLED", "cancelled_at": {"$gte": since}}},
        {"$group": {
            "_id": {"reason": "$cancel_reason", "by": "$cancelled_by"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
    ])
    rows = []
    async for d in cursor:
        rows.append({
            "reason": d["_id"].get("reason") or "No reason given",
            "by": d["_id"].get("by") or "unknown",
            "count": d.get("count", 0),
        })
    return {"reasons": rows}


@api_router.get("/admin/overview")
async def admin_overview(user: dict = Depends(require_admin)):
    from datetime import time as _time
    now = datetime.now(timezone.utc)
    start_of_day = datetime.combine(now.date(), _time.min, tzinfo=timezone.utc)

    riders = await db.users.count_documents({"role": "rider"})
    captains = await db.users.count_documents({"role": "captain"})
    active_captains = await db.users.count_documents({"role": "captain", "online": True})
    live_rides = await db.rides.count_documents({"status": {"$in": ["REQUESTED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"]}})
    total_rides = await db.rides.count_documents({})
    completed_rides = await db.rides.count_documents({"status": "COMPLETED"})
    cancelled_rides = await db.rides.count_documents({"status": "CANCELLED"})

    total_rev_cur = db.rides.aggregate([
        {"$match": {"status": "COMPLETED"}},
        {"$group": {"_id": None, "sum": {"$sum": "$fare"}}},
    ])
    total_rev = 0
    async for d in total_rev_cur:
        total_rev = d.get("sum", 0)

    today_rev_cur = db.rides.aggregate([
        {"$match": {"status": "COMPLETED", "completed_at": {"$gte": start_of_day}}},
        {"$group": {"_id": None, "sum": {"$sum": "$fare"}, "count": {"$sum": 1}}},
    ])
    today_rev, today_rides = 0, 0
    async for d in today_rev_cur:
        today_rev = d.get("sum", 0)
        today_rides = d.get("count", 0)

    active_drivers = await db.driver_locations.find(
        {"online": True}, {"_id": 0}
    ).to_list(50)

    return {
        "riders": riders,
        "captains": captains,
        "active_captains": active_captains,
        "live_rides": live_rides,
        "total_rides": total_rides,
        "completed_rides": completed_rides,
        "cancelled_rides": cancelled_rides,
        "total_revenue": round(total_rev, 2),
        "today_revenue": round(today_rev, 2),
        "today_rides": today_rides,
        "active_drivers": active_drivers,
    }


@api_router.get("/admin/earnings")
async def admin_earnings(user: dict = Depends(require_admin)):
    """Per-captain earnings (COMPLETED rides only)."""
    pipeline = [
        {"$match": {"status": "COMPLETED", "captain_id": {"$ne": None}}},
        {"$group": {
            "_id": "$captain_id",
            "captain_name": {"$last": "$captain_name"},
            "captain_vehicle_number": {"$last": "$captain_vehicle_number"},
            "earnings": {"$sum": "$fare"},
            "rides": {"$sum": 1},
        }},
        {"$sort": {"earnings": -1}},
        {"$limit": 100},
    ]
    rows = []
    async for d in db.rides.aggregate(pipeline):
        rows.append({
            "captain_id": d["_id"],
            "captain_name": d.get("captain_name"),
            "captain_vehicle_number": d.get("captain_vehicle_number"),
            "earnings": round(d.get("earnings", 0), 2),
            "rides": d.get("rides", 0),
        })
    return {"earnings": rows}


@api_router.get("/admin/users")
async def admin_users(role: Optional[str] = None, user: dict = Depends(require_admin)):
    q = {"role": role} if role in ("rider", "captain") else {}
    users = await db.users.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"users": users}


@api_router.get("/admin/rides")
async def admin_rides(user: dict = Depends(require_admin)):
    rides = await db.rides.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"rides": rides}


@api_router.put("/admin/fare")
async def admin_update_fare(body: FareConfig, user: dict = Depends(require_admin)):
    await db.config.update_one(
        {"key": "fare"},
        {"$set": {"base_fare": body.base_fare, "per_km": body.per_km}},
        upsert=True,
    )
    return body.dict()


@api_router.post("/admin/captains/{captain_id}/status")
async def admin_captain_status(captain_id: str, body: dict, user: dict = Depends(require_admin)):
    status = body.get("status")
    if status not in ("pending", "approved", "blocked"):
        raise HTTPException(status_code=400, detail="Bad status")
    await db.users.update_one({"user_id": captain_id}, {"$set": {"captain_status": status}})
    return {"ok": True}


@api_router.post("/admin/claim")
async def admin_claim(body: dict, user: dict = Depends(get_current_user)):
    """Claim admin using a shared code (demo). In production, use ADMIN_EMAILS env."""
    code = body.get("code")
    expected = os.environ.get("ADMIN_CODE", "NAFIS-ADMIN")
    if code != expected:
        raise HTTPException(status_code=403, detail="Invalid code")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"is_admin": True}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": updated}


# ============================================================================
# Digest emails (Resend via Emergent-managed integration)
# ============================================================================
class DigestPreviewBody(BaseModel):
    kind: Literal["rider", "captain", "admin"]
    email: Optional[str] = None


class DigestTestBody(BaseModel):
    to: str


@api_router.post("/admin/digest/send")
async def admin_digest_send(user: dict = Depends(require_admin)):
    """Trigger a full weekly digest run manually. Returns per-role counts."""
    summary = await send_weekly_digests(db)
    return {"ok": True, "summary": summary}


@api_router.post("/admin/digest/preview")
async def admin_digest_preview(body: DigestPreviewBody, user: dict = Depends(require_admin)):
    """Render a digest preview without sending or granting credits.
    If `email` is omitted for rider/captain, an eligible user is auto-picked."""
    email = (body.email or "").strip() or None
    payload = await preview_digest(db, body.kind, email)
    if not payload:
        raise HTTPException(status_code=404, detail=f"No {body.kind} available for preview")
    return payload


@api_router.post("/admin/digest/test-send")
async def admin_digest_test_send(body: DigestTestBody, user: dict = Depends(require_admin)):
    """Send a small test email to a single admin-controlled address."""
    email = (body.to or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    from digest import _admin_html, APP_BRAND
    data = {"revenue": 0, "rides": 0, "cancelled": 0, "new_riders": 0, "new_captains": 0, "top_captains": []}
    html = _admin_html(data)
    msg_id = await _send_email(
        to=email,
        subject=f"{APP_BRAND} — email delivery test",
        html=html,
    )
    return {"ok": bool(msg_id), "email_id": msg_id}


@api_router.get("/admin/digest/runs")
async def admin_digest_runs(user: dict = Depends(require_admin)):
    """Recent digest send history."""
    runs = await db.digest_runs.find({}, {"_id": 0}).sort("run_at", -1).to_list(20)
    return {"runs": runs}


# ============================================================================
# Root
# ============================================================================
@api_router.get("/")
async def root():
    return {"service": "Nafis Ride API", "ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.rides.create_index("ride_id", unique=True)
    await db.rides.create_index([("status", 1), ("created_at", -1)])
    await db.driver_locations.create_index("user_id", unique=True)
    # seed fare config
    if not await db.config.find_one({"key": "fare"}):
        await db.config.insert_one({"key": "fare", "base_fare": 15.0, "per_km": 8.0})
    # Start weekly digest scheduler (Mondays 08:00 IST)
    try:
        start_scheduler(db)
    except Exception as e:
        logger.exception("Failed to start digest scheduler: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        stop_scheduler()
    except Exception:
        pass
    client.close()
