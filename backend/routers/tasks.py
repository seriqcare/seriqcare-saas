"""
Mobile care task endpoints (Flutter caregiver app).

GET  /api/tasks?schedule_id=X — care plan tasks for the client on a given schedule
POST /api/tasks/complete       — bulk mark tasks complete (idempotent)

Access control:
  - caregiver: may only access schedules assigned to their employee record.
  - coordinator / agency_admin: scoped to their agency.
  - super_admin: unrestricted.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from db.database import get_db
from db.models import User
from backend.services.timezone import now_eastern_naive

log = logging.getLogger("seriqcare.tasks")
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TaskItem(BaseModel):
    task_id:         int
    client_id:       int
    title:           str
    description:     Optional[str] = None
    specific_time:   Optional[str] = None
    recurrence_text: Optional[str] = None
    sort_order:      int           = 0
    is_completed:    bool          = False
    completed_at:    Optional[str] = None


class CompleteTasksRequest(BaseModel):
    task_ids:    List[int]
    schedule_id: int
    notes:       Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_schedule_with_access_check(
    schedule_id:  int,
    current_user: User,
    db:           Session,
):
    """
    Fetch a schedule row and verify the current user may access it.
    Returns the schedule row on success; raises HTTP 403/404 otherwise.
    """
    schedule = db.execute(
        text("""
            SELECT s.id, s.client_id, s.employee_id, s.agency_id,
                   c.first_name + ' ' + c.last_name AS client_name
            FROM   care.schedules s
            JOIN   care.clients   c ON c.id = s.client_id
            WHERE  s.id = :sid
        """),
        {"sid": schedule_id},
    ).fetchone()

    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if current_user.role == "caregiver":
        if schedule.employee_id != current_user.employee_id:
            raise HTTPException(status_code=403, detail="Access denied")
    elif current_user.role in ("coordinator", "agency_admin"):
        if schedule.agency_id != current_user.agency_id:
            raise HTTPException(status_code=403, detail="Access denied")
    # super_admin: unrestricted

    return schedule


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[TaskItem])
def get_tasks(
    schedule_id:  int     = Query(..., description="Schedule ID to load tasks for"),
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Return active care plan tasks for the client linked to the given schedule,
    including today's completion state.
    """
    schedule = _get_schedule_with_access_check(schedule_id, current_user, db)
    today    = date.today()

    rows = db.execute(
        text("""
            SELECT
                t.id             AS task_id,
                t.client_id,
                t.title,
                t.description,
                t.specific_time,
                t.recurrence_text,
                t.sort_order,
                h.completed_at,
                CASE WHEN h.id IS NOT NULL THEN 1 ELSE 0 END AS is_completed
            FROM      care.client_care_tasks         t
            LEFT JOIN care.client_care_tasks_history h
                      ON  h.client_care_task_id = t.id
                      AND h.schedule_id          = :schedule_id
                      AND h.completed_on         = :today
            WHERE  t.client_id = :client_id
              AND  t.is_active  = 1
            ORDER BY t.sort_order, t.id
        """),
        {
            "client_id":   schedule.client_id,
            "schedule_id": schedule_id,
            "today":       today,
        },
    ).fetchall()

    return [
        TaskItem(
            task_id         = r.task_id,
            client_id       = r.client_id,
            title           = r.title,
            description     = r.description,
            specific_time   = r.specific_time,
            recurrence_text = r.recurrence_text,
            sort_order      = r.sort_order,
            is_completed    = bool(r.is_completed),
            completed_at    = (
                r.completed_at.strftime("%Y-%m-%d %H:%M")
                if r.completed_at else None
            ),
        )
        for r in rows
    ]


@router.post("/complete")
def complete_tasks(
    req:          CompleteTasksRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Mark one or more tasks as completed for today.
    Idempotent: skips tasks already completed today.
    The authenticated user's id is recorded — never taken from the request body.
    """
    schedule = _get_schedule_with_access_check(req.schedule_id, current_user, db)
    today    = date.today()
    now      = now_eastern_naive()
    completed_count = 0

    for task_id in req.task_ids:
        # Verify the task belongs to this client and is active
        task = db.execute(
            text("""
                SELECT id FROM care.client_care_tasks
                WHERE  id        = :tid
                  AND  client_id = :cid
                  AND  is_active = 1
            """),
            {"tid": task_id, "cid": schedule.client_id},
        ).fetchone()

        if task is None:
            continue  # skip tasks that don't belong to this client

        # Idempotent insert
        db.execute(
            text("""
                INSERT INTO care.client_care_tasks_history
                    (client_care_task_id, client_id, schedule_id, completed_on,
                     completed_at, completed_by_user_id, completion_notes)
                SELECT :task_id, :client_id, :schedule_id, :completed_on,
                       :completed_at, :user_id, :notes
                WHERE  NOT EXISTS (
                    SELECT 1 FROM care.client_care_tasks_history
                    WHERE  client_care_task_id = :task_id
                      AND  completed_on        = :completed_on
                )
            """),
            {
                "task_id":      task_id,
                "client_id":    schedule.client_id,
                "schedule_id":  req.schedule_id,
                "completed_on": today,
                "completed_at": now,
                "user_id":      current_user.id,
                "notes":        req.notes,
            },
        )
        db.commit()
        completed_count += 1

    log.info(
        f"Tasks completed: {completed_count} task(s) "
        f"by {current_user.username} for client {schedule.client_id}"
    )
    return {
        "success":   True,
        "completed": completed_count,
        "message":   f"{completed_count} task(s) marked complete",
    }
