"""
Super Admin API — super_admin role only.

GET  /api/super-admin/overview
GET  /api/super-admin/agencies
POST /api/super-admin/agencies
PATCH /api/super-admin/agencies/{agency_id}
GET  /api/super-admin/users
GET  /api/super-admin/audit-log
GET  /api/super-admin/api-access-log
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import require_role
from backend.services.auth_tokens import hash_token
from backend.services.timezone import SQLSERVER_LOCAL_DATE_EXPR
from db.database import get_db
from db.models import User, PasswordResetToken

log = logging.getLogger("seriqcare.super_admin")
router = APIRouter()


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@router.get("/overview")
def get_overview(
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    row = db.execute(text(f"""
        SELECT
            (SELECT COUNT(*) FROM care.agencies)                                              AS total_agencies,
            (SELECT COUNT(*) FROM care.agencies WHERE is_active = 1)                         AS active_agencies,
            (SELECT COUNT(*) FROM care.users WHERE role != 'super_admin' AND is_active = 1)  AS total_users,
            (SELECT COUNT(*) FROM care.visits  WHERE service_date >= {SQLSERVER_LOCAL_DATE_EXPR}) AS visits_today
    """)).fetchone()

    logins_today = 0
    failed_logins_today = 0
    clock_ins_today = 0
    recent_events: list[dict] = []

    try:
        audit_row = db.execute(text(f"""
            SELECT
                SUM(CASE WHEN action = 'LOGIN'        THEN 1 ELSE 0 END) AS logins,
                SUM(CASE WHEN action = 'FAILED_LOGIN' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN action = 'CLOCK_IN'     THEN 1 ELSE 0 END) AS clock_ins
            FROM audit.audit_log
            WHERE created_at >= {SQLSERVER_LOCAL_DATE_EXPR}
        """)).fetchone()
        if audit_row:
            logins_today       = audit_row.logins    or 0
            failed_logins_today = audit_row.failed   or 0
            clock_ins_today    = audit_row.clock_ins or 0

        rows = db.execute(text("""
            SELECT TOP 20
                id, created_at, action, table_name, record_id,
                changed_by_name, agency_id, client_type, ip_address, detail
            FROM audit.audit_log
            ORDER BY created_at DESC
        """)).fetchall()
        recent_events = [dict(r._mapping) for r in rows]
    except Exception:
        pass

    return {
        "total_agencies":      row.total_agencies,
        "active_agencies":     row.active_agencies,
        "total_users":         row.total_users,
        "visits_today":        row.visits_today,
        "logins_today":        logins_today,
        "failed_logins_today": failed_logins_today,
        "clock_ins_today":     clock_ins_today,
        "recent_events":       recent_events,
    }


# ---------------------------------------------------------------------------
# Agencies
# ---------------------------------------------------------------------------

@router.get("/agencies")
def list_agencies(
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    rows = db.execute(text("""
        SELECT
            a.id, a.agency_code, a.name, a.tier, a.aggregator,
            a.state_provider_id, a.sandata_provider_id,
            a.address1, a.city, a.state, a.zip, a.phone,
            a.primary_contact_name, a.primary_contact_email,
            a.is_active, a.created_at,
            (SELECT COUNT(*)
             FROM   care.users u
             WHERE  u.agency_id = a.id
               AND  u.is_active = 1
               AND  u.role      != 'super_admin') AS user_count
        FROM  care.agencies a
        ORDER BY a.is_active DESC, a.name
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


class AgencyCreate(BaseModel):
    agency_code:           str
    name:                  str
    tier:                  str = "core"
    aggregator:            Optional[str] = None   # 'sandata' | 'hhax' | None (core)
    state:                 str = "PA"
    state_provider_id:     Optional[str] = None
    sandata_provider_id:   Optional[str] = None
    address1:              Optional[str] = None
    city:                  Optional[str] = None
    zip:                   Optional[str] = None
    phone:                 Optional[str] = None
    primary_contact_name:  str
    primary_contact_email: str
    admin_username:        str


