"""
Mobile coordinator endpoints (Flutter app — coordinator / agency_admin role).

GET /api/coordinator/visits                              — list visits with filters
PUT /api/coordinator/visits/{visit_id}/approve          — approve a visit
PUT /api/coordinator/visits/{visit_id}/reject           — reject a visit
GET /api/coordinator/exceptions                         — list EVV exceptions
PUT /api/coordinator/exceptions/{exception_id}/acknowledge — acknowledge an exception
GET /api/coordinator/dashboard                          — agency-level dashboard stats

All routes are scoped to the authenticated user's agency via AgencyScope.
super_admin sees platform-wide data.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import AgencyScope, get_agency_scope
from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR
from db.database import get_db

log = logging.getLogger("seriqcare.mobile_coordinator")
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CoordinatorVisitItem(BaseModel):
    visit_id:        int
    client_name:     str
    employee_name:   str
    service_date:    str
    start_time:      Optional[str] = None
    end_time:        Optional[str] = None
    billed_units:    Optional[float] = None
    approved_units:  Optional[float] = None
    evv_status:      str
    approval_status: str
    service_code:    str
    has_exceptions:  bool


class ApproveVisitRequest(BaseModel):
    approved_units: Optional[float] = None
    notes:          Optional[str]   = None


class RejectVisitRequest(BaseModel):
    reason_code: Optional[str] = None
    notes:       Optional[str] = None


class ExceptionItem(BaseModel):
    exception_id:   int
    visit_id:       int
    client_name:    str
    employee_name:  str
    service_date:   str
    exception_type: str
    description:    Optional[str] = None
    esc_code:       Optional[str] = None
    created_at:     str


class AcknowledgeExceptionRequest(BaseModel):
    reason_code: Optional[str] = None
    notes:       Optional[str] = None


class DashboardStats(BaseModel):
    visits_today:            int
    visits_pending_approval: int
    visits_incomplete:       int
    open_exceptions:         int
    active_caregivers:       int
    active_clients:          int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utc_to_local(dt: datetime) -> datetime:
    if getattr(dt, "tzinfo", None) is not None:
        return dt.astimezone().replace(tzinfo=None)
    return dt


def _fmt12(dt: datetime) -> str:
    s = dt.strftime("%I:%M %p")
    return s.lstrip("0") or s


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/visits", response_model=List[CoordinatorVisitItem])
def coordinator_list_visits(
    approval_status: Optional[str]  = Query(default=None, description="Pending | Approved | Rejected"),
    evv_status:      Optional[str]  = Query(default=None, description="Ready | Submitted | Incomplete | Omit"),
    date_from:       Optional[date] = Query(default=None),
    date_to:         Optional[date] = Query(default=None),
    skip:            int            = Query(default=0,  ge=0),
    limit:           int            = Query(default=50, ge=1, le=200),
    scope:           AgencyScope    = Depends(get_agency_scope),
    db:              Session        = Depends(get_db),
):
    """
    List visits for the coordinator's agency with optional filters.
    super_admin sees all agencies; coordinator/agency_admin sees their own agency.
    """
    conditions = ["v.visit_cancelled = 0", scope.sql_filter("v")]
    params: dict = scope.bind({"skip": skip, "limit": limit})

    if approval_status:
        conditions.append("v.approval_status = :approval_status")
        params["approval_status"] = approval_status
    if evv_status:
        conditions.append("v.evv_status = :evv_status")
        params["evv_status"] = evv_status
    if date_from:
        conditions.append("v.service_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        conditions.append("v.service_date <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(conditions)

    rows = db.execute(
        text(f"""
            SELECT
                v.id,
                c.first_name  + ' ' + c.last_name  AS client_name,
                e.first_name  + ' ' + e.last_name  AS employee_name,
                v.service_date,
                v.call_in_datetime,
                v.call_out_datetime,
                v.billed_units,
                v.approved_units,
                v.evv_status,
                v.approval_status,
                sc.hcpcs_code,
                (
                    SELECT COUNT(*)
                    FROM   care.visit_exceptions ve
                    WHERE  ve.visit_id     = v.id
                      AND  ve.acknowledged = 0
                ) AS open_exceptions
            FROM  care.visits        v
            JOIN  care.clients       c  ON c.id  = v.client_id
            JOIN  care.employees     e  ON e.id  = v.employee_id
            JOIN  care.service_codes sc ON sc.id = v.service_code_id
            WHERE {where}
            ORDER BY v.service_date DESC, v.id DESC
            OFFSET :skip ROWS FETCH NEXT :limit ROWS ONLY
        """),
        params,
    ).fetchall()

    result: List[CoordinatorVisitItem] = []
    for r in rows:
        result.append(
            CoordinatorVisitItem(
                visit_id        = r.id,
                client_name     = r.client_name,
                employee_name   = r.employee_name,
                service_date    = str(r.service_date),
                start_time      = _fmt12(_utc_to_local(r.call_in_datetime))  if r.call_in_datetime  else None,
                end_time        = _fmt12(_utc_to_local(r.call_out_datetime)) if r.call_out_datetime else None,
                billed_units    = float(r.billed_units)   if r.billed_units   is not None else None,
                approved_units  = float(r.approved_units) if r.approved_units is not None else None,
                evv_status      = r.evv_status,
                approval_status = r.approval_status,
                service_code    = r.hcpcs_code,
                has_exceptions  = r.open_exceptions > 0,
            )
        )
    return result


@router.put("/visits/{visit_id}/approve")
def approve_visit(
    visit_id: int,
    req:      ApproveVisitRequest,
    scope:    AgencyScope = Depends(get_agency_scope),
    db:       Session     = Depends(get_db),
):
    """
    Approve a visit.  approved_units defaults to billed_units if not provided.
    Records the action in care.visit_changes and fires an approval notification.
    """
    visit = db.execute(
        text("""
            SELECT id, billed_units, approval_status, agency_id
            FROM   care.visits
            WHERE  id = :vid
        """),
        {"vid": visit_id},
    ).fetchone()

    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")

    scope.assert_access(visit.agency_id)

    if visit.approval_status == "Approved":
        return {"success": True, "message": "Visit already approved"}

    approved_units = req.approved_units if req.approved_units is not None else visit.billed_units

    db.execute(
        text(f"""
            UPDATE care.visits
            SET    approval_status = 'Approved',
                   approved_units  = :units,
                   evv_status      = CASE
                                         WHEN evv_status = 'Ready' THEN 'Submitted'
                                         ELSE evv_status
                                     END,
                   updated_at      = {SQLSERVER_EASTERN_NOW_EXPR}
            WHERE  id = :vid
        """),
        {"units": approved_units, "vid": visit_id},
    )

    # Audit trail
    db.execute(
        text("""
            INSERT INTO care.visit_changes
                (visit_id, changed_by, change_type, old_value, new_value, notes)
            VALUES (:vid, :who, 'StatusChange', :old, 'Approved', :notes)
        """),
        {
            "vid":   visit_id,
            "who":   scope.username,
            "old":   visit.approval_status,
            "notes": req.notes or "",
        },
    )

    # Notification for coordinator role
    db.execute(
        text("""
            INSERT INTO care.notifications
                (agency_id, role_target, notif_type, title, body, ref_type, ref_id)
            VALUES
                (:agy, 'coordinator', 'visit_approval',
                 'Visit Approved', :body, 'visit', :vid)
        """),
        {
            "agy":  visit.agency_id,
            "body": f"Visit #{visit_id} approved by {scope.username}. Units: {approved_units}",
            "vid":  visit_id,
        },
    )

    db.commit()
    log.info(f"Visit approved: visit_id={visit_id} by {scope.username}")
    return {"success": True, "message": f"Visit #{visit_id} approved. Units: {approved_units}"}


@router.put("/visits/{visit_id}/reject")
def reject_visit(
    visit_id: int,
    req:      RejectVisitRequest,
    scope:    AgencyScope = Depends(get_agency_scope),
    db:       Session     = Depends(get_db),
):
    """Reject a visit with an optional reason code and notes."""
    visit = db.execute(
        text("""
            SELECT id, approval_status, agency_id
            FROM   care.visits WHERE id = :vid
        """),
        {"vid": visit_id},
    ).fetchone()

    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")

    scope.assert_access(visit.agency_id)

    if visit.approval_status == "Rejected":
        return {"success": True, "message": "Visit already rejected"}

    reason_id = None
    if req.reason_code:
        rc_row = db.execute(
            text("SELECT id FROM care.reason_codes WHERE reason_code = :rc"),
            {"rc": req.reason_code},
        ).fetchone()
        if rc_row:
            reason_id = rc_row.id

    db.execute(
        text(f"""
            UPDATE care.visits
            SET    approval_status = 'Rejected',
                   reason_code_id  = :rc_id,
                   notes           = ISNULL(:notes, notes),
                   updated_at      = {SQLSERVER_EASTERN_NOW_EXPR}
            WHERE  id = :vid
        """),
        {"rc_id": reason_id, "notes": req.notes, "vid": visit_id},
    )

    db.execute(
        text("""
            INSERT INTO care.visit_changes
                (visit_id, changed_by, change_type, old_value, new_value, notes)
            VALUES (:vid, :who, 'StatusChange', :old, 'Rejected', :notes)
        """),
        {
            "vid":   visit_id,
            "who":   scope.username,
            "old":   visit.approval_status,
            "notes": req.notes or "",
        },
    )

    db.commit()
    log.info(f"Visit rejected: visit_id={visit_id} by {scope.username}")
    return {"success": True, "message": f"Visit #{visit_id} rejected"}


@router.get("/exceptions", response_model=List[ExceptionItem])
def coordinator_list_exceptions(
    acknowledged: Optional[bool] = Query(default=False, description="False=open only; True=acked; None=all"),
    skip:         int            = Query(default=0,  ge=0),
    limit:        int            = Query(default=50, ge=1, le=200),
    scope:        AgencyScope    = Depends(get_agency_scope),
    db:           Session        = Depends(get_db),
):
    """List visit exceptions for the coordinator's agency."""
    conditions = [scope.sql_filter("v")]
    params: dict = scope.bind({"skip": skip, "limit": limit})

    if acknowledged is not None:
        conditions.append("ve.acknowledged = :acked")
        params["acked"] = 1 if acknowledged else 0

    where = " AND ".join(conditions)

    rows = db.execute(
        text(f"""
            SELECT
                ve.id                              AS exception_id,
                ve.visit_id,
                c.first_name  + ' ' + c.last_name  AS client_name,
                e.first_name  + ' ' + e.last_name  AS employee_name,
                v.service_date,
                ve.exception_type,
                ve.description,
                eec.esc_code,
                ve.created_at
            FROM  care.visit_exceptions ve
            JOIN  care.visits           v   ON v.id   = ve.visit_id
            JOIN  care.clients          c   ON c.id   = v.client_id
            JOIN  care.employees        e   ON e.id   = v.employee_id
            LEFT JOIN care.evv_error_codes eec ON eec.id = ve.esc_code_id
            WHERE {where}
            ORDER BY ve.created_at DESC
            OFFSET :skip ROWS FETCH NEXT :limit ROWS ONLY
        """),
        params,
    ).fetchall()

    return [
        ExceptionItem(
            exception_id   = r.exception_id,
            visit_id       = r.visit_id,
            client_name    = r.client_name,
            employee_name  = r.employee_name,
            service_date   = str(r.service_date),
            exception_type = r.exception_type or "",
            description    = r.description,
            esc_code       = r.esc_code,
            created_at     = r.created_at.strftime("%Y-%m-%d %H:%M UTC"),
        )
        for r in rows
    ]


