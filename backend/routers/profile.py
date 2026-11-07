"""
Mobile caregiver profile endpoint.

GET /api/profile/me — return the authenticated user's profile + today's schedule count
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from db.database import get_db
from db.models import User

router = APIRouter()


class ProfileResponse(BaseModel):
    username:       str
    display_name:   str
    role:           str
    employee_id:    Optional[int] = None
    agency_id:      Optional[int] = None
    schedule_count: int
    status:         str


@router.get("/me", response_model=ProfileResponse)
def get_my_profile(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Return the authenticated user's profile and today's schedule count."""
    schedule_count = 0
    if current_user.employee_id:
        row = db.execute(
            text("""
                SELECT COUNT(*) AS cnt
                FROM   care.schedules
                WHERE  employee_id = :emp_id
                  AND  CAST(scheduled_start AS DATE) = :today
                  AND  status <> 'Cancelled'
            """),
            {"emp_id": current_user.employee_id, "today": date.today()},
        ).fetchone()
        if row:
            schedule_count = row.cnt

    return ProfileResponse(
        username       = current_user.username,
        display_name   = current_user.display_name or current_user.username,
        role           = current_user.role,
        employee_id    = current_user.employee_id,
        agency_id      = current_user.agency_id,
        schedule_count = schedule_count,
        status         = "Active" if current_user.is_active else "Inactive",
    )
