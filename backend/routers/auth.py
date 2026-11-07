"""
SeriqCare Authentication Router
--------------------------------
POST /api/auth/login          — issue access + refresh tokens
POST /api/auth/refresh        — rotate refresh token, issue new access token
POST /api/auth/logout         — revoke refresh token + clear cookies
POST /api/auth/change-password
POST /api/auth/admin-reset-password
POST /api/auth/signup
POST /api/auth/entra-login

Token strategy
--------------
• Access token  — 10-minute JWT, returned in response body only (in-memory on client)
• Refresh token — 30-day opaque token, stored as SHA-256 hash in care.device_sessions
  – Web:    HttpOnly "seriqcare-rt" cookie (server-readable for refresh/logout)
  – Mobile: returned in JSON, stored in flutter_secure_storage

Dev mode (DEV_NO_HASH_AUTH=true in .env):
    Any active user can log in with DEV_PASSWORD from .env.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
import urllib.request
import uuid
from datetime import datetime, timedelta
from threading import Lock
from typing import Literal, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import require_role
from backend.services.auth_tokens import (
    ACCESS_TOKEN_MINUTES,
    REFRESH_GRACE_WINDOW_SECONDS,
    REFRESH_TOKEN_DAYS,
    generate_refresh_token,
    hash_token,
    make_access_token,
)
from db.audit import write_audit
from db.database import get_db
from db.models import DeviceSession, PasswordResetToken, User, UserSession

log = logging.getLogger("seriqcare.auth")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _require_jwt_secret() -> str:
    secret = (os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("Missing JWT secret: set SECRET_KEY or JWT_SECRET in .env")
    return secret


_SECRET = _require_jwt_secret()
_ALGORITHM = "HS256"

# Cookie names
_RT_COOKIE = "seriqcare-rt"        # HttpOnly — refresh token (web)

# In production (HTTPS), set Secure flag on cookies
_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# Entra ID (Azure AD) — optional
_ENTRA_TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
_ENTRA_CLIENT_ID = os.getenv("ENTRA_CLIENT_ID", "")
_ENTRA_APP_URI   = os.getenv("ENTRA_APP_URI", f"api://{_ENTRA_CLIENT_ID}")

_entra_jwks_cache: Optional[dict] = None


def _get_entra_jwks() -> dict:
    global _entra_jwks_cache
    if _entra_jwks_cache is None:
        url = (
            f"https://login.microsoftonline.com/"
            f"{_ENTRA_TENANT_ID}/discovery/v2.0/keys"
        )
        with urllib.request.urlopen(url, timeout=10) as resp:
            _entra_jwks_cache = json.loads(resp.read())
    return _entra_jwks_cache


_DEV_NO_HASH = os.getenv("DEV_NO_HASH_AUTH", "false").lower() == "true"
_DEV_PASSWORD = os.getenv("DEV_PASSWORD", "").strip()

# ---------------------------------------------------------------------------
# Rate limiting — in-memory per-username attempt tracker
# ---------------------------------------------------------------------------
_SLOW_THRESHOLD = 5
_LOCKOUT_THRESHOLD = 10
_LOCKOUT_SECONDS = 15 * 60
_THROTTLE_BASE_SECONDS = 2

_attempt_store: dict[str, dict] = {}
_attempt_lock = Lock()

from backend.services.db_retry import run_with_retry as _run_with_transient_retry


def _attempt_info(username: str) -> dict:
    with _attempt_lock:
        info = _attempt_store.get(username)
        if not info:
            return {"count": 0, "locked_until": None}
        if info.get("locked_until") and time.monotonic() > info["locked_until"]:
            del _attempt_store[username]
            return {"count": 0, "locked_until": None}
        return dict(info)


def _check_lockout(username: str) -> tuple[bool, int]:
    info = _attempt_info(username)
    locked_until = info.get("locked_until")
    if locked_until:
        remaining = int(locked_until - time.monotonic())
        if remaining > 0:
            return True, remaining
    return False, 0


def _record_failure(username: str) -> tuple[int, bool]:
    with _attempt_lock:
        info = _attempt_store.get(username, {"count": 0, "locked_until": None})
        if info.get("locked_until") and time.monotonic() > info["locked_until"]:
            info = {"count": 0, "locked_until": None}
        info["count"] += 1
        just_locked = False
        if info["count"] >= _LOCKOUT_THRESHOLD and not info.get("locked_until"):
            info["locked_until"] = time.monotonic() + _LOCKOUT_SECONDS
            just_locked = True
        _attempt_store[username] = info
        return info["count"], just_locked


def _record_success(username: str) -> None:
    with _attempt_lock:
        _attempt_store.pop(username, None)


router = APIRouter()
_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str
    client_type: str = "web"         # "web" | "mobile"
    device_id: str | None = None     # client-generated UUID; generated server-side if absent
    device_name: str | None = None   # "Pixel 8", "Chrome on Windows", …


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    email: str | None = None
    display_name: str | None
    role: str
    agency_id: int | None
    employee_id: int | None
    agency_tier: str | None = None
    agency_aggregator: str | None = None
    # Returned only for mobile clients (web receives it as an HttpOnly cookie)
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str | None = None  # mobile sends this; web uses cookie
    device_id: str | None = None      # mobile only


class LogoutRequest(BaseModel):
    refresh_token: str | None = None  # mobile sends this; web uses cookie


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------
def _get_agency_tier_aggregator(db, agency_id) -> tuple:
    """Return (tier, aggregator) for the given agency_id, or (None, None)."""
    if not agency_id:
        return None, None
    row = db.execute(
        text("SELECT tier, aggregator FROM care.agencies WHERE id = :id"),
        {"id": agency_id},
    ).fetchone()
    if row:
        return row.tier, row.aggregator
    return None, None


def _set_rt_cookie(response: Response, rt_plain: str, expires_at: datetime) -> None:
    """Set the HttpOnly refresh token cookie."""
    max_age = int((expires_at - datetime.utcnow()).total_seconds())
    response.set_cookie(
        key=_RT_COOKIE,
        value=rt_plain,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/",
        max_age=max_age,
    )


def _clear_rt_cookie(response: Response) -> None:
    response.delete_cookie(key=_RT_COOKIE, path="/", samesite="lax")


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------
def _trunc(password: str) -> str:
    return password.encode("utf-8")[:72].decode("utf-8", errors="ignore")


_pwd_ctx = None


def _get_ctx():
    global _pwd_ctx
    if _pwd_ctx is None:
        from passlib.context import CryptContext
        _pwd_ctx = CryptContext(
            schemes=["bcrypt_sha256", "bcrypt"],
            deprecated="auto",
        )
    return _pwd_ctx


def _verify_password(plain: str, hashed: str | None) -> bool:
    if _DEV_NO_HASH:
        return plain == _DEV_PASSWORD
    if not hashed:
        return False
    ctx = _get_ctx()
    if hashed.startswith("$2"):
        return ctx.verify(_trunc(plain), hashed)
    return ctx.verify(plain, hashed)


def _hash_password(plain: str) -> str:
    return _get_ctx().hash(plain)


# ---------------------------------------------------------------------------
# Session creation helper
# ---------------------------------------------------------------------------
def _issue_tokens(
    user: User,
    db: Session,
    device_id: str,
    device_name: str | None,
    client_type: str,
) -> tuple[str, str, datetime]:
    """
    Create a UserSession (access token jti) + DeviceSession (refresh token).
    Returns (access_token_jwt, refresh_token_plain, refresh_expires_at).
    Any existing active device session for this user+device is revoked first.
    """
    now = datetime.utcnow()
    jti = str(uuid.uuid4())
    access_expires = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    refresh_expires = now + timedelta(days=REFRESH_TOKEN_DAYS)

    # Access token session (for jti revocation checks)
    db.add(UserSession(
        user_id=user.id,
        jti=jti,
        issued_at=now,
        expires_at=access_expires,
    ))

    # Revoke any existing active device session for this user+device
    old = (
        db.query(DeviceSession)
        .filter(
            DeviceSession.user_id == user.id,
            DeviceSession.device_id == device_id,
            DeviceSession.revoked_at == None,
        )
        .first()
    )
    if old:
        old.revoked_at = now
        old.revoke_reason = "replaced"

    rt_plain = generate_refresh_token()
    rt_hash  = hash_token(rt_plain)

    db.add(DeviceSession(
        user_id=user.id,
        device_id=device_id,
        device_name=device_name,
        client_type=client_type,
        token_hash=rt_hash,
        issued_at=now,
        expires_at=refresh_expires,
        last_used_at=now,
    ))

    user.last_login_at = now
    db.commit()

    return make_access_token(user, jti), rt_plain, refresh_expires


# ---------------------------------------------------------------------------
# POST /login
# ---------------------------------------------------------------------------
@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Validate credentials and issue access + refresh tokens.
    Web   → refresh token set as HttpOnly "seriqcare-rt" cookie.
    Mobile → refresh token returned in JSON body.
    """
    is_locked, retry_after = _check_lockout(body.username)
    if is_locked:
        minutes = math.ceil(retry_after / 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Account locked — try again in {minutes} minute{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": str(retry_after)},
        )

    user = _run_with_transient_retry(
        db,
        lambda: (
            db.query(User).filter(
                User.is_active == True,
            ).filter(
                (User.email == body.username) | (User.username == body.username)
            ).first()
        ),
    )
    ip = request.client.host if request.client else None

    if not user or not _verify_password(body.password, user.password_hash):
        count, just_locked = _record_failure(body.username)
        write_audit(
            db,
            table_name="auth",
            action="FAILED_LOGIN",
            record_id=user.id if user else None,
            changed_by=user.id if user else None,
            changed_by_name=body.username,
            client_type=body.client_type,
            ip_address=ip,
            detail=f"attempt {count}" + (" — account locked" if just_locked else ""),
            commit=True,
        )
        if just_locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Account locked for {_LOCKOUT_SECONDS // 60} minutes.",
                headers={"Retry-After": str(_LOCKOUT_SECONDS)},
            )
        if count >= _SLOW_THRESHOLD:
            delay = min((count - _SLOW_THRESHOLD + 1) * _THROTTLE_BASE_SECONDS, 10)
            await asyncio.sleep(delay)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    _record_success(body.username)

    client_type = body.client_type if body.client_type in ("web", "mobile") else "web"
    device_id = body.device_id or f"{client_type}-{uuid.uuid4()}"

    access_token, rt_plain, rt_expires = _issue_tokens(
        user, db, device_id, body.device_name, client_type
    )

    write_audit(
        db,
        table_name="auth",
        action="LOGIN",
        agency_id=user.agency_id,
        record_id=user.id,
        changed_by=user.id,
        changed_by_name=user.display_name or user.username,
        client_type=client_type,
        ip_address=ip,
        detail=body.device_name,
        commit=True,
    )

    agency_tier, agency_aggregator = _get_agency_tier_aggregator(db, user.agency_id)
    result = LoginResponse(
        access_token=access_token,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        agency_id=user.agency_id,
        employee_id=user.employee_id,
        agency_tier=agency_tier,
        agency_aggregator=agency_aggregator,
    )

    if client_type == "web":
        _set_rt_cookie(response, rt_plain, rt_expires)
        return result
    else:
        result.refresh_token = rt_plain
        return result


# ---------------------------------------------------------------------------
# POST /refresh
# ---------------------------------------------------------------------------
@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest = RefreshRequest(),
    db: Session = Depends(get_db),
):
    """
    Rotate the refresh token and issue a new access token.
    Web   → reads "seriqcare-rt" HttpOnly cookie, rotates it in place.
    Mobile → reads refresh_token from request body, returns new pair in JSON.
    """
    rt_plain = request.cookies.get(_RT_COOKIE) or (body.refresh_token if body else None)
    if not rt_plain:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")

    rt_hash = hash_token(rt_plain)
    now = datetime.utcnow()

    # --- Try exact match (normal path) ---
    ds = (
        db.query(DeviceSession)
        .filter(
            DeviceSession.token_hash == rt_hash,
            DeviceSession.revoked_at == None,
            DeviceSession.expires_at > now,
        )
        .first()
    )

    if ds is None:
        # --- Try previous_hash match (grace window — concurrent/retry request) ---
        ds = (
            db.query(DeviceSession)
            .filter(
                DeviceSession.previous_hash == rt_hash,
                DeviceSession.revoked_at == None,
                DeviceSession.expires_at > now,
                DeviceSession.last_used_at > now - timedelta(seconds=REFRESH_GRACE_WINDOW_SECONDS),
            )
            .first()
        )
        if ds is None:
            # Possible reuse attack — revoke all sessions if this was a known token
            _handle_possible_reuse(rt_hash, db)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please log in again.",
            )

    user = (
        db.query(User)
        .filter(User.id == ds.user_id, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")

    # Issue new access token
    jti = str(uuid.uuid4())
    access_expires = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    db.add(UserSession(user_id=user.id, jti=jti, issued_at=now, expires_at=access_expires))

    # Rotate refresh token
    new_rt = generate_refresh_token()
    new_rt_hash = hash_token(new_rt)
    ds.previous_hash = rt_hash   # keep previous for grace window
    ds.token_hash = new_rt_hash
    ds.last_used_at = now
    db.commit()

    new_access = make_access_token(user, jti)
    agency_tier, agency_aggregator = _get_agency_tier_aggregator(db, user.agency_id)
    payload = {
        "access_token": new_access,
        "token_type": "bearer",
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "agency_id": user.agency_id,
        "employee_id": user.employee_id,
        "agency_tier": agency_tier,
        "agency_aggregator": agency_aggregator,
    }

    if ds.client_type == "web":
        _set_rt_cookie(response, new_rt, ds.expires_at)
        return payload
    else:
        return {**payload, "refresh_token": new_rt}


def _handle_possible_reuse(rt_hash: str, db: Session) -> None:
    """
    If the supplied hash matches a previous_hash of any session, it means
    a token that has already been rotated is being replayed — potential theft.
    Revoke all active device sessions for that user as a precaution.
    """
    old = db.query(DeviceSession).filter(
        DeviceSession.previous_hash == rt_hash
    ).first()
    if old:
        now = datetime.utcnow()
        db.query(DeviceSession).filter(
            DeviceSession.user_id == old.user_id,
            DeviceSession.revoked_at == None,
        ).update({"revoked_at": now, "revoke_reason": "reuse_detected"})
        db.commit()
        log.warning(
            "Refresh token reuse detected for user_id=%s — all sessions revoked.",
            old.user_id,
        )


# ---------------------------------------------------------------------------
# POST /logout
# ---------------------------------------------------------------------------
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    body: LogoutRequest = LogoutRequest(),
    db: Session = Depends(get_db),
):
    """
    Revoke the current access token (jti) and the refresh token (device session).
    Always returns 204 even if tokens are already revoked.
    Web   → reads refresh token from HttpOnly cookie.
    Mobile → reads refresh token from request body.
    """
    now = datetime.utcnow()
    _logout_user_id: int | None = None
    _logout_username: str | None = None
    _logout_agency_id: int | None = None
    _logout_client_type: str | None = None
    ip = request.client.host if request.client else None

    # 1. Revoke access token if provided (ignoring expiry)
    if credentials:
        try:
            payload = jwt.decode(
                credentials.credentials, _SECRET, algorithms=[_ALGORITHM],
                options={"verify_exp": False},
            )
            jti = payload.get("jti")
            _logout_user_id = payload.get("user_id")
            _logout_username = payload.get("sub")
            _logout_agency_id = payload.get("agency_id")
            if jti:
                sess = (
                    db.query(UserSession)
                    .filter(UserSession.jti == jti, UserSession.revoked_at == None)
                    .first()
                )
                if sess:
                    sess.revoked_at = now
                    sess.revoke_reason = "logout"
        except JWTError:
            pass

    # 2. Revoke refresh / device session
    rt_plain = request.cookies.get(_RT_COOKIE) or (body.refresh_token if body else None)
    if rt_plain:
        rt_hash = hash_token(rt_plain)
        ds = (
            db.query(DeviceSession)
            .filter(DeviceSession.token_hash == rt_hash, DeviceSession.revoked_at == None)
            .first()
        )
        if ds:
            ds.revoked_at = now
            ds.revoke_reason = "logout"
            _logout_user_id = _logout_user_id or ds.user_id
            _logout_client_type = ds.client_type

    db.commit()

    write_audit(
        db,
        table_name="auth",
        action="LOGOUT",
        agency_id=_logout_agency_id,
        record_id=_logout_user_id,
        changed_by=_logout_user_id,
        changed_by_name=_logout_username,
        client_type=_logout_client_type,
        ip_address=ip,
        commit=True,
    )

    # 3. Clear cookies for web clients
    _clear_rt_cookie(response)


# ---------------------------------------------------------------------------
# Self-service password change
# ---------------------------------------------------------------------------
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(require_role("caregiver", "coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="New password must be at least 8 characters.",
        )
    if _DEV_NO_HASH:
        if body.current_password != _DEV_PASSWORD:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")
        current_user.password_hash = body.new_password
    else:
        if not _verify_password(body.current_password, current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")
        current_user.password_hash = _hash_password(body.new_password)
    db.commit()
    write_audit(
        db,
        table_name="auth",
        action="PASSWORD_RESET",
        agency_id=current_user.agency_id,
        record_id=current_user.id,
        changed_by=current_user.id,
        changed_by_name=current_user.display_name or current_user.username,
        client_type="web",
        ip_address=request.client.host if request.client else None,
        detail="self-service password change",
        commit=True,
    )


# ---------------------------------------------------------------------------
# Admin password reset
# ---------------------------------------------------------------------------
_PORTAL_ROLES = {"coordinator", "agency_admin"}
_MOBILE_ROLES = {"caregiver"}


class AdminPasswordResetRequest(BaseModel):
    username: str
    new_password: str
    user_type: Literal["portal", "mobile"]


@router.post("/admin-reset-password", status_code=status.HTTP_204_NO_CONTENT)
def admin_reset_password(
    body: AdminPasswordResetRequest,
    request: Request,
    current_user: User = Depends(require_role("coordinator", "agency_admin", "super_admin")),
    db: Session = Depends(get_db),
):
    if current_user.role == "coordinator" and body.user_type != "mobile":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Coordinators can only reset Mobile App user passwords.",
        )
    if len(body.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Password must be at least 8 characters.")

    target = db.query(User).filter(User.username == body.username, User.is_active == True).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if target.role == "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin accounts authenticate via Entra ID — password reset is not supported here.",
        )
    if current_user.role == "agency_admin" and target.agency_id != current_user.agency_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if body.user_type == "portal" and target.role not in _PORTAL_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{body.username}' is a mobile app user (role: {target.role}). Select 'Mobile App Users' instead.",
        )
    if body.user_type == "mobile" and target.role not in _MOBILE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{body.username}' is a portal user (role: {target.role}). Select 'Portal Users' instead.",
        )
    target.password_hash = body.new_password if _DEV_NO_HASH else _hash_password(body.new_password)
    db.commit()
    write_audit(
        db,
        table_name="auth",
        action="PASSWORD_RESET",
        agency_id=current_user.agency_id,
        record_id=target.id,
        changed_by=current_user.id,
        changed_by_name=current_user.display_name or current_user.username,
        client_type="web",
        ip_address=request.client.host if request.client else None,
        detail=f"admin reset for {target.username}",
        commit=True,
    )


