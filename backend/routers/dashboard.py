"""
GET /api/dashboard/metrics
Returns DashboardMetrics built from 6 SQL Server queries against the care schema.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from backend.services.authorization_usage import authorization_usage_join
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.database import get_db
from backend.auth.dependencies import AgencyScope, get_agency_scope
from backend.schemas import CaregiverUtilization, DashboardAuthorization, DashboardMetrics, PriorityItem, VisitByDay
from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR, SQLSERVER_LOCAL_DATE_EXPR, SQLSERVER_LOCAL_WEEK_START_DATE_EXPR
from backend.services.evv_reporting import SCHEDULE_JOIN_SQL, clock_out_grace_minutes, exception_predicate

router = APIRouter()

_AGGREGATOR_COUNTS_SQL = """
    SELECT
        COUNT(CASE WHEN s.status = 'Pending' THEN 1 END) AS pending_submissions,
        COUNT(CASE WHEN s.status = 'Rejected' THEN 1 END) AS rejected_submissions
    FROM care.aggregator_submissions s
    JOIN care.visits v ON v.id = s.visit_id
    WHERE {agency_filter}
      AND v.visit_cancelled = 0
      AND NOT EXISTS (
          SELECT 1 FROM care.aggregator_submissions newer
          WHERE newer.visit_id = s.visit_id
            AND newer.aggregator = s.aggregator
            AND newer.id > s.id
      )
"""

_UTILIZATION_SQL = f"""
    SELECT e.id, e.first_name + ' ' + e.last_name AS name,
           COALESCE(SUM(CASE WHEN s.scheduled_end > s.scheduled_start
               THEN DATEDIFF(MINUTE, s.scheduled_start, s.scheduled_end)
               ELSE 0 END), 0) / 60.0 AS scheduled_hours
    FROM care.employees e
    LEFT JOIN care.schedules s ON s.employee_id = e.id
        AND s.agency_id = e.agency_id
        AND s.status <> 'Cancelled'
        AND s.scheduled_start >= {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR}
        AND s.scheduled_start < DATEADD(DAY, 7, {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR})
        AND EXISTS (SELECT 1 FROM care.clients c
                    WHERE c.id = s.client_id AND c.agency_id = s.agency_id)
    WHERE e.is_active = 1 AND {{agency_filter}}
    GROUP BY e.id, e.first_name, e.last_name
    ORDER BY scheduled_hours DESC, e.first_name, e.last_name, e.id
