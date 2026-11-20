"""Operational visit verification, distinct from regulatory manual-edit compliance."""
from backend.services.evv_reporting import SCHEDULE_JOIN_SQL
from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR

CLOCK_IN = 'COALESCE(ev.adj_in_datetime, ev.call_in_datetime)'
CLOCK_OUT = 'COALESCE(ev.adj_out_datetime, ev.call_out_datetime)'


def timing_expressions(now_sql=SQLSERVER_EASTERN_NOW_EXPR):
    deadline = f"DATEADD(MINUTE, :clock_grace, COALESCE(s.scheduled_end, DATEADD(HOUR, 24, COALESCE({CLOCK_IN}, CAST(v.service_date AS DATETIME2)))))"
    overdue = f'(({CLOCK_IN} IS NULL OR {CLOCK_OUT} IS NULL) AND {now_sql} > {deadline})'
    active = f'({CLOCK_IN} IS NOT NULL AND {CLOCK_OUT} IS NULL AND NOT {overdue})'
    return overdue, active


def summary_query(agency_filter, now_sql=SQLSERVER_EASTERN_NOW_EXPR):
    overdue, active = timing_expressions(now_sql)
    exempt = "(sc.is_evv_required = 0 OR ev.evv_status = 'Exempt')"
    applicable = "(ISNULL(sc.is_evv_required, 1) = 1 AND ISNULL(ev.evv_status, '') <> 'Exempt')"
    due = f'({CLOCK_OUT} IS NOT NULL OR {overdue})'
    return f'''
        SELECT COUNT(*) AS total,
          COUNT(CASE WHEN {applicable} AND {due} THEN 1 END) AS due,
          COUNT(CASE WHEN {applicable} AND {CLOCK_IN} IS NOT NULL AND {CLOCK_OUT} IS NOT NULL
                      AND ev.evv_status IN ('Verified', 'Adjusted', 'Processed') THEN 1 END) AS verified_due,
          COUNT(CASE WHEN {active} THEN 1 END) AS in_progress,
          COUNT(CASE WHEN {overdue} THEN 1 END) AS overdue,
          COUNT(CASE WHEN {exempt} THEN 1 END) AS exempt,
          COUNT(CASE WHEN ev.evv_status IN ('Verified', 'Processed') THEN 1 END) AS verified,
          COUNT(CASE WHEN ev.evv_status = 'Adjusted' THEN 1 END) AS adjusted,
          COUNT(CASE WHEN ev.evv_status = 'Pending' AND NOT {active} THEN 1 END) AS pending,
          COUNT(CASE WHEN ev.evv_status = 'Failed' THEN 1 END) AS failed,
          COUNT(CASE WHEN ev.evv_status = 'Failed' OR {overdue} THEN 1 END) AS exceptions,
          COUNT(CASE WHEN {overdue} OR ({CLOCK_OUT} IS NOT NULL AND {CLOCK_IN} IS NULL) THEN 1 END) AS missing_clock,
          COUNT(CASE WHEN vb.approval_status = 'Denied' THEN 1 END) AS rejected
        FROM care.visits v
        JOIN care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
        JOIN care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
        JOIN care.service_codes sc ON sc.id = v.service_code_id
        LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
        LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
        {SCHEDULE_JOIN_SQL}
        WHERE v.visit_cancelled = 0 AND {agency_filter}
          AND v.service_date >= :week_start AND v.service_date <= :week_end
    '''
