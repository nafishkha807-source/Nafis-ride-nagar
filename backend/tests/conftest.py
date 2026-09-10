import os
import pytest
import requests
from pathlib import Path


def _load_backend_url() -> str:
    # Prefer explicit env; fall back to frontend .env EXPO_PUBLIC_BACKEND_URL
    url = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if url:
        return url.rstrip("/")
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("Backend URL not configured")


BASE_URL = _load_backend_url()


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture()
def api_client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _dev_login(session: requests.Session, email: str, name: str) -> dict:
    r = session.post(f"{BASE_URL}/api/auth/dev-login", json={"email": email, "name": name})
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="session")
def rider_ctx():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    data = _dev_login(s, "TEST_rider@nafis.dev", "TEST Rider")
    token = data["session_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    # set role
    r = s.post(f"{BASE_URL}/api/users/role", json={"role": "rider"})
    r.raise_for_status()
    return {"session": s, "token": token, "user": r.json()["user"]}


@pytest.fixture(scope="session")
def captain_ctx():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    data = _dev_login(s, "TEST_captain@nafis.dev", "TEST Captain")
    token = data["session_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    r = s.post(f"{BASE_URL}/api/users/role", json={"role": "captain"})
    r.raise_for_status()
    return {"session": s, "token": token, "user": r.json()["user"]}


@pytest.fixture(scope="session")
def admin_ctx():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    data = _dev_login(s, "TEST_admin@nafis.dev", "TEST Admin")
    token = data["session_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    # claim admin
    r = s.post(f"{BASE_URL}/api/admin/claim", json={"code": "NAFIS-ADMIN"})
    r.raise_for_status()
    return {"session": s, "token": token, "user": r.json()["user"]}
