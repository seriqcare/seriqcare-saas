"""
GET /api/visits
Returns paginated visit / timesheet records with EVV and approval status.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.database import get_db
from backend.auth.dependencies import get_agency_scope, AgencyScope
from backend.schemas import VisitEntry, VisitStats, VisitsResponse, VisitSubmitResponse, VisitFixRequest, VisitFixResponse, VisitValidateResponse, VisitValidateAllResponse
from backend.routers.aggregator import _do_submit
from backend.services.evv_validation import validate_and_gate
from backend.services.timezone import UTC, now_eastern_naive

router = APIRouter()


# ---------------------------------------------------------------------------
# Timesheet sync helper
# Calls care.usp_sync_timesheet_from_visit after any visit mutation.
# Silently skips if the timesheet table hasn't been created yet.
# ---------------------------------------------------------------------------
def _sync_timesheet(visit_id: int, db: Session) -> None:
    """
    Keep care.timesheet in sync after a visit is written.
    Non-fatal — a sync failure never rolls back the primary operation.
    """
    try:
        table_exists = db.execute(
            text("SELECT OBJECT_ID('care.timesheet', 'U') AS obj_id")
        ).fetchone()
        if table_exists and table_exists.obj_id is not None:
            db.execute(
                text("EXEC care.usp_sync_timesheet_from_visit :visit_id"),
                {"visit_id": visit_id},
            )
            db.commit()
    except Exception:
        db.rollback()   # don't let sync failure bleed into the caller's session


def _current_week_bounds() -> tuple[date, date]:
    """Return (Monday, Sunday) for the current ISO week."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


