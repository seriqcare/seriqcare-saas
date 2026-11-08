"""
Mobile EVV visit endpoints (Flutter caregiver app).

POST /api/visits/clock-in            — start a visit
PUT  /api/visits/{visit_id}/clock-out — end a visit, compute billed_units
GET  /api/visits/history             — caregiver's past visits

Clock-in creates a row in care.visits (identity only) plus child rows in
care.visit_evv, care.visit_billing, and care.visit_integration_status.
Clock-out writes EVV completion data to care.visit_evv and billed_units
to care.visit_billing, then triggers EVV validation + aggregator routing.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from backend.services.timezone import EASTERN, SQLSERVER_EASTERN_NOW_EXPR, UTC
from backend.services.evv_validation import validate_and_gate
from db.audit import write_audit
from db.database import get_db
from db.models import User

log = logging.getLogger("seriqcare.mobile_visits")
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ClockInRequest(BaseModel):
    schedule_id: int
    latitude:    float
    longitude:   float
    timestamp:   str          # ISO-8601 UTC from the mobile device


class ClockInResponse(BaseModel):
    success:  bool
    visit_id: int
    message:  str = ""


class ClockOutRequest(BaseModel):
    latitude:  float
    longitude: float
    timestamp: str            # ISO-8601 UTC from the mobile device


class ClockOutResponse(BaseModel):
    success:      bool
    billed_units: int = 0
    message:      str = ""


class VisitHistoryItem(BaseModel):
    visit_id:        int
    client_name:     str
    service_date:    str
    start_time:      Optional[str] = None
    end_time:        Optional[str] = None
    billed_units:    Optional[float] = None
    evv_status:      str
    approval_status: str
    service_code:    str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utc_to_local(dt: datetime) -> datetime:
    if getattr(dt, "tzinfo", None) is not None:
        return dt.astimezone(EASTERN).replace(tzinfo=None)
    return dt


def _fmt12(dt: datetime) -> str:
    s = dt.strftime("%I:%M %p")
    return s.lstrip("0") or s


def _parse_iso(ts: str) -> datetime:
    """Parse an ISO-8601 timestamp and return as naive Eastern time."""
    ts = ts.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(EASTERN).replace(tzinfo=None)
    except ValueError:
        return datetime.now(EASTERN).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/clock-in", response_model=ClockInResponse)
def clock_in(
    req:          ClockInRequest,
    request:      Request,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Record a clock-in event.

    Creates:
      - care.visits row (identity only — 13 columns)
      - care.visit_evv row (clock-in GPS + evv_status='Pending')
      - care.visit_billing row (approval_status='Pending')
      - care.visit_integration_status row (sandata_status='Draft', hhax_status='Draft')

    Idempotent: returns the existing visit_id if already clocked in for this schedule.
    """
    if current_user.employee_id is None or current_user.agency_id is None:
        raise HTTPException(status_code=403, detail="User is not linked to an employee and agency")

    schedule = db.execute(
        text("""
            SELECT
                s.id,
                s.client_id,
                s.service_code_id,
                s.agency_id,
                (
                    SELECT TOP 1 sa.id
                    FROM   care.service_authorizations sa
                    WHERE  sa.client_id       = s.client_id
                      AND  sa.agency_id       = s.agency_id
                      AND  sa.service_code_id = s.service_code_id
                      AND  sa.is_active       = 1
                    ORDER  BY sa.service_end_date DESC
                ) AS auth_id
            FROM care.schedules s
            JOIN care.clients c ON c.id = s.client_id AND c.agency_id = s.agency_id
            JOIN care.employees e ON e.id = s.employee_id AND e.agency_id = s.agency_id
            WHERE s.id = :sid
              AND s.employee_id = :employee_id AND s.agency_id = :agency_id
              AND s.status <> 'Cancelled'
        """),
        {"sid": req.schedule_id, "employee_id": current_user.employee_id, "agency_id": current_user.agency_id},
    ).fetchone()

    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Idempotency — return existing open visit for this schedule
    existing = db.execute(
        text("""
            SELECT v.id
            FROM   care.visits    v
            JOIN   care.visit_evv ev ON ev.visit_id = v.id
            WHERE  v.schedule_id         = :sid
              AND  v.employee_id         = :employee_id
              AND  v.agency_id           = :agency_id
              AND  ev.call_out_datetime  IS NULL
              AND  v.visit_cancelled     = 0
        """),
        {"sid": req.schedule_id, "employee_id": current_user.employee_id, "agency_id": current_user.agency_id},
    ).fetchone()

    if existing:
        return ClockInResponse(
            success  = True,
            visit_id = existing.id,
            message  = "Already clocked in — returning existing visit",
        )

    clock_dt     = _parse_iso(req.timestamp)
    service_date = clock_dt.date()

    # 1. Insert identity-only visit row
    result = db.execute(
        text(f"""
            INSERT INTO care.visits (
                client_id, employee_id, service_code_id, service_authorization_id,
                service_date, place_of_service, visit_cancelled,
                schedule_id, agency_id, created_at, updated_at
            )
            OUTPUT INSERTED.id
            VALUES (
                :client_id, :emp_id, :svc_id, :auth_id,
                :sdate, '12', 0,
                :sid, :agy_id, {SQLSERVER_EASTERN_NOW_EXPR}, {SQLSERVER_EASTERN_NOW_EXPR}
            )
        """),
        {
            "client_id": schedule.client_id,
            "emp_id":    current_user.employee_id,
            "svc_id":    schedule.service_code_id,
            "auth_id":   schedule.auth_id,
            "sdate":     service_date,
            "sid":       req.schedule_id,
            "agy_id":    schedule.agency_id,
        },
    )
    visit_id = result.fetchone()[0]

    # 2. Insert EVV row (clock-in data, evv_status starts as Pending)
    db.execute(
        text(f"""
            INSERT INTO care.visit_evv (
                visit_id, call_in_datetime, call_in_latitude, call_in_longitude,
                call_in_method, evv_status, hard_copy_required, created_at, updated_at
            )
            VALUES (
                :vid, :cin_dt, :lat, :lon,
                'Mobile', 'Pending', 0, {SQLSERVER_EASTERN_NOW_EXPR}, {SQLSERVER_EASTERN_NOW_EXPR}
            )
        """),
        {
            "vid":    visit_id,
            "cin_dt": clock_dt,
            "lat":    req.latitude,
            "lon":    req.longitude,
        },
    )

    # 3. Insert billing row
    db.execute(
        text(f"""
            INSERT INTO care.visit_billing (
                visit_id, approval_status, created_at, updated_at
            )
            VALUES (:vid, 'Pending', {SQLSERVER_EASTERN_NOW_EXPR}, {SQLSERVER_EASTERN_NOW_EXPR})
        """),
        {"vid": visit_id},
    )

    # 4. Insert integration status row (Draft for both aggregators until EVV validates)
    db.execute(
        text(f"""
            INSERT INTO care.visit_integration_status (
                visit_id, sandata_status, hhax_status, created_at, updated_at
            )
            VALUES (:vid, 'Draft', 'Draft', {SQLSERVER_EASTERN_NOW_EXPR}, {SQLSERVER_EASTERN_NOW_EXPR})
        """),
        {"vid": visit_id},
    )

    db.commit()

    write_audit(
        db,
        table_name="visits",
        action="CLOCK_IN",
        agency_id=schedule.agency_id,
        record_id=visit_id,
        changed_by=current_user.id,
        changed_by_name=current_user.display_name or current_user.username,
        client_type="mobile",
        ip_address=request.client.host if request.client else None,
        detail=f"schedule_id={req.schedule_id}",
        commit=True,
    )

    log.info(f"Clock-in: visit_id={visit_id} user={current_user.username} schedule={req.schedule_id}")
    return ClockInResponse(success=True, visit_id=visit_id, message="Clock-in recorded")