@router.put("/exceptions/{exception_id}/acknowledge")
def acknowledge_exception(
    exception_id: int,
    req:          AcknowledgeExceptionRequest,
    scope:        AgencyScope = Depends(get_agency_scope),
    db:           Session     = Depends(get_db),
):
    """Acknowledge a visit exception, optionally attaching a reason code and notes."""
    exc_row = db.execute(
        text("""
            SELECT ve.id, ve.acknowledged, v.agency_id
            FROM   care.visit_exceptions ve
            JOIN   care.visits v ON v.id = ve.visit_id
            WHERE  ve.id = :eid
        """),
        {"eid": exception_id},
    ).fetchone()

    if exc_row is None:
        raise HTTPException(status_code=404, detail="Exception not found")

    scope.assert_access(exc_row.agency_id)

    if exc_row.acknowledged:
        return {"success": True, "message": "Exception already acknowledged"}

    reason_id = None
    if req.reason_code:
        rc_row = db.execute(
            text("SELECT id FROM care.reason_codes WHERE reason_code = :rc"),
            {"rc": req.reason_code},
        ).fetchone()
        if rc_row:
            reason_id = rc_row.id

    db.execute(
        text(f"""
            UPDATE care.visit_exceptions
            SET    acknowledged     = 1,
                   acknowledged_by  = :who,
                   acknowledged_at  = {SQLSERVER_EASTERN_NOW_EXPR},
                   reason_code_id   = ISNULL(:rc_id, reason_code_id),
                   notes            = ISNULL(:notes, notes)
            WHERE  id = :eid
        """),
        {
            "who":   scope.username,
            "rc_id": reason_id,
            "notes": req.notes,
            "eid":   exception_id,
        },
    )
    db.commit()

    log.info(f"Exception acknowledged: id={exception_id} by {scope.username}")
    return {"success": True, "message": f"Exception #{exception_id} acknowledged"}


