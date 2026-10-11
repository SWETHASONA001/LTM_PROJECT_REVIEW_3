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
