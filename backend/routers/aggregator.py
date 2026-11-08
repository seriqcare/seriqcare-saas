"""
Sandata Aggregator Management Router
--------------------------------------
GET  /api/aggregator/queue                   — visits ready for Sandata submission
GET  /api/aggregator/submissions             — paged submission history
POST /api/aggregator/submit/{visit_id}       — submit a single visit
POST /api/aggregator/batch                   — submit all queued visits (max 50)
POST /api/aggregator/submissions/{id}/retry  — retry a rejected/failed submission
GET  /api/aggregator/mode                    — current Sandata mode (simulate|live)

Submission logic delegates to backend.services.sandata:
  - build_visit_payload()  builds the PA-DHS EVV v1.4 JSON
  - post_to_sandata()      POSTs or simulates the Sandata call
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User
from backend.auth.dependencies import AgencyScope, get_agency_scope, get_current_user
from backend.schemas import (
    AggregatorQueueItem,
    AggregatorQueueResponse,
    BatchSubmitResponse,
    SubmissionRecord,
    SubmissionsResponse,
    VisitSubmitResponse,
)
from backend.services import sandata as svc
from backend.services.timezone import now_eastern_naive

router = APIRouter()
_agg_log = logging.getLogger("seriqcare.aggregator")


def get_aggregator_scope(
    scope: AgencyScope = Depends(get_agency_scope),
    current_user: User = Depends(get_current_user),
) -> AgencyScope:
    if current_user.role != "super_admin" and current_user.agency_id is None:
        raise HTTPException(status_code=403, detail="Agency membership required.")
    return scope

# ---------------------------------------------------------------------------
# Shared SQL: fetch full visit row needed by the payload builder
# ---------------------------------------------------------------------------
_VISIT_SQL = """
    SELECT
        v.id,
        v.service_date,
        v.place_of_service,
        ev.call_in_datetime,
        ev.call_out_datetime,
        ev.adj_in_datetime,
        ev.adj_out_datetime,
        ev.call_in_latitude,
        ev.call_in_longitude,
        ev.call_out_latitude,
        ev.call_out_longitude,
        ev.evv_status,
        vb.billed_units,
        vi.sandata_status,
        vi.hhax_status,
        e.employee_code,
        e.first_name + ' ' + e.last_name AS employee_name,
        e.npi                             AS employee_npi,
        c.medicaid_id                     AS client_medicaid_id,
        c.first_name + ' ' + c.last_name  AS client_name,
        sc.hcpcs_code,
        sc.description                    AS service_desc,
        p.npi                             AS provider_npi,
        p.name                            AS provider_name,
        p.provider_id_sandata             AS provider_id_sandata
    FROM care.visits v
    JOIN  care.visit_evv              ev ON ev.visit_id     = v.id
    LEFT JOIN care.visit_billing      vb ON vb.visit_id     = v.id
    LEFT JOIN care.visit_integration_status vi ON vi.visit_id = v.id
    JOIN  care.employees              e  ON v.employee_id   = e.id AND e.agency_id = v.agency_id
    JOIN  care.clients                c  ON v.client_id     = c.id AND c.agency_id = v.agency_id
    JOIN  care.service_codes          sc ON v.service_code_id = sc.id
    JOIN care.agencies a ON a.id = v.agency_id
    LEFT JOIN care.providers p ON p.provider_id_sandata = a.sandata_provider_id
                              AND p.agency_id = v.agency_id AND p.is_active = 1
    WHERE v.id = :visit_id AND v.visit_cancelled = 0
