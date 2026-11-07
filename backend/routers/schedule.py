"""
GET /api/schedule/week
Returns the full weekly schedule with stats and alerts.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.database import get_db
from backend.auth.dependencies import get_agency_scope, AgencyScope
from backend.services.timezone import now_eastern_naive
from backend.schemas import (
    ScheduleAlert,
    ScheduleCreateRequest,
    ScheduleCreateResponse,
    ScheduleEntry,
    ScheduleResponse,
    ScheduleStats,
    ScheduleUpdateRequest,
    ScheduleUpdateResponse,
)

router = APIRouter()

# SQL Server DATEPART(WEEKDAY) returns 1=Sun, 2=Mon, ..., 7=Sat.
# We convert to 0-based Mon-first: Mon=0 … Sun=6.
_SQL_WEEKDAY_TO_MON_FIRST = {1: 6, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5}


def _week_bounds(reference: date) -> tuple[date, date]:
    """Return (Monday, Sunday) for the ISO week containing *reference*."""
    monday = reference - timedelta(days=reference.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _parse_schedule_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _resolve_service_code_id(db: Session, client_id: int, service_code: str | None):
    service_code_value = service_code.strip() if service_code else ""
    if service_code_value:
        return db.execute(
            text(
                """
                SELECT TOP 1 id
                FROM care.service_codes
                WHERE is_active = 1
                  AND (hcpcs_code = :service_code OR description = :service_code)
                ORDER BY CASE WHEN hcpcs_code = :service_code THEN 0 ELSE 1 END, id
                """
            ),
            {"service_code": service_code_value},
        ).fetchone()

    return db.execute(
        text(
            """
            SELECT TOP 1 sa.service_code_id AS id
            FROM care.service_authorizations sa
            WHERE sa.client_id = :client_id AND sa.is_active = 1
            ORDER BY sa.created_at DESC, sa.id DESC
            """
        ),
        {"client_id": client_id},
    ).fetchone()


@router.get("/service-codes")
def get_service_codes(db: Session = Depends(get_db)):
    """Return all active service codes for the schedule form dropdown."""
    try:
        rows = db.execute(
            text(
                """
                SELECT id, hcpcs_code, description
                FROM care.service_codes
                WHERE is_active = 1
                ORDER BY hcpcs_code
                """
            )
        ).fetchall()
        return [{"id": int(r.id), "code": str(r.hcpcs_code), "description": str(r.description)} for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("/week", response_model=ScheduleResponse)
def get_week_schedule(
    date: str = Query(
        default="",
        description="ISO date (YYYY-MM-DD) in the desired week. Defaults to today.",
    ),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        # Resolve reference date
        from datetime import date as _date
        if date:
            try:
                ref_date = _date.fromisoformat(date)
            except ValueError:
                ref_date = _date.today()
        else:
            ref_date = _date.today()

        week_start, week_end = _week_bounds(ref_date)
        week_start_str = week_start.isoformat()
        week_end_str = week_end.isoformat()

        # ------------------------------------------------------------------
        # Schedule entries for the week
        # ------------------------------------------------------------------
        entry_rows = db.execute(
            text(
                f"""
                SELECT
                    s.id,
                    s.client_id,
                    c.first_name + ' ' + c.last_name AS client_name,
                    s.employee_id,
                    e.first_name + ' ' + e.last_name AS employee_name,
                    sc.hcpcs_code AS service_code,
                    sc.description AS service_type,
                    CONVERT(VARCHAR, s.scheduled_start, 120) AS scheduled_start,
                    CONVERT(VARCHAR, s.scheduled_end,   120) AS scheduled_end,
                    s.status,
                    s.notes,
                    s.employee_id,
                    DATEPART(WEEKDAY, s.scheduled_start) AS day_of_week_sql
                FROM care.schedules s
                JOIN  care.clients       c  ON s.client_id      = c.id
                LEFT JOIN care.employees e  ON s.employee_id    = e.id
                JOIN  care.service_codes sc ON s.service_code_id = sc.id
                WHERE {scope.sql_filter("s")}
                  AND s.scheduled_start >= :week_start
                  AND s.scheduled_start < DATEADD(DAY, 1, CAST(:week_end AS DATE))
                  AND s.status != 'Cancelled'
                ORDER BY s.scheduled_start
                """
            ),
            scope.bind({"week_start": week_start_str, "week_end": week_end_str}),
        ).fetchall()

        entries: list[ScheduleEntry] = [
            ScheduleEntry(
                id=int(r.id),
                client_id=int(r.client_id),
                client_name=str(r.client_name),
                employee_id=int(r.employee_id) if r.employee_id is not None else None,
                employee_name=r.employee_name,
                service_code=r.service_code,
                service_type=r.service_type,
                scheduled_start=str(r.scheduled_start),
                scheduled_end=str(r.scheduled_end),
                status=str(r.status),
                notes=r.notes,
                day_of_week=_SQL_WEEKDAY_TO_MON_FIRST.get(int(r.day_of_week_sql), 0),
            )
            for r in entry_rows
        ]

        # ------------------------------------------------------------------
        # Stats
        # ------------------------------------------------------------------
        total = len(entries)
        open_shifts = sum(1 for r in entry_rows if r.employee_id is None)
        assigned_caregivers = len(
            {r.employee_id for r in entry_rows if r.employee_id is not None}
        )
        completed_this_week = sum(
            1 for r in entry_rows if str(r.status) == "Completed"
        )

        # Pending clock-out: visits with call_in but no call_out this week
        clock_out_row = db.execute(
            text(
                f"""
                SELECT COUNT(*) AS pending_clock_out
                FROM care.visits v
                JOIN care.visit_evv ev ON ev.visit_id = v.id
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                  AND ev.call_in_datetime IS NOT NULL
                  AND ev.call_out_datetime IS NULL
                  AND v.service_date >= :week_start
                  AND v.service_date <= :week_end
                """
            ),
            scope.bind({"week_start": week_start_str, "week_end": week_end_str}),
        ).fetchone()
        pending_clock_out = int(clock_out_row.pending_clock_out or 0)

        coverage_rate = (
            round((total - open_shifts) / total * 100) if total > 0 else 100
        )
        at_risk_visits = open_shifts + sum(
            1 for r in entry_rows
            if str(r.status) in ("Unconfirmed",) and r.employee_id is None
        )

        stats = ScheduleStats(
            scheduled_visits=total,
            open_shifts=open_shifts,
            assigned_caregivers=assigned_caregivers,
            completed_this_week=completed_this_week,
            pending_clock_out=pending_clock_out,
            coverage_rate=coverage_rate,
            at_risk_visits=at_risk_visits,
        )

        # ------------------------------------------------------------------
        # Alerts
        # ------------------------------------------------------------------
        alerts: list[ScheduleAlert] = []

        if open_shifts > 0:
            alerts.append(
                ScheduleAlert(
                    title=f"{open_shifts} Open Shift(s) This Week",
                    sub="No caregiver assigned",
                    text="Assign available caregivers to cover open shifts.",
                    pill=str(open_shifts),
                    cls="warning",
                )
            )

        if pending_clock_out > 0:
            alerts.append(
                ScheduleAlert(
                    title=f"{pending_clock_out} Pending Clock-Out(s)",
                    sub="Caregiver clocked in but not out",
                    text="Review visits where clock-out was not recorded.",
                    pill=str(pending_clock_out),
                    cls="error",
                )
            )

        if coverage_rate < 80:
            alerts.append(
                ScheduleAlert(
                    title=f"Low Coverage: {coverage_rate}%",
                    sub="More than 20% of shifts are open",
                    text="Staffing is critically low this week.",
                    pill=f"{coverage_rate}%",
                    cls="urgent",
                )
            )

        return ScheduleResponse(
            week_start=week_start_str,
            week_end=week_end_str,
            stats=stats,
            entries=entries,
            alerts=alerts,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.post("", response_model=ScheduleCreateResponse)
def create_schedule(
    body: ScheduleCreateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        start_dt = _parse_schedule_datetime(body.scheduled_start)
        end_dt = _parse_schedule_datetime(body.scheduled_end)
        if end_dt <= start_dt:
            raise HTTPException(
                status_code=400,
                detail="Scheduled end time must be after the start time.",
            )

        client_row = db.execute(
            text(
                """
                SELECT id
                FROM care.clients
                WHERE id = :client_id AND is_active = 1
                """
            ),
            {"client_id": body.client_id},
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found.")

        if body.employee_id is not None:
            employee_row = db.execute(
                text(
                    """
                    SELECT id
                    FROM care.employees
                    WHERE id = :employee_id AND is_active = 1
                    """
                ),
                {"employee_id": body.employee_id},
            ).fetchone()
            if not employee_row:
                raise HTTPException(status_code=404, detail="Caregiver not found.")

        service_row = _resolve_service_code_id(db, body.client_id, body.service_code)

        if not service_row:
            raise HTTPException(
                status_code=400,
                detail="Select a valid service type before saving the shift.",
            )

        status_value = (
            (body.status or ("Open" if body.employee_id is None else "Scheduled"))
            .strip()
            or "Scheduled"
        )
        notes_value = body.notes.strip() if body.notes else None
        now_local = now_eastern_naive()

        inserted = db.execute(
            text(
                """
                INSERT INTO care.schedules
                    (client_id, employee_id, service_code_id, scheduled_start, scheduled_end, status, notes, agency_id, created_at)
                OUTPUT INSERTED.id
                VALUES
                    (:client_id, :employee_id, :service_code_id, :scheduled_start, :scheduled_end, :status, :notes, :agency_id, :created_at)
                """
            ),
            {
                "client_id": body.client_id,
                "employee_id": body.employee_id,
                "service_code_id": int(service_row.id),
                "scheduled_start": start_dt,
                "scheduled_end": end_dt,
                "status": status_value,
                "notes": notes_value,
                "agency_id": scope.agency_id,
                "created_at": now_local,
            },
        ).fetchone()
        db.commit()

        return ScheduleCreateResponse(
            success=True,
            id=int(inserted.id),
            message="Shift saved successfully.",
        )
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid schedule date/time.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.patch("/{schedule_id}", response_model=ScheduleUpdateResponse)
def update_schedule(
    schedule_id: int,
    body: ScheduleUpdateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        existing = db.execute(
            text(
                f"""
                SELECT id
                FROM care.schedules
                WHERE id = :schedule_id
                  AND {scope.sql_filter()}
                """
            ),
            scope.bind({"schedule_id": schedule_id}),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Shift not found.")

        start_dt = _parse_schedule_datetime(body.scheduled_start)
        end_dt = _parse_schedule_datetime(body.scheduled_end)
        if end_dt <= start_dt:
            raise HTTPException(
                status_code=400,
                detail="Scheduled end time must be after the start time.",
            )

        client_row = db.execute(
            text(
                """
                SELECT id
                FROM care.clients
                WHERE id = :client_id AND is_active = 1
                """
            ),
            {"client_id": body.client_id},
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found.")

        if body.employee_id is not None:
            employee_row = db.execute(
                text(
                    """
                    SELECT id
                    FROM care.employees
                    WHERE id = :employee_id AND is_active = 1
                    """
                ),
                {"employee_id": body.employee_id},
            ).fetchone()
            if not employee_row:
                raise HTTPException(status_code=404, detail="Caregiver not found.")

        service_row = _resolve_service_code_id(db, body.client_id, body.service_code)
        if not service_row:
            raise HTTPException(
                status_code=400,
                detail="Select a valid service type before saving the shift.",
            )

        status_value = (
            (body.status or ("Open" if body.employee_id is None else "Scheduled"))
            .strip()
            or "Scheduled"
        )
        notes_value = body.notes.strip() if body.notes else None

        db.execute(
            text(
                """
                UPDATE care.schedules
                SET client_id = :client_id,
                    employee_id = :employee_id,
                    service_code_id = :service_code_id,
                    scheduled_start = :scheduled_start,
                    scheduled_end = :scheduled_end,
                    status = :status,
                    notes = :notes
                WHERE id = :schedule_id
                """
            ),
            {
                "schedule_id": schedule_id,
                "client_id": body.client_id,
                "employee_id": body.employee_id,
                "service_code_id": int(service_row.id),
                "scheduled_start": start_dt,
                "scheduled_end": end_dt,
                "status": status_value,
                "notes": notes_value,
            },
        )
        db.commit()

        return ScheduleUpdateResponse(
            success=True,
            id=schedule_id,
            message="Shift updated successfully.",
        )
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid schedule date/time.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
