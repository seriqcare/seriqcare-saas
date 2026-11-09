"""
API access-log middleware.

Intercepts every HTTP request and writes one row to audit.api_access_log:
  method, path, query_string, status_code, duration_ms,
  user_id / username / agency_id (from Bearer JWT — never verified here,
  just parsed for identification), ip_address, user_agent.

The DB write runs in a background thread (asyncio.to_thread) so it never
adds latency to the response.  Failures are swallowed — access logging is
best-effort and must never break the main request flow.

Paths that are skipped (docs / health):
  /  /docs  /openapi.json  /redoc  /favicon.ico
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from fastapi import Request
from fastapi.responses import Response
from jose import JWTError, jwt
from sqlalchemy import text

from db.database import engine

log = logging.getLogger("seriqcare.access_log")


def _get_jwt_secret() -> str:
    """Return the JWT secret at call-time.  Returns empty string if unset so
    that JWT claim extraction silently falls back to (None, None, None) rather
    than crashing the app at startup."""
    return (os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "").strip()

_ALGORITHM = "HS256"

_SKIP_PATHS = frozenset([
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/favicon.ico",
    "/api/health",
    "/api/ready",
])


def _extract_jwt_claims(authorization: str) -> tuple[Optional[int], Optional[str], Optional[int]]:
    """Return (user_id, username, agency_id) from a Bearer token, or (None, None, None)."""
    if not authorization.startswith("Bearer "):
        return None, None, None
    secret = _get_jwt_secret()
    if not secret:
        return None, None, None
    try:
        payload = jwt.decode(
            authorization[7:],
            secret,
            algorithms=[_ALGORITHM],
            options={"verify_exp": False},
        )
        return payload.get("user_id"), payload.get("sub"), payload.get("agency_id")
    except JWTError:
        return None, None, None


def _write_to_db(
    method: str,
    path: str,
    query_string: Optional[str],
    status_code: int,
    duration_ms: int,
    user_id: Optional[int],
    username: Optional[str],
    agency_id: Optional[int],
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> None:
    try:
        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO audit.api_access_log
                        (method, path, query_string, status_code, duration_ms,
                         user_id, username, agency_id, ip_address, user_agent)
                    VALUES
                        (:method, :path, :query_string, :status_code, :duration_ms,
                         :user_id, :username, :agency_id, :ip_address, :user_agent)
                """),
                {
                    "method":       method,
                    "path":         path,
                    "query_string": query_string,
                    "status_code":  status_code,
                    "duration_ms":  duration_ms,
                    "user_id":      user_id,
                    "username":     username,
                    "agency_id":    agency_id,
                    "ip_address":   ip_address,
                    "user_agent":   user_agent,
                },
            )
    except Exception as exc:
        log.warning("api_access_log write failed [%s %s]: %s", method, path, exc)


async def api_access_log_middleware(request: Request, call_next) -> Response:
    if request.url.path in _SKIP_PATHS:
        return await call_next(request)

    start = time.monotonic()
    response = await call_next(request)
    duration_ms = int((time.monotonic() - start) * 1000)

    user_id, username, agency_id = _extract_jwt_claims(
        request.headers.get("authorization", "")
    )

    ip          = request.client.host if request.client else None
    user_agent  = (request.headers.get("user-agent", "") or "")[:500] or None
    query       = str(request.url.query)[:1000] or None

    # Fire-and-forget — does not block the response
    asyncio.create_task(
        asyncio.to_thread(
            _write_to_db,
            request.method,
            request.url.path,
            query,
            response.status_code,
            duration_ms,
            user_id,
            username,
            agency_id,
            ip,
            user_agent,
        )
    )

    return response
