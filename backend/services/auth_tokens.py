"""
Token generation and hashing utilities for SeriqCare authentication.

Access tokens  — short-lived JWTs (10 min), returned in response body, kept in memory
Refresh tokens — opaque 64-char random strings, SHA-256 hashed in DB
                 • Web:    stored in HttpOnly "seriqcare-rt" cookie (30 days)
                 • Mobile: stored in flutter_secure_storage (30 days)
"""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta

from jose import jwt
from backend.auth.constants import PLATFORM_LOGIN_CODE


def _require_jwt_secret() -> str:
    secret = (os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("Missing JWT secret: set SECRET_KEY or JWT_SECRET in .env")
    return secret


_SECRET = _require_jwt_secret()
_ALGORITHM = "HS256"

ACCESS_TOKEN_MINUTES: int = 10
REFRESH_TOKEN_DAYS: int = 30
REFRESH_GRACE_WINDOW_SECONDS: int = 300   # 5-minute window for rotation retries


def generate_refresh_token() -> str:
    """Cryptographically secure 64-char URL-safe refresh token (never stored raw)."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """SHA-256 hash of a token for DB storage."""
    return hashlib.sha256(token.encode()).hexdigest()


def generate_agency_refresh_token(agency_id: int | None) -> str:
    # The full value is verified against its stored hash before inspecting this
    # binding. Changing the tenant prefix therefore invalidates the token.
    binding = f't-{agency_id}' if agency_id is not None else 'platform'
    return f'{binding}.{generate_refresh_token()}'


def refresh_token_matches_agency(token: str, agency_id: int | None) -> bool:
    binding = f't-{agency_id}' if agency_id is not None else 'platform'
    return token.startswith(f'{binding}.')


def make_access_token(user, jti: str, agency_code: str | None = None) -> str:
    """Create a 10-minute access JWT containing the standard SeriqCare claims."""
    if user.role == 'super_admin':
        agency_code = PLATFORM_LOGIN_CODE
    now = datetime.utcnow()
    payload = {
        "sub": user.username,
        "user_id": user.id,
        "role": user.role,
        "agency_id": user.agency_id,
        "agency_code": agency_code,
        "employee_id": user.employee_id,
        "jti": jti,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)