"""


@router.get("/caregiver-utilization", response_model=list[CaregiverUtilization])
def get_caregiver_utilization(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    rows = db.execute(
        text(_UTILIZATION_SQL.format(agency_filter=scope.sql_filter("e"))),
        scope.bind({}),
    ).fetchall()
    return [
        CaregiverUtilization(
            employee_id=row.id,
            name=row.name,
            scheduled_hours=round(float(row.scheduled_hours), 2),
            utilization_pct=round(float(row.scheduled_hours) / 40 * 100, 1),
        )
        for row in rows
    ]


@router.get("/authorizations", response_model=list[DashboardAuthorization])
def get_dashboard_authorizations(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    rows = db.execute(
        text(f"""
            SELECT sa.id AS auth_id, c.id AS client_id,
                   c.first_name + ' ' + c.last_name AS client_name,
                   sc.hcpcs_code AS service_code, sa.auth_number,
                   sa.authorized_units, auth_usage.used_units, auth_unassigned.unassigned_visits,
                   DATEDIFF(DAY, {SQLSERVER_LOCAL_DATE_EXPR}, sa.service_end_date) AS days_until_expiry
            FROM care.service_authorizations sa
            JOIN care.clients c ON c.id = sa.client_id AND c.agency_id = sa.agency_id
            LEFT JOIN care.service_codes sc ON sc.id = sa.service_code_id
            {authorization_usage_join(include_unassigned=True)}
            WHERE sa.is_active = 1 AND c.is_active = 1 AND {scope.sql_filter('sa')}
            ORDER BY CASE WHEN sa.service_end_date IS NULL THEN 1 ELSE 0 END,
                     sa.service_end_date, CASE WHEN sa.authorized_units > 0 THEN auth_usage.used_units / sa.authorized_units ELSE 0 END DESC, c.first_name, c.last_name, sa.id
        """),
        scope.bind({}),
    ).fetchall()
    return [DashboardAuthorization(
        auth_id=r.auth_id, client_id=r.client_id, client_name=r.client_name,
        service_code=r.service_code, auth_number=r.auth_number,
        authorized_units=float(r.authorized_units or 0),
        unassigned_visits=int(getattr(r, 'unassigned_visits', 0) or 0),
        used_units=float(r.used_units or 0), days_until_expiry=r.days_until_expiry,
    ) for r in rows]


@router.get("/metrics", response_model=DashboardMetrics)
def get_dashboard_metrics(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        exception_sql = exception_predicate(
            now_sql=SQLSERVER_EASTERN_NOW_EXPR,
            deadline_sql='DATEADD(MINUTE, :clock_out_grace, s.scheduled_end)',
        )
        evv_params = scope.bind({'clock_out_grace': clock_out_grace_minutes()})
        # Match the visit's schedule within the same tenant and client/employee.
        schedule_join = SCHEDULE_JOIN_SQL
        # ------------------------------------------------------------------
        # 1. Client stats
        # ------------------------------------------------------------------
        client_row = db.execute(
            text(
                f"""
                SELECT
                    COUNT(CASE WHEN is_active = 1 THEN 1 END) AS active_clients,
                    COUNT(CASE WHEN created_at >= DATEFROMPARTS(
                              YEAR({SQLSERVER_LOCAL_DATE_EXPR}), MONTH({SQLSERVER_LOCAL_DATE_EXPR}), 1)
                          AND created_at < DATEADD(MONTH, 1, DATEFROMPARTS(
                              YEAR({SQLSERVER_LOCAL_DATE_EXPR}), MONTH({SQLSERVER_LOCAL_DATE_EXPR}), 1))
                          THEN 1 END) AS new_this_month,
                    COUNT(CASE WHEN care_plan_review_date IS NOT NULL
                          AND DATEDIFF(DAY, {SQLSERVER_LOCAL_DATE_EXPR},
                              TRY_CAST(care_plan_review_date AS DATE)) BETWEEN 0 AND 30
                          THEN 1 END) AS expiring_soon
                FROM care.clients
                WHERE {scope.sql_filter()}
                """
            ),
            scope.bind({}),
        ).fetchone()

        active_clients: int = int(client_row.active_clients or 0)
        expiring_soon: int = int(client_row.expiring_soon or 0)

        # ------------------------------------------------------------------
        # 2. Schedule stats (current Mon–Sun week)
        # ------------------------------------------------------------------
        sched_row = db.execute(
            text(
                f"""
                SELECT
                    COUNT(*) AS scheduled_this_week,
                    COUNT(CASE WHEN employee_id IS NULL THEN 1 END) AS open_shifts
                FROM care.schedules
                WHERE {scope.sql_filter()}
                                    AND scheduled_start >= {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR}
                                    AND scheduled_start < DATEADD(DAY, 7, {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR})
                  AND status != 'Cancelled'
                """
            ),
            scope.bind({}),
        ).fetchone()

        scheduled_this_week: int = int(sched_row.scheduled_this_week or 0)
        open_shifts: int = int(sched_row.open_shifts or 0)

        # ------------------------------------------------------------------
        # 3. Hours + pending approval (current week)
        # ------------------------------------------------------------------
        hours_row = db.execute(
            text(
                f"""
                SELECT
                    ISNULL(SUM(
                        CASE WHEN ev.evv_status IN ('Verified','Adjusted','Exempt')
                             AND ev.call_out_datetime IS NOT NULL
                        THEN DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) END
                    ) / 60.0, 0) AS total_hours,
                    COUNT(CASE WHEN vb.approval_status = 'Pending' THEN 1 END) AS pending_approval
                FROM care.visits v
                LEFT JOIN care.visit_evv     ev ON ev.visit_id = v.id
                LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                                    AND v.service_date >= {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR}
                """
            ),
            scope.bind({}),
        ).fetchone()

        total_hours: float = float(hours_row.total_hours or 0)
        pending_approval: int = int(hours_row.pending_approval or 0)

        # ------------------------------------------------------------------
        # 4. EVV status breakdown (current week)
        # evvProcessed → Adjusted, evvVerified → Verified,
        # Pending active/completed visits are separate from actual exceptions.
        # ------------------------------------------------------------------
        evv_row = db.execute(
            text(
                f"""
                SELECT
                    COUNT(CASE WHEN ev.evv_status = 'Adjusted'                    THEN 1 END) AS evv_processed,
                    COUNT(CASE WHEN ev.evv_status = 'Verified'                    THEN 1 END) AS evv_verified,
                    COUNT(CASE WHEN {exception_sql} THEN 1 END) AS evv_incomplete,
                    COUNT(CASE WHEN ev.evv_status = 'Pending'
                        AND COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL
                        AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NULL
                        AND NOT {exception_sql} THEN 1 END) AS evv_in_progress,
                    COUNT(CASE WHEN ev.evv_status = 'Pending'
                        AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NOT NULL
                        THEN 1 END) AS evv_pending_verification,
                    COUNT(CASE WHEN ev.evv_status = 'Exempt'                      THEN 1 END) AS evv_omit
                FROM care.visits v
                LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
                {schedule_join}
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                                    AND v.service_date >= {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR}
                """
            ),
            evv_params,
        ).fetchone()

        evv_processed: int = int(evv_row.evv_processed or 0)
        evv_verified: int = int(evv_row.evv_verified or 0)
        evv_incomplete: int = int(evv_row.evv_incomplete or 0)
        evv_omit: int = int(evv_row.evv_omit or 0)

        # ------------------------------------------------------------------
        # 5. Current submission state, not historical failed attempts.
        # ------------------------------------------------------------------
        agg_row = db.execute(
            text(_AGGREGATOR_COUNTS_SQL.format(agency_filter=scope.sql_filter("v"))),
            scope.bind({}),
        ).fetchone()

        pending_submissions: int = int(agg_row.pending_submissions or 0)
        rejected_submissions: int = int(agg_row.rejected_submissions or 0)

        # ------------------------------------------------------------------
        # 6. Actual validation failures or overdue missing clock-outs (all dates).
        # ------------------------------------------------------------------
        exc_row = db.execute(
            text(
                f"""
                SELECT
                    COUNT(CASE WHEN {exception_sql} THEN 1 END) AS evv_exceptions,
                    COUNT(CASE WHEN ev.evv_status = 'Failed'               THEN 1 END) AS urgent_exceptions
                FROM care.visits v
                LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
                {schedule_join}
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                """
            ),
            evv_params,
        ).fetchone()

        evv_exceptions: int = int(exc_row.evv_exceptions or 0)
        urgent_exceptions: int = int(exc_row.urgent_exceptions or 0)

        # ------------------------------------------------------------------
        # 7. Last 14 days — visit activity
        # ------------------------------------------------------------------
        activity_rows = db.execute(
            text(
                f"""
                SELECT
                    CONVERT(VARCHAR, v.service_date, 23) AS visit_date,
                    COUNT(*) AS cnt,
                    ISNULL(SUM(
                        CASE WHEN ev.call_out_datetime IS NOT NULL
                        THEN DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) END
                    ) / 60.0, 0) AS day_hours
                FROM care.visits v
                LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                                    AND v.service_date >= DATEADD(DAY, -13, {SQLSERVER_LOCAL_DATE_EXPR})
                GROUP BY CONVERT(VARCHAR, v.service_date, 23)
                ORDER BY visit_date
                """
            ),
            scope.bind({}),
        ).fetchall()

        visits_by_day: list[VisitByDay] = [
            VisitByDay(
                date=str(r.visit_date),
                count=int(r.cnt),
                hours=round(float(r.day_hours), 2),
            )
            for r in activity_rows
        ]

        # ------------------------------------------------------------------
        # Priority queue — build from gathered stats
        # ------------------------------------------------------------------
        priority_queue: list[PriorityItem] = []

        missing_clock_outs = evv_exceptions - urgent_exceptions
        if missing_clock_outs > 0:
            priority_queue.append(PriorityItem(
                title=f'{missing_clock_outs} Missing Clock-out(s)',
                sub=f'Scheduled end plus {evv_params["clock_out_grace"]}-minute grace period exceeded',
                type='warning',
            ))

        if urgent_exceptions > 0:
            priority_queue.append(
                PriorityItem(
                    title=f"{urgent_exceptions} Urgent EVV Exception(s)",
                    sub="Require acknowledgement",
                    type="urgent",
                )
            )

        if rejected_submissions > 0:
            priority_queue.append(
                PriorityItem(
                    title=f"{rejected_submissions} Rejected Submission(s)",
                    sub="Aggregator returned errors",
                    type="error",
                )
            )

        if expiring_soon > 0:
            priority_queue.append(
                PriorityItem(
                    title=f"{expiring_soon} Care Plan(s) Expiring",
                    sub="Review within 30 days",
                    type="warning",
                )
            )

        if open_shifts > 0:
            priority_queue.append(
                PriorityItem(
                    title=f"{open_shifts} Open Shift(s) This Week",
                    sub="No caregiver assigned",
                    type="warning",
                )
            )

        if pending_approval > 0:
            priority_queue.append(
                PriorityItem(
                    title=f"{pending_approval} Visit(s) Pending Approval",
                    sub="Timesheets awaiting review",
                    type="info",
                )
            )

        if pending_submissions > 0:
            priority_queue.append(
                PriorityItem(
                    title=f"{pending_submissions} Pending Submission(s)",
                    sub="Waiting to send to Sandata",
                    type="info",
                )
            )

        return DashboardMetrics(
            activeClients=active_clients,
            newClientsThisMonth=int(client_row.new_this_month or 0),
            carePlansExpiringSoon=expiring_soon,
            scheduledVisitsThisWeek=scheduled_this_week,
            openShifts=open_shifts,
            totalHoursThisWeek=round(total_hours, 2),
            pendingApproval=pending_approval,
            evvExceptions=evv_exceptions,
            urgentExceptions=urgent_exceptions,
            evvProcessed=evv_processed,
            evvVerified=evv_verified,
            evvIncomplete=evv_incomplete,
            evvInProgress=int(getattr(evv_row, 'evv_in_progress', 0) or 0),
            evvPendingVerification=int(getattr(evv_row, 'evv_pending_verification', 0) or 0),
            evvOmit=evv_omit,
            pendingSubmissions=pending_submissions,
            rejectedSubmissions=rejected_submissions,
            visitsByDay=visits_by_day,
            priorityQueue=priority_queue,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
