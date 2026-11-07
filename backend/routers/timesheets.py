"""
GET /api/timesheets
Queries care.timesheet when available (run sql/add_timesheet_table.sql to create it).
Falls back to a live JOIN on care.visits + employees + clients + service_codes
so the endpoint always returns data even before the table is populated.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_agency_scope, AgencyScope
from backend.payroll_settings import ensure_default_pay_group, ensure_payroll_tables
from backend.routers.settings import _normalize_pay_period, _read
from backend.services.timezone import UTC, now_eastern_naive
from db.database import get_db
from backend.schemas import (
    TimesheetAppliedPeriod,
    TimesheetApproveResponse,
    TimesheetEntry,
    TimesheetStats,
    TimesheetUpdateRequest,
    TimesheetUpdateResponse,
    TimesheetsResponse,
)

router = APIRouter()

_WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _week_bounds(week: str) -> tuple[date, date]:
    today  = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    if week.lower() == "current":
        return monday, sunday
    if week.lower() == "last2":
        return monday - timedelta(weeks=1), sunday
    if week.lower() == "last4":
        return monday - timedelta(weeks=3), sunday
    try:
        anchor = date.fromisoformat(week)
        start  = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    except ValueError:
        return monday, sunday


def _add_months(first_of_month: date, months: int) -> date:
    month_index = first_of_month.month - 1 + months
    year = first_of_month.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _month_close_date(year: int, month: int, configured_day: int) -> date:
    return date(year, month, min(max(configured_day, 1), monthrange(year, month)[1]))


def _week_start(day: date, starts_on: str | None) -> date:
    target = _WEEKDAY_INDEX.get((starts_on or "monday").lower(), 0)
    return day - timedelta(days=(day.weekday() - target) % 7)


def _pay_period_window_for_day(day: date, pay_period: dict) -> tuple[date, date]:
    frequency = str(pay_period.get("frequency") or "weekly").lower()

    if frequency == "daily":
        return day, day

    if frequency == "weekly":
        start = _week_start(day, pay_period.get("week_starts_on"))
        return start, start + timedelta(days=6)

    if frequency == "biweekly":
        anchor_raw = pay_period.get("anchor_date")
        anchor = date.fromisoformat(anchor_raw) if anchor_raw else _week_start(day, pay_period.get("week_starts_on"))
        period_index = (day - anchor).days // 14
        start = anchor + timedelta(days=period_index * 14)
        return start, start + timedelta(days=13)

    month_start = date(day.year, day.month, 1)

    if frequency == "monthly":
        close_day = int(pay_period.get("monthly_day") or 1)
        candidates = sorted(
            _month_close_date(candidate.year, candidate.month, close_day)
            for candidate in (_add_months(month_start, -1), month_start, _add_months(month_start, 1))
        )
        end = next(candidate for candidate in candidates if candidate >= day)
        previous_end = max(candidate for candidate in candidates if candidate < end)
        return previous_end + timedelta(days=1), end

    close_days = sorted(int(day_value) for day_value in (pay_period.get("semi_monthly_days") or [1, 15])[:2])
    candidates = sorted(
        _month_close_date(candidate.year, candidate.month, close_day)
        for candidate in (_add_months(month_start, -1), month_start, _add_months(month_start, 1))
        for close_day in close_days
    )
    end = next(candidate for candidate in candidates if candidate >= day)
    previous_end = max(candidate for candidate in candidates if candidate < end)
    return previous_end + timedelta(days=1), end


def _resolved_bounds(selection: str, scope: AgencyScope, db: Session) -> tuple[date, date, TimesheetAppliedPeriod]:
    if selection in {"pay_current", "pay_previous"}:
        settings = _read(scope.agency_id, db)
        pay_period = _normalize_pay_period(settings.get("pay_period"))
        today = date.today()
        start, end = _pay_period_window_for_day(today, pay_period)
        if selection == "pay_previous":
            start, end = _pay_period_window_for_day(start - timedelta(days=1), pay_period)
        label = "Current Pay Period" if selection == "pay_current" else "Previous Pay Period"
        return start, end, TimesheetAppliedPeriod(
            selection=selection,
            label=label,
            frequency=str(pay_period.get("frequency") or "weekly"),
            start_date=start.isoformat(),
            end_date=end.isoformat(),
        )

    start, end = _week_bounds(selection)
    if selection == "last2":
        label = "Last 2 Weeks"
    elif selection == "last4":
        label = "Last 4 Weeks"
    else:
        label = "This Week"
    return start, end, TimesheetAppliedPeriod(
        selection=selection,
        label=label,
        frequency="weekly",
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )


def _timesheet_table_exists(db: Session) -> bool:
    """Check whether care.timesheet has been created in the database."""
    ensure_payroll_tables(db)
    row = db.execute(
        text("SELECT OBJECT_ID('care.timesheet', 'U') AS obj_id")
    ).fetchone()
    return row is not None and row.obj_id is not None


def _timesheet_table_is_fresh(week: str, db: Session, scope: "AgencyScope") -> bool:
    """Treat care.visits as authoritative when the timesheet mirror is behind."""
    week_start, week_end, _ = _resolved_bounds(week, scope, db)
    params = scope.bind({
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
    })
    visits_row = db.execute(
        text(
            f"""
            SELECT
                COUNT(*) AS total,
                MAX(CONVERT(VARCHAR(10), v.service_date, 23)) AS latest_service_date
            FROM care.visits v
            WHERE v.visit_cancelled = 0
              AND {scope.sql_filter("v")}
              AND v.service_date >= :week_start
              AND v.service_date <= :week_end
            """
        ),
        params,
    ).fetchone()
    timesheet_row = db.execute(
        text(
            """
            SELECT
                COUNT(*) AS total,
                MAX(CONVERT(VARCHAR(10), t.service_date, 23)) AS latest_service_date
            FROM care.timesheet t
            WHERE t.service_date >= :week_start
              AND t.service_date <= :week_end
            """
        ),
        params,
    ).fetchone()

    visits_total = int(visits_row.total or 0)
    timesheet_total = int(timesheet_row.total or 0)
    visits_latest = visits_row.latest_service_date
    timesheet_latest = timesheet_row.latest_service_date

    if visits_total == 0:
        return True

    return timesheet_total >= visits_total and timesheet_latest == visits_latest


def _parse_service_time(service_date: str, clock_time: str) -> datetime:
    parsed_time = datetime.strptime(clock_time.strip(), "%H:%M")
    combined = datetime.strptime(
        f"{service_date} {parsed_time.strftime('%H:%M')}",
        "%Y-%m-%d %H:%M",
    )
    return combined.replace(tzinfo=UTC)


def _refresh_timesheet_row(visit_id: int, now_utc: datetime, db: Session) -> None:
    if not _timesheet_table_exists(db):
        return

    db.execute(
        text(
            """
            UPDATE t
            SET t.clock_in = COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                t.clock_out = COALESCE(ev.adj_out_datetime, ev.call_out_datetime),
                t.total_hours = CASE
                    WHEN COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL
                     AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NOT NULL
                    THEN CAST(DATEDIFF(
                        MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                    ) AS DECIMAL(10, 2)) / 60
                    ELSE 0
                END,
                t.regular_hours = CASE
                    WHEN COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL
                     AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NOT NULL
                    THEN CASE
                        WHEN CAST(DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) AS DECIMAL(10, 2)) / 60 > 8
                        THEN 8
                        ELSE CAST(DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) AS DECIMAL(10, 2)) / 60
                    END
                    ELSE 0
                END,
                t.ot_hours = CASE
                    WHEN COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL
                     AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NOT NULL
                     AND CAST(DATEDIFF(
                        MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                     ) AS DECIMAL(10, 2)) / 60 > 8
                    THEN CAST(DATEDIFF(
                        MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                    ) AS DECIMAL(10, 2)) / 60 - 8
                    ELSE 0
                END,
                t.pay_rate = ISNULL(pgr.rate, 0),
                t.gross_pay = CASE
                    WHEN ISNULL(pgr.pay_type, 'Hourly') = 'Per Visit' THEN ISNULL(pgr.rate, 0)
                    ELSE ISNULL(pgr.rate, 0) * CASE
                        WHEN COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL
                         AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NOT NULL
                        THEN CAST(DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) AS DECIMAL(10, 2)) / 60
                        ELSE 0
                    END
                END,
                t.notes = ISNULL(v.notes, t.notes),
                t.updated_at = :now
            FROM care.timesheet t
            JOIN care.visits v ON v.id = t.visit_id
            LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
            LEFT JOIN care.employee_payroll_settings eps ON eps.employee_id = v.employee_id
            LEFT JOIN care.pay_group_rates pgr ON pgr.id = eps.pay_group_rate_id
            WHERE t.visit_id = :visit_id
            """
        ),
        {"visit_id": visit_id, "now": now_utc},
    )


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.get("", response_model=TimesheetsResponse)
def get_timesheets(
    page:     int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=1000),
    week:     str = Query(default="current"),
    search:   str = Query(default=""),
    status:   str = Query(default=""),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        ensure_default_pay_group(db)
        use_table = _timesheet_table_exists(db)
        if use_table and not _timesheet_table_is_fresh(week, db, scope):
            use_table = False
        return (
            _query_timesheet_table(page, per_page, week, search, status, db, scope)
            if use_table
            else _query_visits_fallback(page, per_page, week, search, status, db, scope)
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


# ── Strategy A: care.timesheet (preferred, no JOINs) ──────────────────────────

def _query_timesheet_table(
    page: int, per_page: int, week: str,
    search: str, status: str, db: Session, scope: "AgencyScope",
) -> TimesheetsResponse:
    offset = (page - 1) * per_page
    week_start, week_end, applied_period = _resolved_bounds(week, scope, db)

    # care.timesheet has no agency_id — scope via employee
    agency_filter = (
        "1=1" if scope.is_global
        else "t.employee_id IN (SELECT id FROM care.employees WHERE agency_id = :_agy_id)"
    )
    where_parts: list[str] = [
        agency_filter,
        "t.service_date >= :week_start",
        "t.service_date <= :week_end",
    ]
    params: dict = scope.bind({
        "week_start": week_start.isoformat(),
        "week_end":   week_end.isoformat(),
        "offset":     offset,
        "per_page":   per_page,
    })
    if status and status.lower() not in ("all", ""):
        where_parts.append("t.approval_status = :status")
        params["status"] = status
    if search.strip():
        where_parts.append(
            "(t.first_name + ' ' + t.last_name LIKE :search "
            "OR t.employee_code LIKE :search "
            "OR t.client_name LIKE :search)"
        )
        params["search"] = f"%{search.strip()}%"

    where_sql = " AND ".join(where_parts)

    stats_row = db.execute(text(f"""
        SELECT
            COUNT(*)                                                    AS total_records,
            ISNULL(SUM(t.total_hours), 0)                              AS total_hours,
            COUNT(CASE WHEN t.approval_status = 'Pending'   THEN 1 END) AS pending,
            COUNT(CASE WHEN t.approval_status = 'Approved'  THEN 1 END) AS approved,
            COUNT(CASE WHEN t.evv_status      = 'Incomplete' THEN 1 END) AS exceptions
        FROM care.timesheet t WHERE {where_sql}
    """), params).fetchone()

    count_row = db.execute(text(f"""
        SELECT COUNT(*) AS total FROM care.timesheet t WHERE {where_sql}
    """), params).fetchone()

    rows = db.execute(text(f"""
        SELECT
            ISNULL(t.visit_id, t.id)            AS visit_id,
            t.employee_code,
            t.first_name,
            t.last_name,
            ISNULL(t.department_code, 'DSP')    AS department_code,
            t.client_name,
            CAST(t.client_id AS VARCHAR)         AS client_id,
            CONVERT(VARCHAR, t.service_date, 23) AS service_date,
            t.service_type,
            FORMAT(s.scheduled_start, 'hh:mm tt') AS scheduled_start,
            FORMAT(s.scheduled_end,   'hh:mm tt') AS scheduled_end,
            FORMAT(t.clock_in,  'hh:mm tt')      AS clock_in,
            FORMAT(t.clock_out, 'hh:mm tt')      AS clock_out,
            ISNULL(t.total_hours,   0)            AS total_hours,
            ISNULL(t.regular_hours, 0)            AS regular_hours,
            ISNULL(t.ot_hours,      0)            AS ot_hours,
            CASE WHEN t.clock_in_lat  IS NOT NULL AND t.clock_in_lon  IS NOT NULL THEN 1 ELSE 0 END AS has_gps_in,
            CASE WHEN t.clock_out_lat IS NOT NULL AND t.clock_out_lon IS NOT NULL THEN 1 ELSE 0 END AS has_gps_out,
            CAST(t.clock_in_lat  AS FLOAT)        AS clock_in_lat,
            CAST(t.clock_in_lon  AS FLOAT)        AS clock_in_lon,
            CAST(t.clock_out_lat AS FLOAT)         AS clock_out_lat,
            CAST(t.clock_out_lon AS FLOAT)         AS clock_out_lon,
            t.evv_status,
            t.approval_status,
            ISNULL(t.place_of_service, '12')      AS place_of_service,
            ISNULL(CAST(t.notes AS VARCHAR(MAX)), '') AS notes,
            COALESCE(CAST(pgr.rate AS FLOAT), CAST(t.pay_rate AS FLOAT), 0) AS pay_rate,
            CASE
                WHEN COALESCE(pgr.pay_type, 'Hourly') = 'Per Visit' THEN COALESCE(CAST(pgr.rate AS FLOAT), CAST(t.pay_rate AS FLOAT), 0)
                ELSE COALESCE(CAST(pgr.rate AS FLOAT), CAST(t.pay_rate AS FLOAT), 0) * ISNULL(t.total_hours, 0)
            END AS gross_pay
        FROM care.timesheet t
        LEFT JOIN care.visits v ON v.id = ISNULL(t.visit_id, t.id)
        LEFT JOIN care.schedules s ON s.id = v.schedule_id
        LEFT JOIN care.employee_payroll_settings eps ON eps.employee_id = t.employee_id
        LEFT JOIN care.pay_group_rates pgr ON pgr.id = eps.pay_group_rate_id
        WHERE {where_sql}
        ORDER BY t.service_date DESC, t.clock_in DESC
        OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
    """), params).fetchall()

    return _build_response(page, per_page, count_row, stats_row, applied_period, rows)


# ── Strategy B: live JOIN on care.visits (fallback before table is created) ────

def _query_visits_fallback(
    page: int, per_page: int, week: str,
    search: str, status: str, db: Session, scope: "AgencyScope",
) -> TimesheetsResponse:
    offset = (page - 1) * per_page
    week_start, week_end, applied_period = _resolved_bounds(week, scope, db)

    where_parts: list[str] = [
        "v.visit_cancelled = 0",
        scope.sql_filter("v"),
        "v.service_date >= :week_start",
        "v.service_date <= :week_end",
    ]
    params: dict = scope.bind({
        "week_start": week_start.isoformat(),
        "week_end":   week_end.isoformat(),
        "offset":     offset,
        "per_page":   per_page,
    })
    if status and status.lower() not in ("all", ""):
        where_parts.append("vb.approval_status = :status")
        params["status"] = status
    if search.strip():
        where_parts.append(
            "(e.first_name + ' ' + e.last_name LIKE :search "
            "OR e.employee_code LIKE :search "
            "OR c.first_name + ' ' + c.last_name LIKE :search)"
        )
        params["search"] = f"%{search.strip()}%"

    where_sql = " AND ".join(where_parts)

    stats_row = db.execute(text(f"""
        SELECT
            COUNT(*)                                                                AS total_records,
            ISNULL(SUM(
                CASE WHEN ev.call_out_datetime IS NOT NULL
                THEN DATEDIFF(MINUTE,
                    COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                    COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                ) / 60.0 END
            ), 0)                                                                   AS total_hours,
            COUNT(CASE WHEN vb.approval_status = 'Pending'   THEN 1 END)           AS pending,
            COUNT(CASE WHEN vb.approval_status = 'Approved'  THEN 1 END)           AS approved,
            COUNT(CASE WHEN ev.evv_status      = 'Incomplete' THEN 1 END)          AS exceptions
        FROM care.visits v
        JOIN care.employees    e  ON v.employee_id     = e.id
        JOIN care.clients      c  ON v.client_id       = c.id
        JOIN care.service_codes sc ON v.service_code_id = sc.id
        LEFT JOIN care.visit_evv     ev ON ev.visit_id = v.id
        LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
        WHERE {where_sql}
    """), params).fetchone()

    count_row = db.execute(text(f"""
        SELECT COUNT(*) AS total
        FROM care.visits v
        JOIN care.employees    e  ON v.employee_id     = e.id
        JOIN care.clients      c  ON v.client_id       = c.id
        JOIN care.service_codes sc ON v.service_code_id = sc.id
        LEFT JOIN care.visit_evv     ev ON ev.visit_id = v.id
        LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
        WHERE {where_sql}
    """), params).fetchone()

    rows = db.execute(text(f"""
        SELECT
            v.id                                                        AS visit_id,
            e.employee_code,
            e.first_name,
            e.last_name,
            'DSP'                                                       AS department_code,
            c.first_name + ' ' + c.last_name                            AS client_name,
            CAST(c.id AS VARCHAR)                                        AS client_id,
            CONVERT(VARCHAR, v.service_date, 23)                        AS service_date,
            sc.hcpcs_code                                               AS service_type,
            FORMAT(s.scheduled_start, 'hh:mm tt')                       AS scheduled_start,
            FORMAT(s.scheduled_end,   'hh:mm tt')                       AS scheduled_end,
            FORMAT(COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),  'hh:mm tt') AS clock_in,
            FORMAT(COALESCE(ev.adj_out_datetime, ev.call_out_datetime), 'hh:mm tt') AS clock_out,
            ISNULL(
                CASE WHEN ev.call_out_datetime IS NOT NULL
                THEN CAST(DATEDIFF(MINUTE,
                    COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                    COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                ) AS DECIMAL(6,2)) / 60 END,
            0)                                                           AS total_hours,
            ISNULL(
                CASE WHEN ev.call_out_datetime IS NOT NULL
                THEN
                    CASE WHEN DATEDIFF(MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)) / 60.0 > 8
                    THEN 8.00
                    ELSE CAST(DATEDIFF(MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                    ) AS DECIMAL(6,2)) / 60
                    END
                END,
            0)                                                           AS regular_hours,
            ISNULL(
                CASE WHEN ev.call_out_datetime IS NOT NULL
                THEN
                    CASE WHEN DATEDIFF(MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)) / 60.0 > 8
                    THEN CAST(DATEDIFF(MINUTE,
                        COALESCE(ev.adj_in_datetime, ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                    ) AS DECIMAL(6,2)) / 60 - 8.00
                    ELSE 0
                    END
                END,
            0)                                                           AS ot_hours,
            CASE WHEN ev.call_in_latitude  IS NOT NULL AND ev.call_in_longitude  IS NOT NULL THEN 1 ELSE 0 END AS has_gps_in,
            CASE WHEN ev.call_out_latitude IS NOT NULL AND ev.call_out_longitude IS NOT NULL THEN 1 ELSE 0 END AS has_gps_out,
            CAST(ev.call_in_latitude   AS FLOAT)                        AS clock_in_lat,
            CAST(ev.call_in_longitude  AS FLOAT)                        AS clock_in_lon,
            CAST(ev.call_out_latitude  AS FLOAT)                        AS clock_out_lat,
            CAST(ev.call_out_longitude AS FLOAT)                        AS clock_out_lon,
            ISNULL(ev.evv_status, 'Pending')                            AS evv_status,
            ISNULL(vb.approval_status, 'Pending')                       AS approval_status,
            ISNULL(v.place_of_service, '12')                            AS place_of_service,
            ISNULL(CAST(v.notes AS VARCHAR(MAX)), '')                   AS notes,
            COALESCE(CAST(pgr.rate AS FLOAT), 0)                        AS pay_rate,
            CASE
                WHEN COALESCE(pgr.pay_type, 'Hourly') = 'Per Visit' THEN COALESCE(CAST(pgr.rate AS FLOAT), 0)
                ELSE COALESCE(CAST(pgr.rate AS FLOAT), 0) * ISNULL(
                    CASE WHEN ev.call_out_datetime IS NOT NULL
                    THEN CAST(DATEDIFF(MINUTE,
                        COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                        COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                    ) AS DECIMAL(6,2)) / 60 END,
                0)
            END                                                         AS gross_pay
        FROM care.visits v
        JOIN care.employees    e  ON v.employee_id     = e.id
        JOIN care.clients      c  ON v.client_id       = c.id
        JOIN care.service_codes sc ON v.service_code_id = sc.id
        LEFT JOIN care.visit_evv     ev ON ev.visit_id = v.id
        LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
        LEFT JOIN care.schedules s ON s.id = v.schedule_id
        LEFT JOIN care.employee_payroll_settings eps ON eps.employee_id = e.id
        LEFT JOIN care.pay_group_rates pgr ON pgr.id = eps.pay_group_rate_id
        WHERE {where_sql}
        ORDER BY v.service_date DESC, ev.call_in_datetime DESC
        OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
    """), params).fetchall()

    return _build_response(page, per_page, count_row, stats_row, applied_period, rows)


# ── Shared row → response builder ──────────────────────────────────────────────

def _build_response(
    page: int,
    per_page: int,
    count_row,
    stats_row,
    applied_period: TimesheetAppliedPeriod,
    rows,
) -> TimesheetsResponse:
    items: list[TimesheetEntry] = []
    for r in rows:
        total_h   = round(float(r.total_hours   or 0), 2)
        regular_h = round(float(r.regular_hours or 0), 2)
        ot_h      = round(float(r.ot_hours      or 0), 2)
        items.append(TimesheetEntry(
            visit_id=int(r.visit_id),
            employee_code=str(r.employee_code),
            first_name=str(r.first_name),
            last_name=str(r.last_name),
            department_code=str(r.department_code),
            client_name=str(r.client_name),
            client_id=str(r.client_id),
            service_date=str(r.service_date),
            service_type=str(r.service_type),
            scheduled_start=r.scheduled_start,
            scheduled_end=r.scheduled_end,
            clock_in=r.clock_in,
            clock_out=r.clock_out,
            total_hours=total_h,
            regular_hours=regular_h,
            ot_hours=ot_h,
            has_gps_in=bool(r.has_gps_in),
            has_gps_out=bool(r.has_gps_out),
            clock_in_lat=float(r.clock_in_lat)   if r.clock_in_lat   is not None else None,
            clock_in_lon=float(r.clock_in_lon)   if r.clock_in_lon   is not None else None,
            clock_out_lat=float(r.clock_out_lat) if r.clock_out_lat  is not None else None,
            clock_out_lon=float(r.clock_out_lon) if r.clock_out_lon  is not None else None,
            evv_status=str(r.evv_status),
            approval_status=str(r.approval_status),
            place_of_service=str(r.place_of_service),
            notes=str(r.notes),
            pay_rate=round(float(r.pay_rate  or 0), 2),
            gross_pay=round(float(r.gross_pay or 0), 2),
        ))

    return TimesheetsResponse(
        total=int(count_row.total or 0),
        page=page,
        per_page=per_page,
        stats=TimesheetStats(
            total_records=int(stats_row.total_records or 0),
            total_hours=round(float(stats_row.total_hours or 0), 2),
            pending=int(stats_row.pending   or 0),
            approved=int(stats_row.approved or 0),
            exceptions=int(stats_row.exceptions or 0),
        ),
        applied_period=applied_period,
        items=items,
    )


@router.patch("/{visit_id}", response_model=TimesheetUpdateResponse)
def update_timesheet(
    visit_id: int,
    body: TimesheetUpdateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        row = db.execute(
            text(
                """
                SELECT v.id, v.schedule_id, CONVERT(VARCHAR, v.service_date, 23) AS service_date,
                       ISNULL(vb.approval_status, 'Pending') AS approval_status
                FROM care.visits v
                LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
                WHERE v.id = :id AND v.visit_cancelled = 0
                """
            ),
            {"id": visit_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Visit {visit_id} not found.")
        if row.approval_status != "Pending":
            raise HTTPException(status_code=422, detail="Only pending payroll entries can be edited.")
        if body.notes is None or not body.notes.strip():
            raise HTTPException(status_code=422, detail="Notes are required when editing a timesheet.")

        now_utc = now_eastern_naive()
        update_parts = ["updated_at = :now"]
        params: dict[str, object] = {"visit_id": visit_id, "now": now_utc}

        if body.clock_in and body.clock_in.strip():
            update_parts.append("adj_in_datetime = :adj_in")
            params["adj_in"] = _parse_service_time(str(row.service_date), body.clock_in)
        if body.clock_out and body.clock_out.strip():
            update_parts.append("adj_out_datetime = :adj_out")
            params["adj_out"] = _parse_service_time(str(row.service_date), body.clock_out)
        if body.notes is not None:
            update_parts.append("notes = :notes")
            params["notes"] = body.notes.strip()

        if "adj_in" in params and "adj_out" in params and params["adj_out"] <= params["adj_in"]:
            raise HTTPException(status_code=400, detail="Clock out must be later than clock in.")

        # notes lives on care.visits; adj times live on care.visit_evv
        visits_parts = [p for p in update_parts if not p.startswith("adj_")]
        db.execute(
            text(f"UPDATE care.visits SET {', '.join(visits_parts)} WHERE id = :visit_id"),
            {k: v for k, v in params.items() if k not in ("adj_in", "adj_out")},
        )

        evv_parts = [p for p in update_parts if p.startswith("adj_")]
        if evv_parts:
            evv_parts.append("updated_at = :now")
            db.execute(
                text(f"UPDATE care.visit_evv SET {', '.join(evv_parts)} WHERE visit_id = :visit_id"),
                {k: v for k, v in params.items() if k in ("visit_id", "now", "adj_in", "adj_out")},
            )

        if row.schedule_id and body.scheduled_start and body.scheduled_end:
            scheduled_start = _parse_service_time(str(row.service_date), body.scheduled_start)
            scheduled_end = _parse_service_time(str(row.service_date), body.scheduled_end)
            if scheduled_end <= scheduled_start:
                raise HTTPException(status_code=400, detail="Scheduled end must be later than scheduled start.")
            db.execute(
                text(
                    """
                    UPDATE care.schedules
                    SET scheduled_start = :scheduled_start,
                        scheduled_end = :scheduled_end,
                        notes = COALESCE(:schedule_notes, notes)
                    WHERE id = :schedule_id
                    """
                ),
                {
                    "schedule_id": int(row.schedule_id),
                    "scheduled_start": scheduled_start,
                    "scheduled_end": scheduled_end,
                    "schedule_notes": body.notes.strip() if body.notes else None,
                },
            )

        _refresh_timesheet_row(visit_id, now_utc, db)
        db.commit()

        return TimesheetUpdateResponse(
            success=True,
            visit_id=visit_id,
            message="Timesheet entry updated successfully.",
        )
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid time format. Use HH:MM.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}") from exc


# ── PATCH /api/timesheets/{visit_id}/approve ───────────────────────────────────

@router.patch("/{visit_id}/approve", response_model=TimesheetApproveResponse)
def approve_timesheet(
    visit_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Approve a timesheet entry. Sets approval_status = 'Approved' in
    care.visit_billing (primary) and care.timesheet (mirror if exists).
    Only rows in 'Pending' status can be approved.
    """
    try:
        # Verify the visit exists and is Pending
        row = db.execute(
            text("""
                SELECT v.id, ISNULL(vb.approval_status, 'Pending') AS approval_status
                FROM care.visits v
                LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
                WHERE v.id = :id AND v.visit_cancelled = 0
            """),
            {"id": visit_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Visit {visit_id} not found.")
        if row.approval_status == "Approved":
            raise HTTPException(status_code=422, detail=f"Visit {visit_id} is already Approved.")

        now_utc = now_eastern_naive()

        # Update care.visit_billing
        db.execute(
            text("UPDATE care.visit_billing SET approval_status = 'Approved', updated_at = :now WHERE visit_id = :id"),
            {"id": visit_id, "now": now_utc},
        )

        # Update care.timesheet if it exists
        use_table = _timesheet_table_exists(db)
        if use_table:
            db.execute(
                text("""
                    UPDATE care.timesheet
                    SET approval_status = 'Approved', updated_at = :now
                    WHERE visit_id = :visit_id
                """),
                {"visit_id": visit_id, "now": now_utc},
            )

        db.commit()

        return TimesheetApproveResponse(
            success=True,
            visit_id=visit_id,
            message="Timesheet entry approved.",
        )

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Approve failed: {exc}") from exc