@router.put("/{visit_id}/clock-out", response_model=ClockOutResponse)
def clock_out(
    visit_id:     int,
    req:          ClockOutRequest,
    request:      Request,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Record a clock-out event and compute billed_units.

    Units are truncated to full 15-minute blocks (no rounding) per ODP EVV
    Technical Guidance v2.0.

    Writes clock-out GPS + timestamps to care.visit_evv and billed_units to
    care.visit_billing, then calls validate_and_gate() which sets evv_status
    ('Verified') and advances the appropriate aggregator column to 'Ready'.
    """
    if current_user.employee_id is None or current_user.agency_id is None:
        raise HTTPException(status_code=403, detail="User is not linked to an employee and agency")
    visit = db.execute(
        text("""
            SELECT v.id, ev.call_in_datetime
            FROM   care.visits    v
            JOIN   care.visit_evv ev ON ev.visit_id = v.id
            JOIN   care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
            JOIN   care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
            WHERE  v.id                  = :vid
              AND  v.employee_id         = :employee_id
              AND  v.agency_id           = :agency_id
              AND  ev.call_out_datetime  IS NULL
              AND  v.visit_cancelled     = 0
        """),
        {"vid": visit_id, "employee_id": current_user.employee_id, "agency_id": current_user.agency_id},
    ).fetchone()

    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found or already clocked out")

    clock_dt     = _parse_iso(req.timestamp)
    billed_units = 0

    if visit.call_in_datetime:
        in_dt = visit.call_in_datetime
        if hasattr(in_dt, "tzinfo") and in_dt.tzinfo is not None:
            in_dt = in_dt.replace(tzinfo=None)
        duration_minutes = (clock_dt - in_dt).total_seconds() / 60
        billed_units = max(0, int(duration_minutes / 15))

    # Update EVV table with clock-out GPS + timestamp
    db.execute(
        text(f"""
            UPDATE care.visit_evv
            SET    call_out_datetime  = :cout_dt,
                   call_out_latitude  = :lat,
                   call_out_longitude = :lon,
                   call_out_method    = 'Mobile',
                   updated_at         = {SQLSERVER_EASTERN_NOW_EXPR}
            WHERE  visit_id = :vid
        """),
        {
            "cout_dt": clock_dt,
            "lat":     req.latitude,
            "lon":     req.longitude,
            "vid":     visit_id,
        },
    )

    # Update billing table with computed units
    db.execute(
        text(f"""
            UPDATE care.visit_billing
            SET    billed_units = :units,
                   updated_at   = {SQLSERVER_EASTERN_NOW_EXPR}
            WHERE  visit_id = :vid
        """),
        {"units": billed_units, "vid": visit_id},
    )

    # Touch visits.updated_at
    db.execute(
        text(f"UPDATE care.visits SET updated_at = {SQLSERVER_EASTERN_NOW_EXPR} WHERE id = :vid"),
        {"vid": visit_id},
    )

    # Mark the linked schedule as Completed
    db.execute(
        text("""
            UPDATE care.schedules
            SET    status = 'Completed'
            WHERE  id = (SELECT schedule_id FROM care.visits WHERE id = :vid)
              AND  status NOT IN ('Cancelled', 'Completed')
        """),
        {"vid": visit_id},
    )

    db.commit()

    write_audit(
        db,
        table_name="visits",
        action="CLOCK_OUT",
        agency_id=current_user.agency_id,
        record_id=visit_id,
        changed_by=current_user.id,
        changed_by_name=current_user.display_name or current_user.username,
        client_type="mobile",
        ip_address=request.client.host if request.client else None,
        detail=f"billed_units={billed_units}",
        commit=True,
    )

    # Validate EVV and apply state gate — sets evv_status + integration_status.
    # Non-fatal: a validation failure doesn't roll back the clock-out.
    try:
        validate_and_gate(visit_id, db)
        db.commit()
    except Exception as exc:
        log.warning(f"EVV validation failed after clock-out visit_id={visit_id}: {exc}")

    log.info(f"Clock-out: visit_id={visit_id} user={current_user.username} units={billed_units}")
    return ClockOutResponse(
        success      = True,
        billed_units = billed_units,
        message      = f"Clock-out recorded. Billed units: {billed_units}",
    )


@router.get("/history", response_model=List[VisitHistoryItem])
def get_visit_history(
    days:         int     = Query(default=30, ge=1, le=365, description="How many days back to look"),
    skip:         int     = Query(default=0,  ge=0),
    limit:        int     = Query(default=20, ge=1, le=100),
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Return past visits for the authenticated caregiver, newest first."""
    if current_user.employee_id is None or current_user.agency_id is None:
        raise HTTPException(status_code=403, detail="User is not linked to an employee and agency")

    since = date.today() - timedelta(days=days)

    rows = db.execute(
        text("""
            SELECT
                v.id,
                c.first_name + ' ' + c.last_name AS client_name,
                v.service_date,
                ev.call_in_datetime,
                ev.call_out_datetime,
                vb.billed_units,
                ev.evv_status,
                vb.approval_status,
                sc.hcpcs_code
            FROM  care.visits         v
            JOIN  care.clients        c  ON c.id  = v.client_id AND c.agency_id = v.agency_id
            JOIN  care.service_codes  sc ON sc.id = v.service_code_id
            LEFT JOIN care.visit_evv     ev ON ev.visit_id = v.id
            LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
            WHERE v.employee_id    = :emp_id
              AND v.agency_id      = :agency_id
              AND v.service_date  >= :since
              AND v.visit_cancelled = 0
            ORDER BY v.service_date DESC, v.id DESC
            OFFSET :skip ROWS FETCH NEXT :limit ROWS ONLY
        """),
        {
            "emp_id": current_user.employee_id,
            "agency_id": current_user.agency_id,
            "since":  since,
            "skip":   skip,
            "limit":  limit,
        },
    ).fetchall()

    result: List[VisitHistoryItem] = []
    for r in rows:
        result.append(
            VisitHistoryItem(
                visit_id        = r.id,
                client_name     = r.client_name,
                service_date    = str(r.service_date),
                start_time      = _fmt12(_utc_to_local(r.call_in_datetime))  if r.call_in_datetime  else None,
                end_time        = _fmt12(_utc_to_local(r.call_out_datetime)) if r.call_out_datetime else None,
                billed_units    = float(r.billed_units) if r.billed_units is not None else None,
                evv_status      = r.evv_status or "Pending",
                approval_status = r.approval_status or "Pending",
                service_code    = r.hcpcs_code,
            )
        )
    return result
