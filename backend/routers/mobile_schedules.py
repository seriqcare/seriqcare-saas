"""
Mobile caregiver schedule endpoints.

GET /api/schedules/today  — today's schedules for the authenticated caregiver
GET /api/schedules/week   — 7-day schedule window for the authenticated caregiver

These routes are mobile-only (Flutter app) and use the caregiver's employee_id
from the JWT to scope results.  Portal schedule management routes remain under
/api/schedule (singular).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from backend.services.timezone import EASTERN
from db.database import get_db
from db.models import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ScheduleItem(BaseModel):
    id:           str
    schedule_id:  int
    client_id:    Optional[int] = None
    client_name:  str
    date_label:   str
    start_time:   str
    end_time:     str
    address:      str
    service_code: str
    status:       str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utc_to_local(dt: datetime) -> datetime:
    """Return database datetime as local display time (no second shift)."""
    if getattr(dt, "tzinfo", None) is not None:
        return dt.astimezone(EASTERN).replace(tzinfo=None)
    return dt


def _fmt12(dt: datetime) -> str:
    """Format as 12-hour time without leading zero — e.g. '8:00 AM'."""
    s = dt.strftime("%I:%M %p")
    return s.lstrip("0") or s


def _fetch_schedules(employee_id: int, from_date: date, to_date: date, db: Session):
    return db.execute(
        text("""
            SELECT
                s.id,
                c.id                                       AS client_id,
                c.first_name + ' ' + c.last_name          AS client_name,
                s.scheduled_start,
                s.scheduled_end,
                ISNULL(
                    ca.address1 + ', ' + ISNULL(ca.city, '') + ', ' + ISNULL(ca.state, ''),
                    'Address not on file'
                )                                          AS address,
                sc.hcpcs_code,
                s.status
            FROM       care.schedules        s
            JOIN       care.clients          c
                       ON c.id  = s.client_id
            LEFT JOIN  care.client_addresses ca
                       ON ca.client_id = c.id
                      AND ca.is_primary = 1
            JOIN       care.service_codes    sc
                       ON sc.id = s.service_code_id
            WHERE  s.employee_id = :emp_id
              AND  CAST(s.scheduled_start AS DATE) BETWEEN :from_d AND :to_d
              AND  s.status <> 'Cancelled'
            ORDER BY s.scheduled_start
        """),
        {"emp_id": employee_id, "from_d": from_date, "to_d": to_date},
    ).fetchall()


def _build_schedule_items(rows, today: date) -> List[ScheduleItem]:
    result: List[ScheduleItem] = []
    for r in rows:
        start_local = _utc_to_local(r.scheduled_start)
        end_local   = _utc_to_local(r.scheduled_end)
        date_label  = "Today" if start_local.date() == today else start_local.strftime("%b %-d")
        result.append(
            ScheduleItem(
                id           = str(r.id),
                schedule_id  = r.id,
                client_id    = r.client_id,
                client_name  = r.client_name,
                date_label   = date_label,
                start_time   = _fmt12(start_local),
                end_time     = _fmt12(end_local),
                address      = r.address,
                service_code = r.hcpcs_code,
                status       = r.status,
            )
        )
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/today", response_model=List[ScheduleItem])
def get_today_schedules(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Return all non-cancelled schedules for today assigned to the authenticated caregiver."""
    if current_user.employee_id is None:
        return []
    today = date.today()
    rows  = _fetch_schedules(current_user.employee_id, today, today, db)
    return _build_schedule_items(rows, today)


@router.get("/week", response_model=List[ScheduleItem])
def get_week_schedules(
    start_date:   Optional[date] = Query(default=None, description="Start date (YYYY-MM-DD); defaults to today"),
    current_user: User           = Depends(get_current_user),
    db:           Session        = Depends(get_db),
):
    """
    Return all non-cancelled schedules for a 7-day window starting on
    start_date (defaults to today) for the authenticated caregiver.
    """
    if current_user.employee_id is None:
        return []
    from_date = start_date or date.today()
    to_date   = from_date + timedelta(days=6)
    rows = _fetch_schedules(current_user.employee_id, from_date, to_date, db)
    return _build_schedule_items(rows, date.today())