@router.get("/dashboard", response_model=DashboardStats)
def coordinator_dashboard(
    scope: AgencyScope = Depends(get_agency_scope),
    db:    Session     = Depends(get_db),
):
    """
    Return aggregate stats for the coordinator's agency dashboard.
    super_admin sees platform-wide totals.
    """
    today            = date.today()
    agy_filter       = scope.sql_filter()
    agy_filter_visit = scope.sql_filter("v")
    params: dict     = scope.bind({"today": today})

    stats = db.execute(
        text(f"""
            SELECT
                (
                    SELECT COUNT(*) FROM care.visits v
                    WHERE  {agy_filter_visit}
                      AND  v.service_date    = :today
                      AND  v.visit_cancelled = 0
                ) AS visits_today,
                (
                    SELECT COUNT(*) FROM care.visits v
                    WHERE  {agy_filter_visit}
                      AND  v.approval_status = 'Pending'
                      AND  v.evv_status IN ('Ready','Submitted')
                      AND  v.visit_cancelled = 0
                ) AS visits_pending_approval,
                (
                    SELECT COUNT(*) FROM care.visits v
                    WHERE  {agy_filter_visit}
                      AND  v.evv_status      = 'Incomplete'
                      AND  v.visit_cancelled = 0
                ) AS visits_incomplete,
                (
                    SELECT COUNT(*) FROM care.visit_exceptions ve
                    JOIN   care.visits v ON v.id = ve.visit_id
                    WHERE  {agy_filter_visit}
                      AND  ve.acknowledged = 0
                ) AS open_exceptions,
                (
                    SELECT COUNT(*) FROM care.employees
                    WHERE  {agy_filter}
                      AND  is_active = 1
                ) AS active_caregivers,
                (
                    SELECT COUNT(*) FROM care.clients
                    WHERE  {agy_filter}
                      AND  is_active = 1
                      AND  status    = 'Active'
                ) AS active_clients
        """),
        params,
    ).fetchone()

    return DashboardStats(
        visits_today            = stats.visits_today,
        visits_pending_approval = stats.visits_pending_approval,
        visits_incomplete       = stats.visits_incomplete,
        open_exceptions         = stats.open_exceptions,
        active_caregivers       = stats.active_caregivers,
        active_clients          = stats.active_clients,
    )
