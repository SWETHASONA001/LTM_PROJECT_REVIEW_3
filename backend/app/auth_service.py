"""Minimal user authentication: PBKDF2-hashed passwords and HMAC-signed tokens.

Users live in <storage>/users.json (git-ignored) and are created with
`python create_user.py`. No default users or passwords exist in code.
The signing secret comes from AEROHYDRO_SECRET or is generated once into
<storage>/secret.key.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from . import config

ITERATIONS = 240_000
TOKEN_TTL_S = 12 * 3600


def _users_file():
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    return config.STORAGE_DIR / "users.json"


def _secret() -> bytes:
    env = os.getenv("AEROHYDRO_SECRET")
    if env:
        return env.encode()
    f = config.STORAGE_DIR / "secret.key"
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text(secrets.token_hex(32), encoding="utf-8")
    return f.read_text(encoding="utf-8").strip().encode()


def load_users() -> list[dict[str, Any]]:
    f = _users_file()
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


def configured() -> bool:
    return bool(load_users())


def _hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS).hex()


def create_user(email: str, name: str, password: str, role: str = "engineer") -> dict[str, Any]:
    if len(password) < 10:
        raise ValueError("Password must be at least 10 characters.")
    users = [u for u in load_users() if u["email"].lower() != email.lower()]
    salt = secrets.token_bytes(16)
    user = {"email": email.lower(), "name": name, "role": role, "salt": salt.hex(), "hash": _hash(password, salt)}
    users.append(user)
    _users_file().write_text(json.dumps(users, indent=2), encoding="utf-8")
    return public(user)


def public(u: dict[str, Any]) -> dict[str, Any]:
    return {"email": u["email"], "name": u["name"], "role": u["role"]}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_token(user: dict[str, Any]) -> tuple[str, int]:
    exp = int(time.time()) + TOKEN_TTL_S
    payload = _b64(json.dumps({**public(user), "exp": exp}, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}", exp


def verify_token(token: str) -> dict[str, Any] | None:
    try:
        payload, sig = token.split(".", 1)
    except ValueError:
        return None
    good = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, good):
        return None
    data = json.loads(_unb64(payload))
    if data.get("exp", 0) < time.time():
        return None
    return data


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    user = next((u for u in load_users() if u["email"] == email.lower()), None)
    if not user:
        _hash(password, b"0" * 16)  # equalise timing for unknown users
        return None
    if not hmac.compare_digest(_hash(password, bytes.fromhex(user["salt"])), user["hash"]):
        return None
    return user


# ------------------------------------------------------ accounts from env ----

def seed_from_env() -> list[str]:
    """Create accounts from environment secrets so they survive restarts on hosts
    without persistent disks (e.g. Render free tier).

    AEROHYDRO_ADMIN_EMAIL / AEROHYDRO_ADMIN_NAME / AEROHYDRO_ADMIN_PASSWORD  -> one admin
    AEROHYDRO_USERS = JSON list of {"email","name","password","role"}         -> invited users
    """
    created = []
    specs: list[dict[str, str]] = []
    if os.getenv("AEROHYDRO_ADMIN_EMAIL") and os.getenv("AEROHYDRO_ADMIN_PASSWORD"):
        specs.append({"email": os.environ["AEROHYDRO_ADMIN_EMAIL"], "name": os.getenv("AEROHYDRO_ADMIN_NAME", "Administrator"), "password": os.environ["AEROHYDRO_ADMIN_PASSWORD"], "role": "admin"})
    if os.getenv("AEROHYDRO_USERS"):
        specs.extend(json.loads(os.environ["AEROHYDRO_USERS"]))
    for sp in specs:
        existing = next((u for u in load_users() if u["email"] == sp["email"].strip().lower()), None)
        if existing and hmac.compare_digest(_hash(sp["password"], bytes.fromhex(existing["salt"])), existing["hash"]):
            continue
        create_user(sp["email"].strip(), sp.get("name", sp["email"]), sp["password"], sp.get("role", "engineer"))
        created.append(sp["email"].strip().lower())
    return created


# ------------------------------------------------------------ self sign-up ----

def signup_allowed() -> bool:
    """Self-registration is on by default for local use; set AEROHYDRO_ALLOW_SIGNUP=0 to disable."""
    return os.getenv("AEROHYDRO_ALLOW_SIGNUP", "1").strip().lower() not in {"0", "false", "no"}


def register(email: str, name: str, password: str) -> dict[str, Any]:
    email = email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Enter a valid email address.")
    if not name.strip():
        raise ValueError("Enter your name.")
    if any(u["email"] == email for u in load_users()):
        raise ValueError("An account with this email already exists. Sign in or reset your password.")
    return create_user(email, name.strip(), password, role="engineer")


# --------------------------------------------------------- password reset ----

RESET_TTL_S = 30 * 60


def _resets_file():
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    return config.STORAGE_DIR / "password_resets.json"


def _load_resets() -> list[dict[str, Any]]:
    f = _resets_file()
    now = time.time()
    items = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    return [r for r in items if r["exp"] > now]


def create_reset(email: str) -> str | None:
    """Create a single-use reset token (only its hash is stored). None for unknown emails."""
    email = email.strip().lower()
    if not any(u["email"] == email for u in load_users()):
        return None
    raw = secrets.token_urlsafe(32)
    items = [r for r in _load_resets() if r["email"] != email]  # one active link per user
    items.append({"email": email, "hash": hashlib.sha256(raw.encode()).hexdigest(), "exp": time.time() + RESET_TTL_S})
    _resets_file().write_text(json.dumps(items, indent=2), encoding="utf-8")
    return raw


def reset_password(raw_token: str, new_password: str) -> dict[str, Any]:
    h = hashlib.sha256(raw_token.encode()).hexdigest()
    items = _load_resets()
    match = next((r for r in items if hmac.compare_digest(r["hash"], h)), None)
    if not match:
        raise ValueError("This reset link is invalid or has expired. Request a new one.")
    user = next((u for u in load_users() if u["email"] == match["email"]), None)
    if not user:
        raise ValueError("This reset link is invalid or has expired. Request a new one.")
    updated = create_user(user["email"], user["name"], new_password, user["role"])  # validates length
    _resets_file().write_text(json.dumps([r for r in items if r is not match], indent=2), encoding="utf-8")
    return updated
