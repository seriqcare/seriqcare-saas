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


def make_access_token(user, jti: str) -> str:
    """Create a 10-minute access JWT containing the standard SeriqCare claims."""
    now = datetime.utcnow()
    payload = {
        "sub": user.username,
        "user_id": user.id,
        "role": user.role,
        "agency_id": user.agency_id,
        "employee_id": user.employee_id,
        "jti": jti,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)
