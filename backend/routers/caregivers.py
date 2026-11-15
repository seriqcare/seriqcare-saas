"""
GET /api/caregivers
Returns paginated caregiver (employee) list with weekly visit stats.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.database import get_db
from backend.auth.dependencies import get_agency_scope, AgencyScope
from backend.payroll_settings import ensure_default_pay_group, sync_timesheet_payroll_for_employee
from backend.services import sandata as _sandata_svc
from backend.services.timezone import now_eastern_naive

_log = logging.getLogger("seriqcare.caregivers")
from backend.schemas import (
    CaregiverSummary, CaregiverStats, CaregiversResponse,
    CaregiverCreateRequest, CaregiverCreateResponse,
    CaregiverAccountDetails, CaregiverMobileAccount, CaregiverMobileAccountUpdate, CaregiverMobileUserOption,
    CaregiverPayrollSettingsResponse,
    CaregiverPayrollSettingsUpdateRequest,
    CaregiverPayrollSettingsUpdateResponse,
)

router = APIRouter()


def _current_week_bounds() -> tuple[date, date]:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


@router.get("/mobile-users", response_model=list[CaregiverMobileUserOption])
def get_caregiver_mobile_users(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    rows = db.execute(
        text(f"""
            SELECT e.id AS employee_id, e.first_name + ' ' + e.last_name AS name,
                e.employee_code, mobile.username
            FROM care.employees e
            OUTER APPLY (
                SELECT TOP 1 u.username FROM care.users u
                WHERE u.employee_id = e.id AND u.agency_id = e.agency_id
                  AND u.role = 'caregiver' AND u.is_active = 1
                ORDER BY u.id
            ) mobile
            WHERE {scope.sql_filter('e')}
            ORDER BY e.first_name, e.last_name, e.employee_code, e.id
        """),
        scope.bind({}),
    ).fetchall()
    return [CaregiverMobileUserOption(
        employee_id=row.employee_id, name=row.name, employee_code=row.employee_code, username=row.username,
    ) for row in rows]


@router.get("", response_model=CaregiversResponse)
def get_caregivers(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str = Query(default="", description="Filter by status: Active, On Leave, Inactive"),
    search: str = Query(default="", description="Search by name or employee code"),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        offset = (page - 1) * per_page
        week_start, week_end = _current_week_bounds()
        week_start_str = week_start.isoformat()
        week_end_str = week_end.isoformat()

        # Build WHERE clause using is_active (Designation/status columns not yet migrated)
        where_parts: list[str] = [scope.sql_filter("e")]
        params: dict = scope.bind({
            "week_start": week_start_str,
            "week_end": week_end_str,
            "offset": offset,
            "per_page": per_page,
        })

        # Map frontend status filter to is_active bit
        if status.lower() == "active":
            where_parts.append("e.is_active = 1")
        elif status.lower() in ("inactive", "on leave"):
            where_parts.append("e.is_active = 0")

        if search:
            where_parts.append(
                "(e.first_name + ' ' + e.last_name LIKE :search OR e.employee_code LIKE :search)"
            )
            params["search"] = f"%{search}%"

        where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        # Count
        count_row = db.execute(
            text(f"SELECT COUNT(*) AS total FROM care.employees e {where_clause}"),
            params,
        ).fetchone()
        total = int(count_row.total or 0)

        # Aggregate stats (scoped to agency)
        stats_row = db.execute(
            text(f"""
                SELECT
                    COUNT(*)                                       AS total_caregivers,
                    COUNT(CASE WHEN is_active = 1 THEN 1 END)     AS active,
                    0                                              AS on_leave,
                    COUNT(CASE WHEN is_active = 0 THEN 1 END)     AS inactive
                FROM care.employees e
                WHERE {scope.sql_filter("e")}
            """),
            scope.bind({}),
        ).fetchone()

        weekly_row = db.execute(
            text(f"""
                SELECT
                    COUNT(DISTINCT v.employee_id) AS assigned_this_week,
                    ISNULL(SUM(
                        CASE WHEN ev.call_out_datetime IS NOT NULL
                        THEN DATEDIFF(MINUTE,
                            COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) / 60.0 END
                    ), 0) AS total_hours_this_week
                FROM care.visits v
                LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
                WHERE v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
                  AND v.service_date >= :week_start
                  AND v.service_date <= :week_end
            """),
            scope.bind({"week_start": week_start_str, "week_end": week_end_str}),
        ).fetchone()

        stats = CaregiverStats(
            total_caregivers=int(stats_row.total_caregivers or 0),
            active=int(stats_row.active or 0),
            on_leave=int(stats_row.on_leave or 0),
            inactive=int(stats_row.inactive or 0),
            assigned_this_week=int(weekly_row.assigned_this_week or 0),
            total_hours_this_week=round(float(weekly_row.total_hours_this_week or 0), 2),
        )

        # Main list with per-caregiver weekly stats (subqueries)
        rows = db.execute(
            text(f"""
                SELECT
                    e.id,
                    e.employee_code,
                    e.first_name + ' ' + e.last_name                           AS name,
                    'DSP'                                                      AS role,
                    CASE WHEN e.is_active = 1 THEN 'Active' ELSE 'Inactive' END AS status,
                    CONVERT(VARCHAR, e.hire_date, 23)                          AS hire_date,
                    (
                        SELECT COUNT(DISTINCT s.client_id)
                        FROM care.schedules s
                        WHERE s.employee_id = e.id
                          AND s.scheduled_start >= :week_start
                          AND s.scheduled_start <= DATEADD(DAY, 1, :week_end)
                          AND s.status != 'Cancelled'
                    )                                                          AS clients_assigned,
                    (
                        SELECT COUNT(*)
                        FROM care.visits v
                        WHERE v.employee_id = e.id
                          AND v.service_date >= :week_start
                          AND v.service_date <= :week_end
                          AND v.visit_cancelled = 0
                    )                                                          AS visits_this_week,
                    (
                        SELECT ISNULL(SUM(
                            CASE WHEN ev.call_out_datetime IS NOT NULL
                            THEN DATEDIFF(MINUTE,
                                COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                                COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                            ) / 60.0 END
                        ), 0)
                        FROM care.visits v
                        LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
                        WHERE v.employee_id = e.id
                          AND v.service_date >= :week_start
                          AND v.service_date <= :week_end
                          AND v.visit_cancelled = 0
                    )                                                          AS hours_this_week
                FROM care.employees e
                {where_clause}
                ORDER BY e.is_active DESC, e.first_name, e.last_name
                OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
            """),
            params,
        ).fetchall()

        items: list[CaregiverSummary] = [
            CaregiverSummary(
                id=int(r.id),
                employee_code=str(r.employee_code),
                name=str(r.name),
                role=str(r.role),
                status=str(r.status),
                hire_date=r.hire_date,
                clients_assigned=int(r.clients_assigned or 0),
                visits_this_week=int(r.visits_this_week or 0),
                hours_this_week=round(float(r.hours_this_week or 0), 2),
            )
            for r in rows
        ]

        return CaregiversResponse(
            total=total,
            page=page,
            per_page=per_page,
            stats=stats,
            items=items,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /api/caregivers — create a new caregiver record
# ---------------------------------------------------------------------------
@router.post("", response_model=CaregiverCreateResponse, status_code=201)
def create_caregiver(
    body: CaregiverCreateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    if scope.agency_id is None:
        raise HTTPException(status_code=403, detail="An agency is required to create a caregiver.")
    employee_code = body.employee_code.strip()
    if not employee_code:
        raise HTTPException(status_code=422, detail="Employee code is required.")
    try:
        # Employee codes are unique within an agency, including inactive employees.
        existing = db.execute(
            text("SELECT id FROM care.employees WHERE agency_id = :agency_id AND employee_code = :code"),
            {"agency_id": scope.agency_id, "code": employee_code},
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Employee code '{employee_code}' is already in use in this agency.",
            )

        # Check for duplicate username if provided
        if body.username and body.username.strip():
            dup_user = db.execute(
                text("SELECT id FROM care.users WHERE username = :u"),
                {"u": body.username.strip()},
            ).fetchone()
            if dup_user:
                raise HTTPException(
                    status_code=409,
                    detail=f"Username '{body.username.strip()}' is already in use.",
                )

        agency_id = scope.agency_id

        # Insert employee — require the multi-agency schema before creating a record.
        # (it may have been added via ALTER TABLE after the initial DDL was run)
        has_agency_col = db.execute(
            text("""
                SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA='care' AND TABLE_NAME='employees' AND COLUMN_NAME='agency_id'
            """)
        ).fetchone() is not None

        if not has_agency_col:
            raise HTTPException(status_code=503, detail="Caregiver creation requires the agency schema migration.")

        if has_agency_col and agency_id:
            emp_row = db.execute(
                text("""
                    INSERT INTO care.employees
                        (agency_id, employee_code, first_name, last_name, phone,
                         hire_date, is_active, sandata_employee_id, npi)
                    OUTPUT INSERTED.id
                    VALUES
                        (:agency_id, :employee_code, :first_name, :last_name, :phone,
                         :hire_date, :is_active, :sandata_employee_id, :npi)
                """),
                {
                    "agency_id":           agency_id,
                    "employee_code":       body.employee_code.strip(),
                    "first_name":          body.first_name.strip(),
                    "last_name":           body.last_name.strip(),
                    "phone":               body.phone or None,
                    "hire_date":           body.hire_date or None,
                    "is_active":           1 if body.is_active else 0,
                    "sandata_employee_id": body.sandata_employee_id or None,
                    "npi":                 body.npi or None,
                },
            ).fetchone()
        else:
            emp_row = db.execute(
                text("""
                    INSERT INTO care.employees
                        (employee_code, first_name, last_name, phone,
                         hire_date, is_active, sandata_employee_id, npi)
                    OUTPUT INSERTED.id
                    VALUES
                        (:employee_code, :first_name, :last_name, :phone,
                         :hire_date, :is_active, :sandata_employee_id, :npi)
                """),
                {
                    "employee_code":       body.employee_code.strip(),
                    "first_name":          body.first_name.strip(),
                    "last_name":           body.last_name.strip(),
                    "phone":               body.phone or None,
                    "hire_date":           body.hire_date or None,
                    "is_active":           1 if body.is_active else 0,
                    "sandata_employee_id": body.sandata_employee_id or None,
                    "npi":                 body.npi or None,
                },
            ).fetchone()

        employee_id = int(emp_row.id)

        # Create mobile app login account if username + password provided
        user_created = False
        if body.username and body.username.strip() and body.initial_password and body.initial_password.strip():
            from backend.routers.auth import _hash_password
            display_name = f"{body.first_name.strip()} {body.last_name.strip()}"
            pw_hash = _hash_password(body.initial_password)
            db.execute(
                text("""
                    INSERT INTO care.users
                        (agency_id, username, display_name, email, role, is_active,
                         password_hash, employee_id)
                    VALUES
                        (:agency_id, :username, :display_name, :email, 'caregiver', :is_active,
                         :password_hash, :employee_id)
                """),
                {
                    "agency_id":     agency_id,
                    "username":      body.username.strip(),
                    "display_name":  display_name,
                    "email":         body.email.strip() if body.email else None,
                    "is_active":     1 if body.is_active else 0,
                    "password_hash": pw_hash,
                    "employee_id":   employee_id,
                },
            )
            user_created = True

        # ── EVV registration (skipped for Core tier agencies) ───────────────
        if scope.agency_tier == 'core':
            db.commit()
            msg = "Caregiver created successfully."
            if user_created:
                msg += f" Mobile login account created for '{body.username.strip()}'."
            return CaregiverCreateResponse(
                success=True,
                id=employee_id,
                employee_code=body.employee_code,
                message=msg,
            )

        now_utc = now_eastern_naive()

        prov_row = db.execute(
            text("SELECT TOP 1 provider_id_sandata FROM care.providers WHERE is_active = 1 ORDER BY id")
        ).fetchone()
        provider_id = str(prov_row.provider_id_sandata or "") if prov_row else ""

        if not provider_id:
            db.rollback()
            raise HTTPException(
                status_code=422,
                detail=(
                    "Caregiver not saved — Sandata ProviderID is not configured. "
                    "Set provider_id_sandata on your active provider row in care.providers, then try again."
                ),
            )

        class _Row:
            pass

        r = _Row()
        r.employee_code       = body.employee_code.strip()
        r.first_name          = body.first_name.strip()
        r.last_name           = body.last_name.strip()
        r.email               = body.email or ""
        r.sandata_employee_id = body.sandata_employee_id or ""
        r.provider_id         = provider_id
        r.ssn_last5           = body.ssn_last5 or "00000"
        r.employee_pin        = body.employee_pin or ""

        payload      = _sandata_svc.build_employee_evv_payload(r, now_utc)
        payload_json = json.dumps(payload)
        _log.info("Sandata simulator → POST /api/evv/employees  employee_id=%s code=%s",
                  employee_id, body.employee_code)

        try:
            sim_status, sim_code, sim_msg = _sandata_svc.post_to_simulator(
                "/api/evv/employees", payload_json, entity_id=str(employee_id)
            )
        except Exception as sim_exc:
            db.rollback()
            _log.error("Sandata simulator unreachable for employee_id=%s: %s", employee_id, sim_exc)
            raise HTTPException(
                status_code=422,
                detail=f"Caregiver not saved — could not reach Sandata: {sim_exc}",
            ) from sim_exc

        if sim_status != "Success":
            db.rollback()
            _log.warning(
                "Sandata simulator FAILED ← employee_id=%s  employee_code=%s  "
                "status=%s  code=%s  errors=%s",
                employee_id, body.employee_code, sim_status, sim_code, sim_msg,
            )
            raise HTTPException(
                status_code=422,
                detail=f"Caregiver not saved — Sandata registration failed: {sim_msg}",
            )

        _log.info("Sandata simulator ← employee_id=%s  status=%s  msg=%s",
                  employee_id, sim_status, sim_msg)

        # Sandata succeeded — commit everything
        db.commit()

        msg = "Caregiver created and registered with Sandata successfully."
        if user_created:
            msg += f" Mobile login account created for '{body.username.strip()}'."

        return CaregiverCreateResponse(
            success=True,
            id=employee_id,
            employee_code=body.employee_code,
            message=msg,
            sandata_status=sim_status,
            sandata_message=sim_msg,
        )

    except HTTPException:
        raise
    except IntegrityError as exc:
        db.rollback()
        if "uq_employees_agency_code" in str(exc.orig).lower():
            raise HTTPException(
                status_code=409,
                detail=f"Employee code '{employee_code}' is already in use in this agency.",
            ) from exc
        raise HTTPException(status_code=500, detail="Caregiver could not be saved due to a database constraint.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Create failed: {exc}") from exc


@router.get("/{caregiver_id}/account-details", response_model=CaregiverAccountDetails)
def get_caregiver_account_details(
    caregiver_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    employee = db.execute(
        text(f"""
            SELECT e.id, e.agency_id, e.phone, e.sandata_employee_id, e.hhax_employee_id, e.npi
            FROM care.employees e
            WHERE e.id = :id AND {scope.sql_filter('e')}
        """),
        scope.bind({"id": caregiver_id}),
    ).fetchone()
    if not employee:
        raise HTTPException(status_code=404, detail="Caregiver not found.")

    account = db.execute(
        text("""
            SELECT TOP 1 u.username, u.display_name, u.email, u.is_active,
                CASE WHEN NULLIF(u.password_hash, '') IS NOT NULL THEN 1 ELSE 0 END AS has_password
            FROM care.users u
            WHERE u.employee_id = :employee_id AND u.agency_id = :agency_id AND u.role = 'caregiver'
            ORDER BY u.is_active DESC, u.id
        """),
        {"employee_id": employee.id, "agency_id": employee.agency_id},
    ).fetchone()
    return CaregiverAccountDetails(
        employee_id=employee.id,
        phone=employee.phone,
        sandata_employee_id=employee.sandata_employee_id,
        hhax_employee_id=employee.hhax_employee_id,
        npi=employee.npi,
        mobile_account=CaregiverMobileAccount(
            username=account.username, display_name=account.display_name,
            email=account.email, is_active=bool(account.is_active), has_password=bool(account.has_password),
        ) if account else None,
    )


@router.put("/{caregiver_id}/mobile-account", response_model=CaregiverMobileAccount)
def save_caregiver_mobile_account(
    caregiver_id: int,
    body: CaregiverMobileAccountUpdate,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    username = body.username.strip()
    email = (body.email or "").strip() or None
    if not username:
        raise HTTPException(status_code=422, detail="Mobile username is required.")
    if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid account email address.")
    if body.new_password is not None and len(body.new_password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password must be at most 72 bytes.")

    try:
        # Serialize account creation for this employee, including concurrent requests.
        employee = db.execute(
            text(f"""
                SELECT e.id, e.agency_id FROM care.employees e WITH (UPDLOCK, HOLDLOCK)
                WHERE e.id = :id AND {scope.sql_filter('e')}
            """),
            scope.bind({"id": caregiver_id}),
        ).fetchone()
        if not employee:
            raise HTTPException(status_code=404, detail="Caregiver not found.")
        if employee.agency_id is None:
            raise HTTPException(status_code=422, detail="Assign this employee to an agency before creating a mobile account.")

        account = db.execute(
            text("""
                SELECT TOP 1 u.id, u.username, u.is_active,
                    CASE WHEN NULLIF(u.password_hash, '') IS NOT NULL THEN 1 ELSE 0 END AS has_password
                FROM care.users u
                WHERE u.employee_id = :employee_id AND u.agency_id = :agency_id AND u.role = 'caregiver'
                ORDER BY u.is_active DESC, u.id
            """),
            {"employee_id": employee.id, "agency_id": employee.agency_id},
        ).fetchone()
        duplicate = db.execute(
            text("SELECT id FROM care.users WHERE username = :username AND id <> :user_id"),
            {"username": username, "user_id": account.id if account else 0},
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail="This mobile username is already in use.")

        values = {
            "username": username, "display_name": (body.display_name or "").strip() or None,
            "email": email, "is_active": body.is_active,
            "employee_id": employee.id, "agency_id": employee.agency_id,
        }
        if body.new_password is not None:
            from backend.routers.auth import _hash_password
            values["password_hash"] = _hash_password(body.new_password)

        if account:
            values["user_id"] = account.id
            password_assignment = ", password_hash = :password_hash" if body.new_password is not None else ""
            db.execute(
                text(f"""
                    UPDATE care.users SET username = :username, display_name = :display_name,
                        email = :email, is_active = :is_active {password_assignment}
                    WHERE id = :user_id AND employee_id = :employee_id
                      AND agency_id = :agency_id AND role = 'caregiver'
                """), values,
            )
            if body.new_password is not None or username != account.username or not body.is_active:
                # Old access and refresh sessions must not survive credential changes.
                session_values = {"user_id": account.id, "now": datetime.utcnow()}
                for session_table in ("user_sessions", "device_sessions"):
                    db.execute(text(f"""
                        UPDATE care.{session_table} SET revoked_at = :now, revoke_reason = 'account_updated'
                        WHERE user_id = :user_id AND revoked_at IS NULL
                    """), session_values)
        else:
            values.setdefault("password_hash", None)
            db.execute(
                text("""
                    INSERT INTO care.users
                        (agency_id, employee_id, username, display_name, email, role, is_active, password_hash)
                    VALUES (:agency_id, :employee_id, :username, :display_name, :email,
                            'caregiver', :is_active, :password_hash)
                """), values,
            )
        db.commit()
        return CaregiverMobileAccount(
            username=username, display_name=values["display_name"], email=email,
            is_active=body.is_active, has_password=bool(body.new_password is not None or (account and account.has_password)),
        )
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This username or mobile account already exists.") from exc
    except Exception as exc:
        db.rollback()
        _log.error("Mobile account save failed for employee_id=%s: %s", caregiver_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Could not save the mobile account.") from exc


@router.get("/{caregiver_id}/payroll", response_model=CaregiverPayrollSettingsResponse)
def get_caregiver_payroll(caregiver_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    try:
        caregiver = db.execute(
            text(f"SELECT e.id FROM care.employees e WHERE e.id = :id AND {scope.sql_filter('e')}"),
            scope.bind({"id": caregiver_id}),
        ).fetchone()
        if not caregiver:
            raise HTTPException(status_code=404, detail=f"Caregiver {caregiver_id} not found.")

        ensure_default_pay_group(db)
        row = db.execute(
            text(
                """
                SELECT
                    eps.pay_group_id,
                    eps.pay_group_rate_id,
                    pg.name AS pay_group_name,
                    pgr.name AS pay_rate_name,
                    pgr.pay_type,
                    CAST(pgr.rate AS FLOAT) AS pay_rate
                FROM care.employees e
                LEFT JOIN care.employee_payroll_settings eps ON eps.employee_id = e.id
                LEFT JOIN care.pay_groups pg ON pg.id = eps.pay_group_id
                LEFT JOIN care.pay_group_rates pgr ON pgr.id = eps.pay_group_rate_id
                WHERE e.id = :id
                """
            ),
            {"id": caregiver_id},
        ).fetchone()

        return CaregiverPayrollSettingsResponse(
            caregiver_id=caregiver_id,
            pay_group_id=int(row.pay_group_id) if row and row.pay_group_id is not None else None,
            pay_group_rate_id=int(row.pay_group_rate_id) if row and row.pay_group_rate_id is not None else None,
            pay_group_name=row.pay_group_name if row else None,
            pay_rate_name=row.pay_rate_name if row else None,
            pay_type=row.pay_type if row else None,
            pay_rate=round(float(row.pay_rate or 0), 2) if row and row.pay_rate is not None else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Payroll load failed: {exc}") from exc


@router.patch("/{caregiver_id}/payroll", response_model=CaregiverPayrollSettingsUpdateResponse)
def update_caregiver_payroll(
    caregiver_id: int,
    body: CaregiverPayrollSettingsUpdateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        caregiver = db.execute(
            text(f"SELECT e.id FROM care.employees e WHERE e.id = :id AND {scope.sql_filter('e')}"),
            scope.bind({"id": caregiver_id}),
        ).fetchone()
        if not caregiver:
            raise HTTPException(status_code=404, detail=f"Caregiver {caregiver_id} not found.")

        ensure_default_pay_group(db)
        pay_group_id = int(body.pay_group_id) if body.pay_group_id is not None else None
        pay_group_rate_id = int(body.pay_group_rate_id) if body.pay_group_rate_id is not None else None

        if pay_group_rate_id is not None:
            rate_row = db.execute(
                text(
                    """
                    SELECT pay_group_id
                    FROM care.pay_group_rates
                    WHERE id = :id
                    """
                ),
                {"id": pay_group_rate_id},
            ).fetchone()
            if not rate_row:
                raise HTTPException(status_code=404, detail="Selected pay rate was not found.")
            rate_group_id = int(rate_row.pay_group_id)
            if pay_group_id is None:
                pay_group_id = rate_group_id
            elif pay_group_id != rate_group_id:
                raise HTTPException(status_code=422, detail="Selected pay rate does not belong to the selected pay group.")

        if pay_group_id is not None:
            group_row = db.execute(
                text("SELECT id FROM care.pay_groups WHERE id = :id"),
                {"id": pay_group_id},
            ).fetchone()
            if not group_row:
                raise HTTPException(status_code=404, detail="Selected pay group was not found.")

        existing = db.execute(
            text("SELECT id FROM care.employee_payroll_settings WHERE employee_id = :employee_id"),
            {"employee_id": caregiver_id},
        ).fetchone()
        now_local = now_eastern_naive()

        if existing:
            db.execute(
                text(
                    """
                    UPDATE care.employee_payroll_settings
                    SET pay_group_id = :pay_group_id,
                        pay_group_rate_id = :pay_group_rate_id,
                        updated_at = :updated_at
                    WHERE employee_id = :employee_id
                    """
                ),
                {
                    "employee_id": caregiver_id,
                    "pay_group_id": pay_group_id,
                    "pay_group_rate_id": pay_group_rate_id,
                    "updated_at": now_local,
                },
            )
        else:
            db.execute(
                text(
                    """
                    INSERT INTO care.employee_payroll_settings (employee_id, pay_group_id, pay_group_rate_id)
                    VALUES (:employee_id, :pay_group_id, :pay_group_rate_id)
                    """
                ),
                {
                    "employee_id": caregiver_id,
                    "pay_group_id": pay_group_id,
                    "pay_group_rate_id": pay_group_rate_id,
                },
            )

        sync_timesheet_payroll_for_employee(caregiver_id, db)
        db.commit()

        return CaregiverPayrollSettingsUpdateResponse(
            success=True,
            caregiver_id=caregiver_id,
            message="Caregiver payroll settings saved.",
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Payroll update failed: {exc}") from exc