@router.get("", response_model=VisitsResponse)
def get_visits(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    week: str = Query(
        default="current",
        description="'current' for current ISO week, or a specific ISO date to anchor the week.",
    ),
    search: str = Query(default="", description="Search by visit ID, client, caregiver, or employee code."),
    status: str = Query(default="", description="Filter by EVV status (evv_status, sandata_status, or hhax_status depending on aggregator)."),
    aggregator: str = Query(default="", description="Scope status filter: '' = evv_status, 'sandata' = sandata_status, 'hhax' = hhax_status."),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        offset = (page - 1) * per_page

        # ------------------------------------------------------------------
        # Resolve week filter
        # ------------------------------------------------------------------
        today = date.today()
        current_monday = today - timedelta(days=today.weekday())
        current_sunday = current_monday + timedelta(days=6)

        if week.lower() == "current":
            week_start, week_end = current_monday, current_sunday
        elif week.lower() == "last2":
            # Last 2 full weeks + current week (14 days back from current Monday)
            week_start = current_monday - timedelta(weeks=1)
            week_end = current_sunday
        elif week.lower() == "last4":
            # Last 4 full weeks + current week (28 days back from current Monday)
            week_start = current_monday - timedelta(weeks=3)
            week_end = current_sunday
        else:
            try:
                anchor = date.fromisoformat(week)
                week_start = anchor - timedelta(days=anchor.weekday())
                week_end = week_start + timedelta(days=6)
            except ValueError:
                week_start, week_end = current_monday, current_sunday

        week_start_str = week_start.isoformat()
        week_end_str = week_end.isoformat()

        where_parts = [
            "v.visit_cancelled = 0",
            scope.sql_filter("v"),
            "v.service_date >= :week_start",
            "v.service_date <= :week_end",
        ]
        params: dict[str, object] = scope.bind({
            "week_start": week_start_str,
            "week_end": week_end_str,
            "offset": offset,
            "per_page": per_page,
        })

        if status and status.lower() not in ("all", ""):
            if aggregator.lower() == "sandata":
                where_parts.append("vi.sandata_status = :status")
            elif aggregator.lower() == "hhax":
                where_parts.append("vi.hhax_status = :status")
            else:
                where_parts.append("ev.evv_status = :status")
            params["status"] = status

        if search and search.strip():
            where_parts.append(
                "(" 
                "CAST(v.id AS VARCHAR(20)) LIKE :search "
                "OR e.first_name + ' ' + e.last_name LIKE :search "
                "OR e.employee_code LIKE :search "
                "OR c.first_name + ' ' + c.last_name LIKE :search"
                ")"
            )
            params["search"] = f"%{search.strip()}%"

        where_sql = " AND ".join(where_parts)

        # ------------------------------------------------------------------
        # Count total for pagination
        # ------------------------------------------------------------------
        count_row = db.execute(
            text(
                f"""
                SELECT COUNT(*) AS total
                FROM care.visits v
                JOIN care.employees e        ON v.employee_id = e.id
                JOIN care.clients   c        ON v.client_id   = c.id
                LEFT JOIN care.visit_evv                ev ON ev.visit_id = v.id
                LEFT JOIN care.visit_billing            vb ON vb.visit_id = v.id
                LEFT JOIN care.visit_integration_status vi ON vi.visit_id = v.id
                WHERE {where_sql}
                """
            ),
            params,
        ).fetchone()
        total = int(count_row.total or 0)

        # ------------------------------------------------------------------
        # Stats (same week filter)
        # ------------------------------------------------------------------
        stats_row = db.execute(
            text(
                f"""
                SELECT
                    ISNULL(SUM(
                        CASE WHEN ev.call_out_datetime IS NOT NULL
                        THEN DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) END
                    ) / 60.0, 0) AS total_hours,
                    COUNT(CASE WHEN vb.approval_status = 'Pending'  THEN 1 END) AS pending_approval,
                    COUNT(CASE WHEN vb.approval_status = 'Approved' THEN 1 END) AS approved,
                    COUNT(CASE WHEN ev.evv_status IN ('Pending', 'Failed') THEN 1 END) AS evv_exceptions
                FROM care.visits v
                JOIN care.employees e        ON v.employee_id = e.id
                JOIN care.clients   c        ON v.client_id   = c.id
                LEFT JOIN care.visit_evv                ev ON ev.visit_id = v.id
                LEFT JOIN care.visit_billing            vb ON vb.visit_id = v.id
                LEFT JOIN care.visit_integration_status vi ON vi.visit_id = v.id
                WHERE {where_sql}
                """
            ),
            params,
        ).fetchone()

        stats = VisitStats(
            total_hours=round(float(stats_row.total_hours or 0), 2),
            pending_approval=int(stats_row.pending_approval or 0),
            approved=int(stats_row.approved or 0),
            evv_exceptions=int(stats_row.evv_exceptions or 0),
        )

        # ------------------------------------------------------------------
        # Main visit list
        # ------------------------------------------------------------------
        visit_rows = db.execute(
            text(
                f"""
                SELECT
                    v.id,
                    e.first_name + ' ' + e.last_name AS employee_name,
                    e.employee_code,
                    c.first_name + ' ' + c.last_name AS client_name,
                    CONVERT(VARCHAR, v.service_date, 23) AS service_date,
                    FORMAT(COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),  'hh:mm tt') AS clock_in,
                    FORMAT(COALESCE(ev.adj_out_datetime, ev.call_out_datetime), 'hh:mm tt') AS clock_out,
                    ISNULL(
                        CASE WHEN ev.call_out_datetime IS NOT NULL
                        THEN DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) / 60.0 END,
                    0) AS total_hours,
                    ev.evv_status,
                    vb.approval_status,
                    CAST(ev.call_in_latitude   AS FLOAT) AS clock_in_lat,
                    CAST(ev.call_in_longitude  AS FLOAT) AS clock_in_lon,
                    CAST(ev.call_out_latitude  AS FLOAT) AS clock_out_lat,
                    CAST(ev.call_out_longitude AS FLOAT) AS clock_out_lon,
                    vi.sandata_status,
                    vi.hhax_status
                FROM care.visits v
                JOIN care.employees e        ON v.employee_id = e.id
                JOIN care.clients   c        ON v.client_id   = c.id
                LEFT JOIN care.visit_evv                ev ON ev.visit_id = v.id
                LEFT JOIN care.visit_billing            vb ON vb.visit_id = v.id
                LEFT JOIN care.visit_integration_status vi ON vi.visit_id = v.id
                WHERE {where_sql}
                ORDER BY v.service_date DESC, ev.call_in_datetime DESC
                OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
                """
            ),
            params,
        ).fetchall()

        items: list[VisitEntry] = [
            VisitEntry(
                id=int(r.id),
                employee_name=str(r.employee_name),
                employee_code=str(r.employee_code),
                client_name=str(r.client_name),
                service_date=str(r.service_date),
                clock_in=r.clock_in,
                clock_out=r.clock_out,
                total_hours=round(float(r.total_hours or 0), 2),
                evv_status=str(r.evv_status),
                approval_status=str(r.approval_status),
                clock_in_lat=float(r.clock_in_lat) if r.clock_in_lat is not None else None,
                clock_in_lon=float(r.clock_in_lon) if r.clock_in_lon is not None else None,
                clock_out_lat=float(r.clock_out_lat) if r.clock_out_lat is not None else None,
                clock_out_lon=float(r.clock_out_lon) if r.clock_out_lon is not None else None,
                sandata_status=str(r.sandata_status) if r.sandata_status is not None else None,
                hhax_status=str(r.hhax_status) if r.hhax_status is not None else None,
            )
            for r in visit_rows
        ]

        return VisitsResponse(
            total=total,
            page=page,
            per_page=per_page,
            stats=stats,
            items=items,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/visits/{visit_id}/submit  — Sandata EVV submission
# Delegates to the shared aggregator service (_do_submit).
# ---------------------------------------------------------------------------
@router.post("/{visit_id}/submit", response_model=VisitSubmitResponse)
def submit_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Build a PA-DHS EVV Vendor Spec v1.4 payload and submit to Sandata.
    Mode (simulate|live) is controlled by SANDATA_MODE in .env.
    Records the attempt in care.aggregator_submissions and marks the visit
    evv_status = 'Submitted' on acceptance.
    """
    if scope.agency_tier == 'core':
        raise HTTPException(
            status_code=403,
            detail="EVV submission is not available on the Core plan.",
        )
    try:
        result = _do_submit(visit_id, db)
        _sync_timesheet(visit_id, db)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Submit failed: {exc}") from exc


# ---------------------------------------------------------------------------
# PATCH /api/visits/{visit_id}/fix  — correct an Incomplete visit
# Sets evv_status = 'Ready' so it can be submitted to Sandata.
# ---------------------------------------------------------------------------
@router.patch("/{visit_id}/fix", response_model=VisitFixResponse)
def fix_visit(
    visit_id: int,
    body: VisitFixRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Apply a supervisor correction to a Pending or Failed visit.
    Sets evv_status = 'Adjusted' in visit_evv and optionally records corrected
    clock times in adj_in/adj_out_datetime.  Triggers EVV validation which then
    advances the appropriate aggregator column to 'Ready'.
    """
    try:
        row = db.execute(
            text("""
                SELECT v.id, v.service_date, ev.evv_status
                FROM   care.visits    v
                JOIN   care.visit_evv ev ON ev.visit_id = v.id
                WHERE  v.id = :id AND v.visit_cancelled = 0
            """),
            {"id": visit_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Visit {visit_id} not found.")
        if row.evv_status not in ("Pending", "Failed"):
            raise HTTPException(
                status_code=422,
                detail=f"Visit {visit_id} cannot be fixed — current evv_status: {row.evv_status}.",
            )

        now_utc = now_eastern_naive()
        update_parts = ["evv_status = 'Adjusted'", "updated_at = :now"]
        params: dict = {"visit_id": visit_id, "now": now_utc}

        # Parse optional corrected clock times (HH:MM AM/PM combined with service_date)
        service_date_str = str(row.service_date)[:10]
        for field, col, key in [
            (body.clock_in,  "adj_in_datetime",  "adj_in"),
            (body.clock_out, "adj_out_datetime", "adj_out"),
        ]:
            if field and field.strip():
                try:
                    from datetime import datetime as dt
                    combined = dt.strptime(f"{service_date_str} {field.strip()}", "%Y-%m-%d %I:%M %p")
                    combined = combined.replace(tzinfo=UTC)
                    update_parts.append(f"{col} = :{key}")
                    params[key] = combined
                except ValueError:
                    pass  # skip unparseable time; evv_status still flips to Adjusted

        db.execute(
            text(f"UPDATE care.visit_evv SET {', '.join(update_parts)} WHERE visit_id = :visit_id"),
            params,
        )
        db.execute(
            text("UPDATE care.visits SET updated_at = :now WHERE id = :visit_id"),
            {"now": now_utc, "visit_id": visit_id},
        )
        db.commit()

        # Apply state gate: Adjusted → integration_status Ready
        validate_and_gate(visit_id, db)
        db.commit()

        _sync_timesheet(visit_id, db)

        return VisitFixResponse(
            success=True,
            visit_id=visit_id,
            message="Visit corrected and marked Adjusted — queued for aggregator submission.",
        )

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Fix failed: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/visits/{visit_id}/validate  — re-run EVV validation on a single visit
# ---------------------------------------------------------------------------
@router.post("/{visit_id}/validate", response_model=VisitValidateResponse)
def validate_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Re-run validate_and_gate() on a single visit.
    Useful for visits that were inserted directly into the DB or whose
    clock-out validation failed silently.
    """
    try:
        exists = db.execute(
            text("SELECT id FROM care.visits WHERE id = :id AND visit_cancelled = 0"),
            {"id": visit_id},
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail=f"Visit {visit_id} not found.")

        new_status = validate_and_gate(visit_id, db)
        db.commit()
        _sync_timesheet(visit_id, db)

        return VisitValidateResponse(
            success=True,
            visit_id=visit_id,
            evv_status=new_status,
            message=f"Validation complete — evv_status set to '{new_status}'.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Validation failed: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/visits/validate-all  — backfill validation for all Pending visits
# ---------------------------------------------------------------------------
@router.post("/validate-all", response_model=VisitValidateAllResponse)
def validate_all_visits(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Re-run validate_and_gate() on every non-cancelled visit whose evv_status
    is still 'Pending'. Intended as a one-time backfill for visits inserted
    directly into the DB.
    """
    try:
        rows = db.execute(
            text(f"""
                SELECT v.id
                FROM care.visits v
                JOIN care.visit_evv ev ON ev.visit_id = v.id
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                  AND ev.evv_status = 'Pending'
            """),
            scope.bind({}),
        ).fetchall()

        processed = len(rows)
        updated = 0
        for row in rows:
            try:
                new_status = validate_and_gate(row.id, db)
                db.commit()
                if new_status != "Pending":
                    updated += 1
            except Exception:
                db.rollback()

        return VisitValidateAllResponse(
            processed=processed,
            updated=updated,
            message=f"Processed {processed} pending visits, updated {updated}.",
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Validate-all failed: {exc}") from exc