"""


def _record_submission(
    db: Session,
    visit_id: int,
    transaction_id: str,
    payload_json: str,
    status: str,
    response_code: str,
    response_message: str,
    now_utc: datetime,
    aggregator: str = "sandata",
) -> int:
    """Insert a row into care.aggregator_submissions and return its id."""
    result = db.execute(
        text("""
            INSERT INTO care.aggregator_submissions
                (visit_id, aggregator, submission_type, payload, status, response_code,
                 response_message, submitted_at, response_at, created_at)
            OUTPUT INSERTED.id
            VALUES
                (:visit_id, :aggregator, 'Visit', :payload, :status, :txn_id,
                 :msg, :submitted_at, :response_at, :created_at)
        """),
        {
            "visit_id":     visit_id,
            "aggregator":   aggregator,
            "payload":      payload_json,
            "status":       status,
            "txn_id":       transaction_id,
            "msg":          response_message,
            "submitted_at": now_utc,
            "response_at":  now_utc,
            "created_at":   now_utc,
        },
    ).fetchone()
    return result[0]


def _update_sandata_status(
    db: Session, visit_id: int, new_status: str, now_utc: datetime
) -> None:
    """Update visit_integration_status.sandata_status after a Sandata submission attempt."""
    db.execute(
        text("""
            UPDATE care.visit_integration_status
            SET    sandata_status = :status, sandata_last_at = :now, updated_at = :now
            WHERE  visit_id = :visit_id
        """),
        {"status": new_status, "now": now_utc, "visit_id": visit_id},
    )
    db.execute(
        text("UPDATE care.visits SET updated_at = :now WHERE id = :visit_id"),
        {"now": now_utc, "visit_id": visit_id},
    )


def _do_submit(visit_id: int, db: Session, scope: AgencyScope) -> VisitSubmitResponse:
    """Shared logic: build Sandata payload → call API → record result."""
    now_utc = now_eastern_naive()

    row = db.execute(
        text(f"{_VISIT_SQL} AND {scope.sql_filter('v')}"),
        scope.bind({"visit_id": visit_id}),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Visit {visit_id} not found.")

    sandata_status = row.sandata_status
    if sandata_status is None:
        raise HTTPException(
            status_code=422,
            detail="Cannot submit — visit has no Sandata integration status row.",
        )
    if sandata_status == "Draft":
        raise HTTPException(
            status_code=422,
            detail="Cannot submit — EVV not yet validated (sandata_status is Draft).",
        )
    if sandata_status in ("Submitted", "Accepted"):
        raise HTTPException(
            status_code=409,
            detail=f"Visit has already been submitted to Sandata (status: {sandata_status}).",
        )

    provider_id_sandata = str(getattr(row, "provider_id_sandata", "") or "")
    if not provider_id_sandata:
        raise HTTPException(
            status_code=422,
            detail="Visit cannot be submitted — an active provider matching the agency's Sandata ID is not configured.",
        )
    if svc.is_live() and not svc.live_provider_matches(provider_id_sandata):
        raise HTTPException(
            status_code=422,
            detail="Visit cannot be submitted — live Sandata credentials are not configured for this agency's provider.",
        )

    transaction_id = f"TXN-{now_utc.strftime('%Y%m%d')}-{visit_id:05d}"
    payload = svc.build_visit_payload(row, transaction_id, now_utc)
    payload_json = json.dumps(payload, indent=2)

    if not svc.is_live():
        # ---------------------------------------------------------------
        # SIMULATE mode: simulator is the validation gate — call it before
        # committing so a rejected visit never reaches the DB as Accepted.
        # ---------------------------------------------------------------
        sim_payload      = svc.build_visit_simulator_payload(row, now_utc)
        sim_payload_json = json.dumps(sim_payload)
        _agg_log.info("Sandata simulator → POST /api/evv/visits  visit_id=%s", visit_id)
        try:
            sim_status, sim_code, sim_msg = svc.post_to_simulator(
                "/api/evv/visits", sim_payload_json, entity_id=str(visit_id)
            )
        except Exception as sim_exc:
            _agg_log.warning(
                "Sandata simulator unreachable for visit_id=%s: %s", visit_id, sim_exc
            )
            sim_status, sim_code, sim_msg = "Error", "SIM_UNREACHABLE", str(sim_exc)

        if sim_status != "Success":
            _agg_log.warning(
                "Sandata simulator REJECTED visit_id=%s  status=%s  code=%s  errors=%s",
                visit_id, sim_status, sim_code, sim_msg,
            )
            # Record the failure, rollback, and surface the error to the caller
            try:
                _record_submission(
                    db, visit_id, transaction_id, sim_payload_json,
                    "Rejected", sim_code, sim_msg, now_utc,
                    aggregator="sandata",
                )
                _update_sandata_status(db, visit_id, "Rejected", now_utc)
                db.commit()
            except Exception:
                db.rollback()
            raise HTTPException(
                status_code=422,
                detail=f"Sandata simulator validation failed: {sim_msg}",
            )

        _agg_log.info(
            "Sandata simulator ACCEPTED visit_id=%s  code=%s  msg=%s",
            visit_id, sim_code, sim_msg,
        )

        # Simulator accepted — record as Accepted and commit
        status, response_code, response_message = sim_status, sim_code, sim_msg
        _record_submission(
            db, visit_id, transaction_id, sim_payload_json,
            "Accepted", response_code, response_message, now_utc,
            aggregator="sandata",
        )
        _update_sandata_status(db, visit_id, "Accepted", now_utc)
        db.commit()

    else:
        # ---------------------------------------------------------------
        # LIVE mode: real Sandata is the gate; simulator is secondary/audit
        # ---------------------------------------------------------------
        status, response_code, response_message = svc.post_to_sandata(
            payload_json, transaction_id=transaction_id
        )

        _record_submission(
            db, visit_id, transaction_id, payload_json,
            status, response_code, response_message, now_utc,
            aggregator="sandata",
        )

        new_sandata_status = "Accepted" if status == "Accepted" else "Rejected"
        _update_sandata_status(db, visit_id, new_sandata_status, now_utc)
        db.commit()

        # Secondary simulator audit (non-fatal)
        try:
            sim_payload      = svc.build_visit_simulator_payload(row, now_utc)
            sim_payload_json = json.dumps(sim_payload)
            _agg_log.info("Sandata simulator (audit) → POST /api/evv/visits  visit_id=%s", visit_id)
            sim_status, sim_code, sim_msg = svc.post_to_simulator(
                "/api/evv/visits", sim_payload_json, entity_id=str(visit_id)
            )
            if sim_status == "Success":
                _agg_log.info(
                    "Sandata simulator audit ← visit_id=%s  status=%s  code=%s  msg=%s",
                    visit_id, sim_status, sim_code, sim_msg,
                )
            else:
                _agg_log.warning(
                    "Sandata simulator audit FAILED ← visit_id=%s  status=%s  code=%s  errors=%s",
                    visit_id, sim_status, sim_code, sim_msg,
                )
        except Exception as sim_exc:
            _agg_log.warning(
                "Sandata simulator audit error for visit_id=%s: %s", visit_id, sim_exc
            )

    return VisitSubmitResponse(
        success=(status == "Accepted" or status == "Success"),
        visit_id=visit_id,
        transaction_id=transaction_id,
        status=status,
        message=response_message,
        payload=payload,
    )


# ---------------------------------------------------------------------------
# GET /api/aggregator/mode
# ---------------------------------------------------------------------------
@router.get("/mode")
def get_mode(scope: AgencyScope = Depends(get_aggregator_scope)):
    """Return current Sandata submission mode."""
    return {"mode": "live" if svc.is_live() else "simulate"}


# ---------------------------------------------------------------------------
# GET /api/aggregator/queue
# ---------------------------------------------------------------------------
@router.get("/queue", response_model=AggregatorQueueResponse)
def get_queue(
    aggregator: str = Query(default="", description="'sandata' or 'hhax'. Defaults to 'sandata'."),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_aggregator_scope),
):
    """
    Returns visits ready for aggregator submission.
    aggregator='sandata' (default): sandata_status='Ready', no prior Accepted sandata submission.
    aggregator='hhax': hhax_status='Ready', no prior Accepted hhax submission.
    """
    agg = aggregator.lower() if aggregator else "sandata"
    if agg == "hhax":
        status_col = "vi.hhax_status"
        agg_name = "hhax"
    else:
        status_col = "vi.sandata_status"
        agg_name = "sandata"

    try:
        rows = db.execute(text(f"""
            SELECT
                v.id                                                AS visit_id,
                CONVERT(VARCHAR(10), v.service_date, 23)           AS service_date,
                c.first_name + ' ' + c.last_name                   AS client_name,
                e.first_name + ' ' + e.last_name                   AS employee_name,
                sc.hcpcs_code                                      AS service_code,
                ev.evv_status,
                vb.approval_status,
                vi.sandata_status,
                vi.hhax_status,
                COUNT(s.id)                                        AS prior_attempts,
                MAX(CONVERT(VARCHAR(19), s.submitted_at, 120))     AS last_attempt_at
            FROM care.visits v
            JOIN care.clients   c        ON v.client_id        = c.id AND c.agency_id = v.agency_id
            JOIN care.employees e        ON v.employee_id      = e.id AND e.agency_id = v.agency_id
            JOIN care.service_codes sc   ON v.service_code_id  = sc.id
            JOIN care.visit_evv          ev ON ev.visit_id     = v.id
            JOIN care.visit_integration_status vi ON vi.visit_id = v.id
            LEFT JOIN care.visit_billing vb ON vb.visit_id     = v.id
            LEFT JOIN care.aggregator_submissions s
                ON s.visit_id = v.id AND s.aggregator = '{agg_name}'
            WHERE {status_col} = 'Ready'
              AND v.visit_cancelled = 0
              AND {scope.sql_filter('v')}
              AND NOT EXISTS (
                  SELECT 1 FROM care.aggregator_submissions sub
                  WHERE sub.visit_id = v.id
                    AND sub.aggregator = '{agg_name}'
                    AND sub.status = 'Accepted'
              )
            GROUP BY
                v.id, v.service_date,
                c.first_name, c.last_name,
                e.first_name, e.last_name,
                sc.hcpcs_code,
                ev.evv_status, vb.approval_status,
                vi.sandata_status, vi.hhax_status
            ORDER BY v.service_date DESC, v.id
        """), scope.bind({})).fetchall()

        items = [
            AggregatorQueueItem(
                visit_id=r.visit_id,
                service_date=r.service_date or "",
                client_name=r.client_name or "",
                employee_name=r.employee_name or "",
                service_code=r.service_code or "",
                evv_status=r.evv_status or "",
                approval_status=r.approval_status or "",
                sandata_status=r.sandata_status,
                hhax_status=r.hhax_status,
                prior_attempts=r.prior_attempts or 0,
                last_attempt_at=r.last_attempt_at,
            )
            for r in rows
        ]

        return AggregatorQueueResponse(
            total=len(items),
            mode="live" if svc.is_live() else "simulate",
            items=items,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


# ---------------------------------------------------------------------------
# GET /api/aggregator/submissions
# ---------------------------------------------------------------------------
@router.get("/submissions", response_model=SubmissionsResponse)
def get_submissions(
    page: int = 1,
    per_page: int = 20,
    status: str = "",
    aggregator: str = Query(default="", description="Filter by aggregator: 'sandata' or 'hhax'."),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_aggregator_scope),
):
    """Paged history of all aggregator submissions with visit details."""
    try:
        offset = (page - 1) * per_page
        where = f"WHERE {scope.sql_filter('v')}"
        params: dict = scope.bind({"limit": per_page, "offset": offset})

        if status:
            where += " AND s.status = :status"
            params["status"] = status

        if aggregator:
            where += " AND s.aggregator = :aggregator"
            params["aggregator"] = aggregator.lower()

        total_row = db.execute(
            text(f"""
                SELECT COUNT(*) AS cnt
                FROM care.aggregator_submissions s
                JOIN care.visits v ON s.visit_id = v.id
                JOIN care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
                JOIN care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
                {where}
            """),
            params,
        ).fetchone()
        total = total_row.cnt if total_row else 0

        rows = db.execute(
            text(f"""
                SELECT
                    s.id,
                    s.visit_id,
                    s.aggregator,
                    CONVERT(VARCHAR(10), v.service_date, 23)       AS service_date,
                    c.first_name + ' ' + c.last_name               AS client_name,
                    e.first_name + ' ' + e.last_name               AS employee_name,
                    s.submission_type,
                    s.status,
                    s.response_code,
                    s.response_message,
                    CONVERT(VARCHAR(19), s.submitted_at, 120)      AS submitted_at,
                    s.response_code                                AS transaction_id
                FROM care.aggregator_submissions s
                JOIN care.visits   v ON s.visit_id   = v.id
                JOIN care.clients  c ON v.client_id  = c.id AND c.agency_id = v.agency_id
                JOIN care.employees e ON v.employee_id = e.id AND e.agency_id = v.agency_id
                {where}
                ORDER BY s.submitted_at DESC
                OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
            """),
            params,
        ).fetchall()

        items = [
            SubmissionRecord(
                id=r.id,
                visit_id=r.visit_id,
                aggregator=r.aggregator,
                service_date=r.service_date,
                client_name=r.client_name,
                employee_name=r.employee_name,
                submission_type=r.submission_type or "Visit",
                status=r.status,
                response_code=r.response_code,
                response_message=r.response_message,
                submitted_at=r.submitted_at,
                transaction_id=r.transaction_id,
            )
            for r in rows
        ]

        return SubmissionsResponse(total=total, page=page, per_page=per_page, items=items)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/aggregator/submit/{visit_id}
# ---------------------------------------------------------------------------
@router.post("/submit/{visit_id}", response_model=VisitSubmitResponse)
def submit_visit(visit_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_aggregator_scope)):
    """Submit a single visit to Sandata."""
    try:
        return _do_submit(visit_id, db, scope)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Submit failed: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/aggregator/batch
# ---------------------------------------------------------------------------
@router.post("/batch", response_model=BatchSubmitResponse)
def batch_submit(limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db), scope: AgencyScope = Depends(get_aggregator_scope)):
    """
    Submit all queued visits (Verified + no prior Accepted submission).
    Processes up to `limit` visits per call (default 50, max 200).
    """
    limit = min(limit, 200)

    try:
        queue_rows = db.execute(text(f"""
            SELECT v.id
            FROM care.visits v
            JOIN care.visit_integration_status vi ON vi.visit_id = v.id
            JOIN care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
            JOIN care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
            WHERE vi.sandata_status = 'Ready'
              AND v.visit_cancelled = 0
              AND {scope.sql_filter('v')}
              AND NOT EXISTS (
                  SELECT 1 FROM care.aggregator_submissions sub
                  WHERE sub.visit_id  = v.id
                    AND sub.aggregator = 'sandata'
                    AND sub.status     = 'Accepted'
              )
            ORDER BY v.service_date ASC, v.id ASC
        """), scope.bind({})).fetchall()

        visit_ids = [r.id for r in queue_rows[:limit]]
        total_queued = len(visit_ids)

        results: list[VisitSubmitResponse] = []
        accepted = rejected = errors = 0

        for vid in visit_ids:
            try:
                res = _do_submit(vid, db, scope)
                results.append(res)
                if res.status == "Accepted":
                    accepted += 1
                else:
                    rejected += 1
            except Exception as exc:
                errors += 1
                results.append(
                    VisitSubmitResponse(
                        success=False,
                        visit_id=vid,
                        transaction_id="",
                        status="Error",
                        message=str(exc),
                    )
                )

        return BatchSubmitResponse(
            total_queued=total_queued,
            submitted=len(results),
            accepted=accepted,
            rejected=rejected,
            errors=errors,
            results=results,
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch submit failed: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/aggregator/submissions/{id}/retry
# ---------------------------------------------------------------------------
@router.post("/submissions/{submission_id}/retry", response_model=VisitSubmitResponse)
def retry_submission(submission_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_aggregator_scope)):
    """
    Re-submit a rejected or failed aggregator submission.
    A new submission record is created — the old record is not modified.
    """
    try:
        sub = db.execute(
            text(f"""SELECT s.visit_id, s.status, s.aggregator FROM care.aggregator_submissions s
                     JOIN care.visits v ON v.id = s.visit_id
                     JOIN care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
                     JOIN care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
                     WHERE s.id = :id AND {scope.sql_filter('v')}"""),
            scope.bind({"id": submission_id}),
        ).fetchone()

        if not sub:
            raise HTTPException(status_code=404, detail=f"Submission {submission_id} not found.")

        if (sub.aggregator or "").lower() != "sandata":
            raise HTTPException(status_code=422, detail="Only Sandata submissions can be retried here.")

        if sub.status == "Accepted":
            raise HTTPException(
                status_code=409,
                detail="Submission was already accepted — retry not needed.",
            )

        return _do_submit(sub.visit_id, db, scope)

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Retry failed: {exc}") from exc