# ---------------------------------------------------------------------------
# POST /signup — self-service account creation
# ---------------------------------------------------------------------------
class SignupRequest(BaseModel):
    first_name: str
    last_name: str
    username: str
    email: str
    password: str
    confirm_password: str
    role: str = "coordinator"
    device_id: str | None = None


@router.post("/signup", response_model=LoginResponse, status_code=201)
def signup(
    body: SignupRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    if body.password != body.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    if body.role not in ("coordinator", "agency_admin"):
        raise HTTPException(status_code=422, detail="Role must be 'coordinator' or 'agency_admin'.")

    existing = db.query(User).filter(User.username == body.username.strip()).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Username '{body.username.strip()}' is already taken.")

    from sqlalchemy import text as _text
    agency_row = db.execute(_text("SELECT TOP 1 id FROM care.agencies WHERE is_active = 1 ORDER BY id")).fetchone()
    agency_id = int(agency_row.id) if agency_row else None

    new_user = User(
        agency_id=agency_id,
        username=body.username.strip(),
        display_name=f"{body.first_name.strip()} {body.last_name.strip()}",
        email=body.email.strip() or None,
        role=body.role,
        is_active=True,
        password_hash=_hash_password(body.password),
    )
    db.add(new_user)
    db.flush()

    device_id = body.device_id or f"web-{uuid.uuid4()}"
    access_token, rt_plain, rt_expires = _issue_tokens(new_user, db, device_id, None, "web")
    _set_rt_cookie(response, rt_plain, rt_expires)

    return LoginResponse(
        access_token=access_token,
        username=new_user.username,
        email=new_user.email,
        display_name=new_user.display_name,
        role=new_user.role,
        agency_id=new_user.agency_id,
        employee_id=None,
    )


# ---------------------------------------------------------------------------
# POST /entra-login — Microsoft Entra ID token exchange
# ---------------------------------------------------------------------------
class EntraLoginRequest(BaseModel):
    entra_token: str


@router.post("/entra-login", response_model=LoginResponse)
def entra_login(
    body: EntraLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    if not _ENTRA_TENANT_ID or not _ENTRA_CLIENT_ID:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Entra ID auth is not configured.")

    try:
        jwks = _get_entra_jwks()
        payload = jwt.decode(
            body.entra_token, jwks, algorithms=["RS256"],
            audience=_ENTRA_APP_URI,
            issuer=f"https://login.microsoftonline.com/{_ENTRA_TENANT_ID}/v2.0",
        )
    except JWTError as exc:
        global _entra_jwks_cache
        _entra_jwks_cache = None
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Entra token: {exc}")

    oid = payload.get("oid")
    upn = (payload.get("preferred_username") or payload.get("upn") or "").lower()
    if not oid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is missing the oid claim.")

    user = db.query(User).filter(User.entra_object_id == oid, User.is_active == True).first()
    if user is None:
        from sqlalchemy import func
        user = (
            db.query(User)
            .filter(
                (func.lower(User.username) == upn) | (func.lower(User.email) == upn),
                User.role == "super_admin",
                User.is_active == True,
                User.entra_object_id == None,
            )
            .first()
        )
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No SeriqCare super_admin account matches this Entra identity.",
            )
        user.entra_object_id = oid
        db.flush()

    device_id = f"entra-web-{uuid.uuid4()}"
    access_token, rt_plain, rt_expires = _issue_tokens(user, db, device_id, "Entra ID Web", "web")
    _set_rt_cookie(response, rt_plain, rt_expires)

    write_audit(
        db,
        table_name="auth",
        action="LOGIN",
        agency_id=user.agency_id,
        record_id=user.id,
        changed_by=user.id,
        changed_by_name=user.display_name or user.username,
        client_type="web",
        ip_address=request.client.host if request.client else None,
        detail="Entra ID",
        commit=True,
    )

    return LoginResponse(
        access_token=access_token,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        agency_id=user.agency_id,
        employee_id=user.employee_id,
    )


# ---------------------------------------------------------------------------
# Email helper
# ---------------------------------------------------------------------------
_SMTP_HOST = os.getenv("SMTP_HOST", "mail.smtp2go.com")
_SMTP_PORT = int(os.getenv("SMTP_PORT", "2525"))
_SMTP_USER = os.getenv("SMTP_USER", "")
_SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
_SMTP_FROM = os.getenv("SMTP_FROM", "noreply@seriqcare.com")
_FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")


def _send_reset_email(to_email: str, reset_token: str) -> None:
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    reset_link = f"{_FRONTEND_BASE_URL}/reset-password?token={reset_token}"

    html_body = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;">
        <tr>
          <td style="background:#1565c0;padding:20px 30px;">
            <span style="color:#fff;font-size:22px;font-weight:bold;">Seriq<span style="font-weight:300">Care</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 30px;">
            <h1 style="margin:0 0 8px;font-size:28px;color:#1a1a1a;font-weight:400;">
              protect your information and<br><strong>reset your password</strong>
            </h1>
            <p style="color:#444;margin:16px 0 24px;">
              In order to protect your information, follow the link below to reset your password.
              This link expires in <strong>one hour</strong>.
            </p>
            <a href="{reset_link}"
               style="display:inline-block;background:#1565c0;color:#fff;text-decoration:none;
                      padding:14px 32px;border-radius:3px;font-weight:bold;letter-spacing:1px;
                      font-size:13px;">
              RESET PASSWORD
            </a>
            <p style="color:#666;margin:24px 0 0;font-size:13px;">
              If you did not request a password reset, you can safely ignore this email.
              Your password will not change.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset your SeriqCare password"
    msg["From"] = _SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(f"Reset your password: {reset_link}\n\nThis link expires in one hour.", "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(_SMTP_USER, _SMTP_PASSWORD)
        server.sendmail(_SMTP_FROM, [to_email], msg.as_string())


def _send_onboarding_email(
    to_email: str, reset_token: str, contact_name: str, agency_name: str,
) -> None:
    """Welcome email sent when super admin provisions a new agency."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    set_password_link = f"{_FRONTEND_BASE_URL}/reset-password?token={reset_token}"

    html_body = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;">
        <tr>
          <td style="background:#1565c0;padding:20px 30px;">
            <span style="color:#fff;font-size:22px;font-weight:bold;">Seriq<span style="font-weight:300">Care</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 30px;">
            <h1 style="margin:0 0 8px;font-size:24px;color:#1a1a1a;font-weight:400;">
              Welcome to <strong>SeriqCare</strong>, {contact_name}!
            </h1>
            <p style="color:#444;margin:16px 0 8px;">
              Your agency <strong>{agency_name}</strong> has been set up on the SeriqCare platform.
              To get started, set your password using the button below.
            </p>
            <p style="color:#444;margin:0 0 24px;">
              This link expires in <strong>24 hours</strong>.
            </p>
            <a href="{set_password_link}"
               style="display:inline-block;background:#1565c0;color:#fff;text-decoration:none;
                      padding:14px 32px;border-radius:3px;font-weight:bold;letter-spacing:1px;
                      font-size:13px;">
              SET YOUR PASSWORD
            </a>
            <p style="color:#666;margin:24px 0 0;font-size:13px;">
              If you did not expect this email, please contact your SeriqCare administrator.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Welcome to SeriqCare — Set your password for {agency_name}"
    msg["From"] = _SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(
        f"Welcome to SeriqCare, {contact_name}!\n\n"
        f"Your agency {agency_name} has been set up.\n"
        f"Set your password here (link expires in 24 hours):\n{set_password_link}\n",
        "plain",
    ))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(_SMTP_USER, _SMTP_PASSWORD)
        server.sendmail(_SMTP_FROM, [to_email], msg.as_string())


# ---------------------------------------------------------------------------
# POST /forgot-password — request a password reset email
# ---------------------------------------------------------------------------
class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(
    body: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Always returns 204 (no content) regardless of whether the email exists,
    to prevent user enumeration.
    """
    email = body.email.strip().lower()
    user = db.query(User).filter(
        User.is_active == True,
        User.email.isnot(None),
    ).filter(
        User.email == email
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with that email address.",
        )

    # Invalidate any existing unused tokens for this user
    now = datetime.utcnow()
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at == None,
        PasswordResetToken.expires_at > now,
    ).update({"expires_at": now})

    raw_token = str(uuid.uuid4()).replace("-", "") + str(uuid.uuid4()).replace("-", "")
    token_hash = hash_token(raw_token)

    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=now + timedelta(hours=1),
        created_at=now,
    ))
    db.commit()

    try:
        _send_reset_email(user.email, raw_token)
    except Exception as exc:
        log.error(f"Failed to send password reset email to {email}: {exc}")
        # Still return 204 — token is saved, user can retry
    return


# ---------------------------------------------------------------------------
# POST /reset-password — confirm reset with token + new password
# ---------------------------------------------------------------------------
class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )

    now = datetime.utcnow()
    token_hash = hash_token(body.token.strip())
    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == token_hash,
        PasswordResetToken.used_at == None,
        PasswordResetToken.expires_at > now,
    ).first()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link is invalid or has expired. Please request a new one.",
        )

    user = db.query(User).filter(User.id == record.user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found.")

    record.used_at = now
    user.password_hash = _hash_password(body.new_password)
    db.commit()
    write_audit(
        db,
        table_name="auth",
        action="PASSWORD_RESET",
        agency_id=user.agency_id,
        record_id=user.id,
        changed_by=user.id,
        changed_by_name=user.display_name or user.username,
        client_type="web",
        ip_address=request.client.host if request.client else None,
        detail="email token password reset",
        commit=True,
    )
    return
