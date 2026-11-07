"""
JWT authentication dependency.

Usage in any router:
    from backend.auth.dependencies import get_current_user
    ...
    current_user: User = Depends(get_current_user)

Role-gating helper:
    from backend.auth.dependencies import require_role
    ...
    current_user: User = Depends(require_role("coordinator", "agency_admin"))

Agency scope (mobile coordinator endpoints):
    from backend.auth.dependencies import AgencyScope, get_agency_scope
    ...
    scope: AgencyScope = Depends(get_agency_scope)
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from sqlalchemy import text

from db.database import get_db
from db.models import User, UserSession


def _require_jwt_secret() -> str:
    secret = (os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("Missing JWT secret: set SECRET_KEY or JWT_SECRET in .env")
    return secret


_SECRET = _require_jwt_secret()
_ALGORITHM = "HS256"
_bearer = HTTPBearer()
_TRANSIENT_SQLSTATES = {"08S01", "08001", "08007", "HYT00", "HYT01"}


def _is_transient_db_error(error: Exception) -> bool:
    if not isinstance(error, OperationalError):
        return False
    orig = getattr(error, "orig", None)
    args = getattr(orig, "args", None)
    if not args:
        return False
    first = args[0]
    return isinstance(first, str) and first in _TRANSIENT_SQLSTATES


def _run_with_transient_retry(db: Session, operation: Callable[[], object], retries: int = 1):
    attempt = 0
    while True:
        try:
            return operation()
        except Exception as error:
            if attempt >= retries or not _is_transient_db_error(error):
                raise
            attempt += 1
            db.rollback()
            time.sleep(0.15)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Decode token, verify jti is not revoked, return the active User."""
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, _SECRET, algorithms=[_ALGORITHM])
    except JWTError:
        raise exc

    jti: str | None = payload.get("jti")
    if not jti:
        raise exc

    session = _run_with_transient_retry(
        db,
        lambda: db.query(UserSession).filter(UserSession.jti == jti).first(),
    )
    if not session or session.revoked_at is not None:
        raise exc

    # Compare as naive datetimes (DB stores UTC without tz info)
    if session.expires_at < datetime.utcnow():
        raise exc

    username: str | None = payload.get("sub")
    user = _run_with_transient_retry(
        db,
        lambda: (
            db.query(User)
            .filter(User.username == username, User.is_active == True)
            .first()
        ),
    )
    if not user:
        raise exc

    return user


def require_role(*roles: str) -> Callable[..., User]:
    """
    Returns a FastAPI dependency that enforces role-based access.
    Example:
        current_user: User = Depends(require_role("coordinator", "agency_admin"))
    """
    def _check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not authorised for this action.",
            )
        return current_user

    return _check


class AgencyScope:
    """
    Encapsulates agency-level row isolation for coordinator endpoints.

    Usage in endpoints:
        scope: AgencyScope = Depends(get_agency_scope)

        # Build a WHERE fragment — use a table alias when the query joins tables
        conditions = [scope.sql_filter("v")]       # → "v.agency_id = :_agy_id"
        params     = scope.bind({"skip": skip})    # → {"skip": skip, "_agy_id": 1}

        # Verify the current user may touch a specific record
        scope.assert_access(visit_agency_id)       # raises HTTP 403 if denied
    """

    def __init__(self, user: User, db: Optional[Session] = None) -> None:
        self._user = user
        # super_admin has no agency restriction; everyone else is scoped to their agency
        self.agency_id: Optional[int] = None if user.role == "super_admin" else user.agency_id
        # Resolve agency tier so endpoints can gate aggregator calls
        self.agency_tier: Optional[str] = None
        if self.agency_id is not None and db is not None:
            try:
                row = db.execute(
                    text("SELECT tier FROM care.agencies WHERE id = :id"),
                    {"id": self.agency_id},
                ).fetchone()
                if row:
                    self.agency_tier = row.tier
            except Exception:
                pass

    @property
    def username(self) -> str:
        return self._user.username

    @property
    def user_id(self) -> int:
        return self._user.id

    @property
    def is_global(self) -> bool:
        """True for super_admin — queries must not filter by agency."""
        return self.agency_id is None

    def sql_filter(self, alias: str = "") -> str:
        """
        Return a SQL WHERE fragment for agency isolation.
        alias: optional table alias, e.g. 'v' → "v.agency_id = :_agy_id"
        Returns "1=1" for super_admin (no filter).
        """
        if self.is_global:
            return "1=1"
        col = f"{alias}.agency_id" if alias else "agency_id"
        return f"{col} = :_agy_id"

    def bind(self, params: dict) -> dict:
        """Add the :_agy_id binding to a params dict when scope is not global."""
        if not self.is_global:
            params["_agy_id"] = self.agency_id
        return params

    def assert_access(self, record_agency_id: Optional[int]) -> None:
        """Raise HTTP 403 if the current user cannot access a record from another agency."""
        if not self.is_global and record_agency_id != self.agency_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def get_agency_scope(
    current_user: User = Depends(
        require_role("coordinator", "agency_admin", "super_admin")
    ),
    db: Session = Depends(get_db),
) -> AgencyScope:
    """
    FastAPI dependency that returns an AgencyScope for the current user.
    Automatically gates coordinator-only routes and centralises all
    agency-isolation logic so individual endpoints stay policy-free.
    """
    return AgencyScope(current_user, db)
