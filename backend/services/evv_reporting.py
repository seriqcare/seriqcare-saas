"""Reporting rules; Pending is a workflow state, not a validation failure."""
import os

SCHEDULE_JOIN_SQL = '''LEFT JOIN care.schedules s ON s.id = v.schedule_id
    AND s.agency_id = v.agency_id AND s.client_id = v.client_id
    AND s.employee_id = v.employee_id AND s.status <> 'Cancelled' '''


def clock_out_grace_minutes() -> int:
    try:
        return max(0, int(os.getenv('EVV_CLOCK_OUT_GRACE_MINUTES', '30')))
    except ValueError:
        return 30


def exception_predicate(*, now_sql: str, deadline_sql: str) -> str:
    """Aliases ev and s refer to effective EVV data and the matching schedule.

    The caller supplies SQL expressions for time arithmetic, allowing the same
    classification to be checked independently of SQL Server's date functions.
    """
    return f"""(
        ev.evv_status = 'Failed'
        OR (ev.evv_status = 'Pending'
            AND COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL
            AND COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NULL
            AND s.scheduled_end IS NOT NULL
            AND {now_sql} > {deadline_sql})
    )"""