@router.post("/agencies", status_code=201)
def create_agency(
    body: AgencyCreate,
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    code = body.agency_code.strip().upper()
    email = body.primary_contact_email.strip().lower()
    username = body.admin_username.strip()

    if not email:
        raise HTTPException(status_code=422, detail="Contact email is required.")
    if not username:
        raise HTTPException(status_code=422, detail="Admin username is required.")

    # Check agency code uniqueness
    existing = db.execute(
        text("SELECT id FROM care.agencies WHERE agency_code = :code"),
        {"code": code},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"Agency code '{code}' already exists.")

    # Check username uniqueness
    existing_user = db.execute(
        text("SELECT id FROM care.users WHERE username = :u"),
        {"u": username},
    ).fetchone()
    if existing_user:
        raise HTTPException(status_code=409, detail=f"Username '{username}' is already taken.")

    # 1. Create agency
    result = db.execute(text("""
        INSERT INTO care.agencies
            (agency_code, name, tier, aggregator, state_provider_id, sandata_provider_id,
             address1, city, state, zip, phone,
             primary_contact_name, primary_contact_email, is_active)
        OUTPUT INSERTED.id
        VALUES
            (:code, :name, :tier, :aggregator, :spid, :sand_pid,
             :addr, :city, :state, :zip, :phone,
             :cname, :cemail, 1)
    """), {
        "code":       code,
        "name":       body.name.strip(),
        "tier":       body.tier,
        "aggregator": body.aggregator,
        "spid":       body.state_provider_id,
        "sand_pid":   body.sandata_provider_id,
        "addr":       body.address1,
        "city":       body.city,
        "state":      body.state or "PA",
        "zip":        body.zip,
        "phone":      body.phone,
        "cname":      body.primary_contact_name.strip(),
        "cemail":     email,
    })
    agency_id = result.fetchone()[0]

    # 2. Create agency_admin user (no password — they'll set it via onboarding email)
    user_result = db.execute(text("""
        INSERT INTO care.users
            (agency_id, username, display_name, email, role, is_active, password_hash)
        OUTPUT INSERTED.id
        VALUES
            (:agency_id, :username, :display_name, :email, 'agency_admin', 1, NULL)
    """), {
        "agency_id":    agency_id,
        "username":     username,
        "display_name": body.primary_contact_name.strip(),
        "email":        email,
    })
    user_id = user_result.fetchone()[0]

    # 3. Create password-reset token (24-hour expiry for onboarding)
    raw_token = str(uuid.uuid4()).replace("-", "") + str(uuid.uuid4()).replace("-", "")
    token_hash_val = hash_token(raw_token)
    now = datetime.utcnow()

    db.add(PasswordResetToken(
        user_id=user_id,
        token_hash=token_hash_val,
        expires_at=now + timedelta(hours=24),
        created_at=now,
    ))
    db.commit()

    # 4. Send onboarding email
    email_sent = False
    try:
        from backend.routers.auth import _send_onboarding_email
        _send_onboarding_email(
            to_email=email,
            reset_token=raw_token,
            contact_name=body.primary_contact_name.strip(),
            agency_name=body.name.strip(),
        )
        email_sent = True
    except Exception as exc:
        log.error("Failed to send onboarding email to %s: %s", email, exc)

    log.info(
        "super_admin created agency id=%s code=%s with admin user id=%s (%s)",
        agency_id, code, user_id, username,
    )
    return {
        "id": agency_id,
        "admin_user": {
            "user_id": user_id,
            "username": username,
            "email": email,
        },
        "email_sent": email_sent,
    }


class AgencyUpdate(BaseModel):
    name:                  Optional[str]  = None
    tier:                  Optional[str]  = None
    aggregator:            Optional[str]  = None
    is_active:             Optional[bool] = None
    state_provider_id:     Optional[str]  = None
    sandata_provider_id:   Optional[str]  = None
    phone:                 Optional[str]  = None
    primary_contact_name:  Optional[str]  = None
    primary_contact_email: Optional[str]  = None


@router.patch("/agencies/{agency_id}")
def update_agency(
    agency_id: int,
    body: AgencyUpdate,
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    exists = db.execute(
        text("SELECT id FROM care.agencies WHERE id = :id"), {"id": agency_id}
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Agency not found.")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update.")

    # Only allow known columns (safe against injection since keys come from Pydantic)
    allowed = {"name", "tier", "aggregator", "is_active", "state_provider_id",
               "sandata_provider_id", "phone", "primary_contact_name", "primary_contact_email"}
    updates = {k: v for k, v in updates.items() if k in allowed}

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["_id"] = agency_id
    db.execute(
        text(f"UPDATE care.agencies SET {set_clauses} WHERE id = :_id"), updates
    )
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@router.get("/users")
def list_users(
    agency_id: Optional[int] = Query(None),
    role:      Optional[str] = Query(None),
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    where_parts = ["u.role != 'super_admin'"]
    params: dict = {}

    if agency_id is not None:
        where_parts.append("u.agency_id = :agency_id")
        params["agency_id"] = agency_id
    if role:
        where_parts.append("u.role = :role")
        params["role"] = role

    where = " AND ".join(where_parts)
    rows = db.execute(text(f"""
        SELECT
            u.id, u.username, u.display_name, u.email, u.role,
            u.agency_id, a.name AS agency_name,
            u.is_active, u.last_login_at, u.created_at
        FROM  care.users u
        LEFT  JOIN care.agencies a ON a.id = u.agency_id
        WHERE {where}
        ORDER BY
            CASE WHEN u.last_login_at IS NULL THEN 1 ELSE 0 END,
            u.last_login_at DESC
    """), params).fetchall()
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@router.get("/audit-log")
def get_audit_log(
    action:    Optional[str] = Query(None),
    agency_id: Optional[int] = Query(None),
    limit:     int           = Query(default=100, ge=1, le=500),
    offset:    int           = Query(default=0,   ge=0),
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    try:
        where_parts = ["1=1"]
        params: dict = {"limit": limit, "offset": offset}

        if action:
            where_parts.append("action = :action")
            params["action"] = action
        if agency_id is not None:
            where_parts.append("agency_id = :agency_id")
            params["agency_id"] = agency_id

        where = " AND ".join(where_parts)
        rows = db.execute(text(f"""
            SELECT
                id, created_at, action, table_name, record_id,
                changed_by, changed_by_name, agency_id,
                client_type, ip_address, field_name,
                old_value, new_value, detail
            FROM  audit.audit_log
            WHERE {where}
            ORDER BY created_at DESC
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        """), params).fetchall()

        total_row = db.execute(
            text(f"SELECT COUNT(*) FROM audit.audit_log WHERE {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        ).fetchone()

        return {"total": total_row[0], "rows": [dict(r._mapping) for r in rows]}
    except Exception as exc:
        log.warning("audit-log query failed: %s", exc)
        return {"total": 0, "rows": []}


# ---------------------------------------------------------------------------
# API access log
# ---------------------------------------------------------------------------

@router.get("/api-access-log")
def get_api_access_log(
    status_code: Optional[int] = Query(None),
    user_id:     Optional[int] = Query(None),
    limit:       int           = Query(default=100, ge=1, le=500),
    offset:      int           = Query(default=0,   ge=0),
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    try:
        where_parts = ["1=1"]
        params: dict = {"limit": limit, "offset": offset}

        if status_code is not None:
            where_parts.append("status_code = :status_code")
            params["status_code"] = status_code
        if user_id is not None:
            where_parts.append("user_id = :user_id")
            params["user_id"] = user_id

        where = " AND ".join(where_parts)
        rows = db.execute(text(f"""
            SELECT
                id, created_at, method, path, query_string,
                status_code, duration_ms,
                user_id, username, agency_id, ip_address, user_agent
            FROM  audit.api_access_log
            WHERE {where}
            ORDER BY created_at DESC
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        """), params).fetchall()

        total_row = db.execute(
            text(f"SELECT COUNT(*) FROM audit.api_access_log WHERE {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        ).fetchone()

        return {"total": total_row[0], "rows": [dict(r._mapping) for r in rows]}
    except Exception as exc:
        log.warning("api-access-log query failed: %s", exc)
        return {"total": 0, "rows": []}
