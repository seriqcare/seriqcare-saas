"""
GET /api/clients
Returns a paginated list of clients with stats.
"""
from __future__ import annotations

import json
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

_log = logging.getLogger("seriqcare.clients")

from backend.auth.dependencies import get_agency_scope, AgencyScope, get_current_user
from db.models import User
from db.database import get_db
from backend.schemas import (
    ClientAuthItem,
    ClientCareTask,
    ClientCareTaskCompletionRequest,
    ClientCareTaskCompletionResponse,
    ClientCareTasksResponse,
    ClientCareTasksUpdateRequest,
    ClientCreateRequest,
    ClientCreateResponse,
    ClientDetail,
    ClientPayerItem,
    ClientStats,
    ClientSummary,
    ClientsResponse,
    ClientUpdateRequest,
    ClientUpdateResponse,
    ClientVisitItem,
)
from backend.services import sandata as _sandata_svc
from backend.services.timezone import (
    SQLSERVER_EASTERN_NOW_EXPR,
    SQLSERVER_LOCAL_DATE_EXPR,
    SQLSERVER_LOCAL_WEEK_START_DATE_EXPR,
    now_eastern_naive,
)

router = APIRouter()


def _client_care_tasks_table_exists(db: Session) -> bool:
    row = db.execute(
        text("SELECT OBJECT_ID('care.client_care_tasks', 'U') AS obj_id")
    ).fetchone()
    return row is not None and row.obj_id is not None


def _client_care_task_history_table_exists(db: Session) -> bool:
    row = db.execute(
        text("SELECT OBJECT_ID('care.client_care_tasks_history', 'U') AS obj_id")
    ).fetchone()
    return row is not None and row.obj_id is not None


def get_client_agency_scope(
    scope: AgencyScope = Depends(get_agency_scope),
    current_user: User = Depends(get_current_user),
) -> AgencyScope:
    if current_user.role != "super_admin" and current_user.agency_id is None:
        raise HTTPException(status_code=403, detail="Agency membership required.")
    return scope


def _ensure_client_exists(client_id: int, db: Session, scope: AgencyScope) -> None:
    row = db.execute(
        text(f"SELECT c.id FROM care.clients c WHERE c.id = :client_id AND c.is_active = 1 AND {scope.sql_filter('c')}"),
        scope.bind({"client_id": client_id}),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Client not found.")


def _ensure_completion_access(client_id: int, db: Session, user: User) -> None:
    if user.role in ("coordinator", "agency_admin", "super_admin"):
        if user.role != "super_admin" and user.agency_id is None:
            raise HTTPException(status_code=403, detail="Agency membership required.")
        _ensure_client_exists(client_id, db, AgencyScope(user))
        return
    if user.role != "caregiver" or user.agency_id is None or user.employee_id is None:
        raise HTTPException(status_code=403, detail="Access denied.")
    row = db.execute(
        text("""
            SELECT c.id
            FROM care.clients c
            JOIN care.schedules s ON s.client_id = c.id AND s.agency_id = c.agency_id
            WHERE c.id = :client_id AND c.is_active = 1
              AND c.agency_id = :agency_id AND s.employee_id = :employee_id
              AND s.status <> 'Cancelled'
        """),
        {"client_id": client_id, "agency_id": user.agency_id, "employee_id": user.employee_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Client not found.")


def _read_client_care_tasks(
    client_id: int,
    db: Session,
    task_date: date | None = None,
) -> ClientCareTasksResponse:
    target_date = task_date or date.today()

    if not _client_care_tasks_table_exists(db):
        return ClientCareTasksResponse(
            client_id=client_id,
            date=target_date.isoformat(),
            items=[],
        )

    if _client_care_task_history_table_exists(db):
        rows = db.execute(
            text(
                """
                SELECT
                    t.id,
                    t.title,
                    t.description,
                    t.specific_time,
                    t.recurrence_text,
                    t.sort_order,
                    h.completed_on,
                    h.completed_at,
                    h.completion_notes,
                    COALESCE(u.display_name, u.username) AS completed_by
                FROM care.client_care_tasks t
                LEFT JOIN care.client_care_tasks_history h
                    ON h.client_care_task_id = t.id
                   AND h.completed_on = :completed_on
                LEFT JOIN care.users u ON u.id = h.completed_by_user_id
                WHERE t.client_id = :client_id AND t.is_active = 1
                ORDER BY t.sort_order, t.id
                """
            ),
            {"client_id": client_id, "completed_on": target_date.isoformat()},
        ).fetchall()
    else:
        rows = db.execute(
            text(
                """
                SELECT
                    id,
                    title,
                    description,
                    specific_time,
                    recurrence_text,
                    sort_order,
                    NULL AS completed_on,
                    NULL AS completed_at,
                    NULL AS completion_notes,
                    NULL AS completed_by
                FROM care.client_care_tasks
                WHERE client_id = :client_id AND is_active = 1
                ORDER BY sort_order, id
                """
            ),
            {"client_id": client_id},
        ).fetchall()

    return ClientCareTasksResponse(
        client_id=client_id,
        date=target_date.isoformat(),
        items=[
            ClientCareTask(
                id=int(row.id),
                title=str(row.title),
                description=row.description,
                specific_time=row.specific_time,
                recurrence_text=row.recurrence_text,
                sort_order=int(row.sort_order or 0),
                completed_today=getattr(row, "completed_on", None) is not None,
                completed_on=(
                    row.completed_on.isoformat()
                    if getattr(row, "completed_on", None) is not None
                    else None
                ),
                completed_at=(
                    row.completed_at.isoformat(sep=" ", timespec="seconds")
                    if getattr(row, "completed_at", None) is not None
                    else None
                ),
                completed_by=getattr(row, "completed_by", None),
                completion_notes=getattr(row, "completion_notes", None),
            )
            for row in rows
        ],
    )


@router.post("", response_model=ClientCreateResponse, status_code=201)
def create_client(
    body: ClientCreateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Create a new client record in the DB and submit to the Sandata EVV simulator.
    """
    try:
        # Normalize medicaid_id and derive client_code
        medicaid_digits = "".join(c for c in (body.medicaid_id or "") if c.isdigit())
        if not medicaid_digits:
            raise HTTPException(status_code=422, detail="medicaid_id must contain digits.")

        client_code = f"CL-{medicaid_digits[:10].zfill(10)}"

        # Check for duplicate medicaid_id
        dup = db.execute(
            text("SELECT id FROM care.clients WHERE medicaid_id = :mid"),
            {"mid": body.medicaid_id},
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail=f"Medicaid ID '{body.medicaid_id}' already exists.")

        # Check for duplicate client_code
        dup_code = db.execute(
            text("SELECT id FROM care.clients WHERE client_code = :code"),
            {"code": client_code},
        ).fetchone()
        if dup_code:
            # Append a short suffix to make it unique
            client_code = f"CL-{medicaid_digits[:8].zfill(8)}-{medicaid_digits[-2:] if len(medicaid_digits) >= 2 else '00'}"

        # Insert into care.clients
        now_local = now_eastern_naive()
        client_row = db.execute(
            text("""
                INSERT INTO care.clients
                    (agency_id, client_code, medicaid_id, first_name, last_name,
                     date_of_birth, gender, ssn_last4, phone, email, status,
                     is_active, created_at)
                OUTPUT INSERTED.id
                VALUES
                    (:agency_id, :client_code, :medicaid_id, :first_name, :last_name,
                     :date_of_birth, :gender, :ssn_last4, :phone, :email, :status,
                     1, :created_at)
            """),
            {
                "agency_id":    scope.agency_id,
                "client_code":  client_code,
                "medicaid_id":  body.medicaid_id.strip(),
                "first_name":   body.first_name.strip(),
                "last_name":    body.last_name.strip(),
                "date_of_birth": body.date_of_birth,
                "gender":       body.gender or None,
                "ssn_last4":    (body.ssn_last4 or "")[:4] or None,
                "phone":        body.phone or None,
                "email":        body.email or None,
                "status":       body.status or "Active",
                "created_at":   now_local,
            },
        ).fetchone()
        client_id = int(client_row.id)

        # Insert primary address
        db.execute(
            text("""
                INSERT INTO care.client_addresses
                    (client_id, address_type, address1, city, state, zip, is_primary, is_active)
                VALUES
                    (:client_id, 'Home', :address1, :city, :state, :zip, 1, 1)
            """),
            {
                "client_id": client_id,
                "address1":  body.street_address or "",
                "city":      body.city or "",
                "state":     body.state or "PA",
                "zip":       body.zip_code or "",
            },
        )

        # ── EVV registration (skipped for Core tier agencies) ───────────────
        if scope.agency_tier == 'core':
            db.commit()
            return ClientCreateResponse(
                success=True,
                id=client_id,
                client_code=client_code,
                message="Client created successfully.",
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
                    "Client not saved — Sandata ProviderID is not configured. "
                    "Set provider_id_sandata on your active provider row in care.providers, then try again."
                ),
            )

        class _Row:
            pass

        r = _Row()
        r.client_code  = client_code
        r.first_name   = body.first_name.strip()
        r.middle_name  = body.middle_name or ""
        r.last_name    = body.last_name.strip()
        r.medicaid_id  = body.medicaid_id.strip()
        r.phone        = body.phone
        r.address1     = body.street_address or ""
        r.city         = body.city or ""
        r.state        = body.state or "PA"
        r.zip          = body.zip_code or ""
        r.hcpcs_code   = body.procedure_code or ""
        r.provider_id  = provider_id

        payload      = _sandata_svc.build_client_evv_payload(r, now_utc)
        payload_json = json.dumps(payload)
        _log.info("Sandata simulator → POST /api/evv/clients  client_id=%s medicaid_id=%s",
                  client_id, body.medicaid_id)

        try:
            sim_status, sim_code, sim_msg = _sandata_svc.post_to_simulator(
                "/api/evv/clients", payload_json, entity_id=str(client_id)
            )
        except Exception as sim_exc:
            db.rollback()
            _log.error("Sandata simulator unreachable for client_id=%s: %s", client_id, sim_exc)
            raise HTTPException(
                status_code=422,
                detail=f"Client not saved — could not reach Sandata: {sim_exc}",
            ) from sim_exc

        if sim_status != "Success":
            db.rollback()
            _log.warning(
                "Sandata simulator FAILED ← client_id=%s  medicaid_id=%s  status=%s  errors=%s",
                client_id, body.medicaid_id, sim_status, sim_msg,
            )
            raise HTTPException(
                status_code=422,
                detail=f"Client not saved — Sandata registration failed: {sim_msg}",
            )

        _log.info("Sandata simulator ← client_id=%s  status=%s  msg=%s",
                  client_id, sim_status, sim_msg)

        # Sandata succeeded — commit everything
        db.commit()

        return ClientCreateResponse(
            success=True,
            id=client_id,
            client_code=client_code,
            message="Client created and registered with Sandata successfully.",
            sandata_status=sim_status,
            sandata_message=sim_msg,
        )

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Create failed: {exc}") from exc


@router.get("/{client_id}", response_model=ClientDetail)
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    """Return full detail for a single client."""
    try:
        row = db.execute(
            text("""
                SELECT
                    c.id,
                    c.client_code,
                    c.first_name,
                    c.last_name,
                    c.medicaid_id,
                    CONVERT(VARCHAR, c.date_of_birth, 23) AS date_of_birth,
                    c.gender,
                    c.ssn_last4,
                    c.phone,
                    c.email,
                    c.status,
                    c.primary_language,
                    c.secondary_language,
                    c.race_ethnicity,
                    c.marital_status,
                    c.communication_needs,
                    c.emergency_contact_name,
                    c.emergency_contact_phone,
                    c.emergency_contact_relationship,
                    c.legal_guardian,
                    c.guardian_phone,
                    c.power_of_attorney,
                    c.representative_payee,
                    c.care_coordinator,
                    c.physician,
                    c.level_of_care,
                    CONVERT(VARCHAR, c.care_plan_review_date, 23) AS care_plan_review_date,
                    c.care_plan_notes,
                    ca.address1   AS street_address,
                    ca.city,
                    ca.state,
                    ca.zip        AS zip_code,
                    ca.county
                FROM care.clients c
                LEFT JOIN care.client_addresses ca
                    ON ca.client_id = c.id AND ca.is_primary = 1
                WHERE c.id = :client_id AND c.is_active = 1
            """),
            {"client_id": client_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Client not found.")

        scope.assert_access(
            db.execute(
                text("SELECT agency_id FROM care.clients WHERE id = :cid"),
                {"cid": client_id},
            ).fetchone().agency_id
        )

        return ClientDetail(
            id=int(row.id),
            client_code=str(row.client_code),
            first_name=str(row.first_name),
            last_name=str(row.last_name),
            medicaid_id=row.medicaid_id,
            date_of_birth=row.date_of_birth,
            gender=row.gender,
            ssn_last4=row.ssn_last4,
            phone=row.phone,
            email=row.email,
            status=str(row.status),
            primary_language=row.primary_language,
            secondary_language=row.secondary_language,
            race_ethnicity=row.race_ethnicity,
            marital_status=row.marital_status,
            communication_needs=row.communication_needs,
            emergency_contact_name=row.emergency_contact_name,
            emergency_contact_phone=row.emergency_contact_phone,
            emergency_contact_relationship=row.emergency_contact_relationship,
            legal_guardian=row.legal_guardian,
            guardian_phone=row.guardian_phone,
            power_of_attorney=row.power_of_attorney,
            representative_payee=row.representative_payee,
            care_coordinator=row.care_coordinator,
            physician=row.physician,
            level_of_care=row.level_of_care,
            care_plan_review_date=row.care_plan_review_date,
            care_plan_notes=row.care_plan_notes,
            street_address=row.street_address,
            city=row.city,
            state=row.state,
            zip_code=row.zip_code,
            county=row.county,
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("/{client_id}/insurance", response_model=list[ClientPayerItem])
def get_client_insurance(
    client_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    """Return payer/insurance records for a client."""
    try:
        _ensure_client_exists(client_id, db, scope)
        rows = db.execute(
            text("""
                SELECT
                    p.id,
                    p.payer_id,
                    p.program,
                    w.waiver_code,
                    w.waiver_name,
                    CONVERT(VARCHAR, p.effective_date, 23) AS effective_date,
                    CONVERT(VARCHAR, p.end_date,       23) AS end_date,
                    p.is_active
                FROM care.client_payer_info p
                LEFT JOIN care.waivers w ON w.id = p.waiver_id
                WHERE p.client_id = :client_id AND p.is_active = 1
                ORDER BY p.effective_date DESC
            """),
            {"client_id": client_id},
        ).fetchall()

        return [
            ClientPayerItem(
                id=int(r.id),
                payer_id=str(r.payer_id),
                program=str(r.program),
                waiver_code=r.waiver_code,
                waiver_name=r.waiver_name,
                effective_date=r.effective_date,
                end_date=r.end_date,
                is_active=bool(r.is_active),
            )
            for r in rows
        ]

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("/{client_id}/authorizations", response_model=list[ClientAuthItem])
def get_client_authorizations(
    client_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    """Return service authorizations for a client."""
    try:
        _ensure_client_exists(client_id, db, scope)
        rows = db.execute(
            text("""
                SELECT
                    sa.id,
                    sc.hcpcs_code                                               AS service_code,
                    sc.description                                              AS service_description,
                    sa.auth_number,
                    CAST(sa.authorized_units AS FLOAT)                          AS authorized_units,
                    CAST(sa.used_units       AS FLOAT)                          AS used_units,
                    CAST(sa.authorized_units - sa.used_units AS FLOAT)          AS remaining_units,
                    CAST(
                        CASE WHEN sa.authorized_units > 0
                             THEN sa.used_units * 100.0 / sa.authorized_units
                             ELSE 0 END
                    AS FLOAT)                                                   AS utilization_pct,
                    CONVERT(VARCHAR, sa.service_start_date, 23)                 AS service_start_date,
                    CONVERT(VARCHAR, sa.service_end_date,   23)                 AS service_end_date,
                    sa.is_active
                FROM care.service_authorizations sa
                JOIN care.service_codes sc ON sc.id = sa.service_code_id
                WHERE sa.client_id = :client_id
                ORDER BY sa.is_active DESC, sa.service_end_date DESC
            """),
            {"client_id": client_id},
        ).fetchall()

        return [
            ClientAuthItem(
                id=int(r.id),
                service_code=str(r.service_code),
                service_description=str(r.service_description),
                auth_number=r.auth_number,
                authorized_units=round(float(r.authorized_units or 0), 2),
                used_units=round(float(r.used_units or 0), 2),
                remaining_units=round(float(r.remaining_units or 0), 2),
                utilization_pct=round(float(r.utilization_pct or 0), 1),
                service_start_date=r.service_start_date,
                service_end_date=r.service_end_date,
                is_active=bool(r.is_active),
            )
            for r in rows
        ]

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("/{client_id}/visits", response_model=list[ClientVisitItem])
def get_client_visits(
    client_id: int,
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    """Return recent visits for a client."""
    try:
        _ensure_client_exists(client_id, db, scope)
        rows = db.execute(
            text("""
                SELECT TOP (:limit)
                    v.id,
                    CONVERT(VARCHAR, v.service_date, 23)                        AS service_date,
                    sc.hcpcs_code                                               AS service_code,
                    sc.description                                              AS service_description,
                    e.first_name + ' ' + e.last_name                           AS caregiver,
                    FORMAT(COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),  'hh:mm tt') AS clock_in,
                    FORMAT(COALESCE(ev.adj_out_datetime, ev.call_out_datetime), 'hh:mm tt') AS clock_out,
                    ISNULL(
                        CASE WHEN ev.call_out_datetime IS NOT NULL
                        THEN DATEDIFF(
                            MINUTE,
                            COALESCE(ev.adj_in_datetime,  ev.call_in_datetime),
                            COALESCE(ev.adj_out_datetime, ev.call_out_datetime)
                        ) / 60.0 END,
                    0)                                                          AS total_hours,
                    ev.evv_status,
                    vb.approval_status
                FROM care.visits v
                JOIN care.employees e            ON e.id  = v.employee_id
                JOIN care.service_codes sc        ON sc.id = v.service_code_id
                LEFT JOIN care.visit_evv    ev   ON ev.visit_id = v.id
                LEFT JOIN care.visit_billing vb  ON vb.visit_id = v.id
                WHERE v.client_id = :client_id AND v.visit_cancelled = 0
                ORDER BY v.service_date DESC, ev.call_in_datetime DESC
            """),
            {"client_id": client_id, "limit": limit},
        ).fetchall()

        return [
            ClientVisitItem(
                id=int(r.id),
                service_date=str(r.service_date),
                service_code=r.service_code,
                service_description=r.service_description,
                caregiver=r.caregiver,
                clock_in=r.clock_in,
                clock_out=r.clock_out,
                total_hours=round(float(r.total_hours or 0), 2),
                evv_status=r.evv_status,
                approval_status=r.approval_status,
            )
            for r in rows
        ]

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("", response_model=ClientsResponse)
def get_clients(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str = Query("All"),
    search: str = Query(""),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        offset = (page - 1) * per_page

        # ------------------------------------------------------------------
        # Build dynamic WHERE clauses
        # ------------------------------------------------------------------
        where_parts: list[str] = ["c.is_active = 1", scope.sql_filter("c")]
        params: dict = scope.bind({"offset": offset, "per_page": per_page})

        if status and status.lower() not in ("all", ""):
            where_parts.append("c.status = :status")
            params["status"] = status

        if search and search.strip():
            where_parts.append(
                "(c.first_name LIKE :search OR c.last_name LIKE :search "
                "OR c.client_code LIKE :search OR c.medicaid_id LIKE :search)"
            )
            params["search"] = f"%{search.strip()}%"

        where_sql = "WHERE " + " AND ".join(where_parts)
        stats_client_where = where_sql.replace("c.", "sc_client.")

        # ------------------------------------------------------------------
        # Stats query
        # ------------------------------------------------------------------
        stats_row = db.execute(
            text(
                f"""
                SELECT
                    COUNT(*)  AS total_clients,
                    COUNT(CASE WHEN CAST(c.created_at AS DATE) >=
                          DATEFROMPARTS(YEAR({SQLSERVER_LOCAL_DATE_EXPR}), MONTH({SQLSERVER_LOCAL_DATE_EXPR}), 1)
                          THEN 1 END) AS new_this_month,
                    COUNT(CASE WHEN c.care_plan_review_date IS NOT NULL
                          AND TRY_CAST(c.care_plan_review_date AS DATE) >= {SQLSERVER_LOCAL_DATE_EXPR}
                          THEN 1 END) AS active_care_plans,
                    COUNT(CASE WHEN c.care_plan_review_date IS NOT NULL
                          AND DATEDIFF(DAY, {SQLSERVER_LOCAL_DATE_EXPR},
                              TRY_CAST(c.care_plan_review_date AS DATE)) BETWEEN 0 AND 30
                          THEN 1 END) AS due_for_review,
                    (SELECT COUNT(DISTINCT s.employee_id)
                     FROM care.schedules s
                     JOIN care.employees e ON e.id = s.employee_id AND e.agency_id = s.agency_id
                     WHERE s.employee_id IS NOT NULL
                       AND {scope.sql_filter('s')}
                       AND EXISTS (SELECT 1 FROM care.clients sc_client {stats_client_where}
                                   AND sc_client.id = s.client_id AND sc_client.agency_id = s.agency_id)
                       AND s.scheduled_start >= {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR}
                       AND s.scheduled_start < DATEADD(DAY, 7, {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR})
                    ) AS assigned_caregivers,
                    (SELECT COUNT(*) FROM (
                        SELECT s.client_id
                        FROM care.schedules s
                        JOIN care.employees e ON e.id = s.employee_id AND e.agency_id = s.agency_id
                        WHERE s.employee_id IS NOT NULL
                          AND {scope.sql_filter('s')}
                          AND EXISTS (SELECT 1 FROM care.clients sc_client {stats_client_where}
                                      AND sc_client.id = s.client_id AND sc_client.agency_id = s.agency_id)
                          AND s.scheduled_start >= {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR}
                          AND s.scheduled_start < DATEADD(DAY, 7, {SQLSERVER_LOCAL_WEEK_START_DATE_EXPR})
                        GROUP BY s.client_id
                        HAVING COUNT(DISTINCT s.employee_id) > 1
                    ) multi) AS multi_staff_cases,
                    COUNT(CASE WHEN c.care_plan_review_date IS NULL
                          OR TRY_CAST(c.care_plan_review_date AS DATE) < {SQLSERVER_LOCAL_DATE_EXPR}
                          THEN 1 END) AS doc_flags,
                    (SELECT COUNT(DISTINCT v.client_id)
                     FROM care.visits v
                     JOIN care.visit_evv ev ON ev.visit_id = v.id
                     WHERE ev.evv_status IN ('Pending','Failed') AND v.visit_cancelled = 0
                       AND {scope.sql_filter('v')}
                       AND EXISTS (SELECT 1 FROM care.clients sc_client {stats_client_where}
                                   AND sc_client.id = v.client_id AND sc_client.agency_id = v.agency_id)
                    ) AS urgent_followup
                FROM care.clients c
                {where_sql}
                """
            ),
            params,
        ).fetchone()

        stats = ClientStats(
            total_clients=int(stats_row.total_clients or 0),
            new_this_month=int(stats_row.new_this_month or 0),
            active_care_plans=int(stats_row.active_care_plans or 0),
            due_for_review=int(stats_row.due_for_review or 0),
            assigned_caregivers=int(stats_row.assigned_caregivers or 0),
            multi_staff_cases=int(stats_row.multi_staff_cases or 0),
            doc_flags=int(stats_row.doc_flags or 0),
            urgent_followup=int(stats_row.urgent_followup or 0),
        )

        total_clients = stats.total_clients

        # ------------------------------------------------------------------
        # Main client list query
        # ------------------------------------------------------------------
        client_rows = db.execute(
            text(
                f"""
                SELECT
                    c.id,
                    c.client_code,
                    c.first_name + ' ' + c.last_name AS name,
                    DATEDIFF(YEAR,
                        TRY_CAST(c.date_of_birth AS DATE),
                        {SQLSERVER_LOCAL_DATE_EXPR}) AS age,
                    ca.city,
                    ca.state,
                    c.status,
                    -- service type from most recent active authorization
                    (SELECT TOP 1 sc.description
                     FROM care.service_authorizations sa
                     JOIN care.service_codes sc ON sa.service_code_id = sc.id
                     WHERE sa.client_id = c.id AND sa.agency_id = c.agency_id AND sa.is_active = 1
                     ORDER BY sa.created_at DESC
                    ) AS service_type,
                    -- primary caregiver from most recent schedule
                    (SELECT TOP 1 e.first_name + ' ' + e.last_name
                     FROM care.schedules s
                     JOIN care.employees e ON s.employee_id = e.id AND e.agency_id = s.agency_id
                     WHERE s.client_id = c.id AND s.agency_id = c.agency_id AND s.employee_id IS NOT NULL
                     ORDER BY s.scheduled_start DESC
                    ) AS primary_caregiver,
                    -- next upcoming visit
                    (SELECT TOP 1 CONVERT(VARCHAR, s.scheduled_start, 120)
                     FROM care.schedules s
                     WHERE s.client_id = c.id AND s.agency_id = c.agency_id
                       AND s.scheduled_start >= {SQLSERVER_EASTERN_NOW_EXPR}
                       AND s.status NOT IN ('Cancelled', 'Completed')
                     ORDER BY s.scheduled_start ASC
                    ) AS next_visit,
                    -- care plan status
                    CASE
                        WHEN c.care_plan_review_date IS NULL THEN 'No Plan'
                        WHEN TRY_CAST(c.care_plan_review_date AS DATE) < {SQLSERVER_LOCAL_DATE_EXPR}
                            THEN 'Overdue'
                        WHEN DATEDIFF(DAY,
                            {SQLSERVER_LOCAL_DATE_EXPR},
                            TRY_CAST(c.care_plan_review_date AS DATE)) <= 30
                            THEN 'Review in '
                                + CAST(DATEDIFF(DAY,
                                    {SQLSERVER_LOCAL_DATE_EXPR},
                                    TRY_CAST(c.care_plan_review_date AS DATE)) AS VARCHAR)
                                + ' days'
                        ELSE 'Up to date'
                    END AS care_plan_status
                FROM care.clients c
                LEFT JOIN care.client_addresses ca
                    ON ca.client_id = c.id AND ca.is_primary = 1
                {where_sql}
                ORDER BY c.last_name, c.first_name
                OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
                """
            ),
            params,
        ).fetchall()

        items = [
            ClientSummary(
                id=int(r.id),
                client_code=str(r.client_code),
                name=str(r.name),
                age=int(r.age) if r.age is not None else None,
                city=r.city,
                state=r.state,
                status=str(r.status),
                service_type=r.service_type,
                primary_caregiver=r.primary_caregiver,
                next_visit=r.next_visit,
                care_plan_status=str(r.care_plan_status),
            )
            for r in client_rows
        ]

        return ClientsResponse(
            total=total_clients,
            page=page,
            per_page=per_page,
            stats=stats,
            items=items,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.get("/{client_id}/care-tasks", response_model=ClientCareTasksResponse)
def get_client_care_tasks(
    client_id: int,
    for_date: str = Query(
        default="",
        alias="date",
        description="Optional completion date in YYYY-MM-DD. Defaults to today.",
    ),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    try:
        _ensure_client_exists(client_id, db, scope)
        target_date = date.fromisoformat(for_date) if for_date else None
        return _read_client_care_tasks(client_id, db, target_date)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid care task date.") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


@router.patch("/{client_id}/care-tasks", response_model=ClientCareTasksResponse)
def update_client_care_tasks(
    client_id: int,
    body: ClientCareTasksUpdateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    try:
        _ensure_client_exists(client_id, db, scope)
        now_local = now_eastern_naive()
        if not _client_care_tasks_table_exists(db):
            raise HTTPException(
                status_code=409,
                detail="care.client_care_tasks table is missing. Run the SQL migration first.",
            )

        existing_rows = db.execute(
            text(
                "SELECT id FROM care.client_care_tasks WHERE client_id = :client_id"
            ),
            {"client_id": client_id},
        ).fetchall()
        existing_ids = {int(row.id) for row in existing_rows}
        keep_ids: set[int] = set()

        for index, item in enumerate(body.items, start=1):
            title = item.title.strip()
            if not title or not item.is_active:
                continue

            params = {
                "client_id": client_id,
                "title": title,
                "description": item.description.strip() if item.description else None,
                "specific_time": item.specific_time.strip() if item.specific_time else None,
                "recurrence_text": item.recurrence_text.strip() if item.recurrence_text else None,
                "sort_order": item.sort_order or index,
            }

            if item.id and item.id in existing_ids:
                db.execute(
                    text(
                        """
                        UPDATE care.client_care_tasks
                        SET title = :title,
                            description = :description,
                            specific_time = :specific_time,
                            recurrence_text = :recurrence_text,
                            sort_order = :sort_order,
                            is_active = 1,
                            updated_at = :now_local
                        WHERE id = :task_id AND client_id = :client_id
                        """
                    ),
                    {**params, "task_id": item.id, "now_local": now_local},
                )
                keep_ids.add(item.id)
            else:
                inserted = db.execute(
                    text(
                        """
                        INSERT INTO care.client_care_tasks
                            (client_id, title, description, specific_time, recurrence_text, sort_order, is_active, created_at, updated_at)
                        OUTPUT INSERTED.id
                        VALUES
                            (:client_id, :title, :description, :specific_time, :recurrence_text, :sort_order, 1, :now_local, :now_local)
                        """
                    ),
                    {**params, "now_local": now_local},
                ).fetchone()
                if inserted:
                    keep_ids.add(int(inserted[0]))

        stale_ids = existing_ids - keep_ids
        if stale_ids:
            placeholders = ", ".join(f":stale_{index}" for index, _ in enumerate(stale_ids))
            stale_params = {f"stale_{index}": task_id for index, task_id in enumerate(stale_ids)}
            db.execute(
                text(
                    f"""
                    UPDATE care.client_care_tasks
                    SET is_active = 0, updated_at = :now_local
                    WHERE client_id = :client_id AND id IN ({placeholders})
                    """
                ),
                {"client_id": client_id, "now_local": now_local, **stale_params},
            )

        db.commit()
        return _read_client_care_tasks(client_id, db)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}") from exc


@router.put(
    "/{client_id}/care-tasks/{task_id}/completion",
    response_model=ClientCareTaskCompletionResponse,
)
def set_client_care_task_completion(
    client_id: int,
    task_id: int,
    body: ClientCareTaskCompletionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        _ensure_completion_access(client_id, db, current_user)
        now_local = now_eastern_naive()
        if not _client_care_tasks_table_exists(db) or not _client_care_task_history_table_exists(db):
            raise HTTPException(
                status_code=409,
                detail="Care task history tables are missing. Run the SQL migration first.",
            )

        task_row = db.execute(
            text(
                """
                SELECT id
                FROM care.client_care_tasks
                WHERE id = :task_id AND client_id = :client_id AND is_active = 1
                """
            ),
            {"task_id": task_id, "client_id": client_id},
        ).fetchone()
        if not task_row:
            raise HTTPException(status_code=404, detail="Care task not found.")

        completed_on = date.fromisoformat(body.completed_on) if body.completed_on else date.today()
        existing = db.execute(
            text(
                """
                SELECT id
                FROM care.client_care_tasks_history
                WHERE client_care_task_id = :task_id AND completed_on = :completed_on
                """
            ),
            {"task_id": task_id, "completed_on": completed_on.isoformat()},
        ).fetchone()

        if body.completed:
            params = {
                "history_id": int(existing.id) if existing else None,
                "task_id": task_id,
                "client_id": client_id,
                "completed_on": completed_on.isoformat(),
                "completed_by_user_id": current_user.id,
                "completion_notes": body.completion_notes.strip() if body.completion_notes else None,
            }
            if existing:
                db.execute(
                    text(
                        """
                        UPDATE care.client_care_tasks_history
                        SET completed_at = :now_local,
                            completed_by_user_id = :completed_by_user_id,
                            completion_notes = :completion_notes
                        WHERE id = :history_id
                        """
                    ),
                    {**params, "now_local": now_local},
                )
            else:
                db.execute(
                    text(
                        """
                        INSERT INTO care.client_care_tasks_history
                            (client_care_task_id, client_id, completed_on, completed_at, completed_by_user_id, completion_notes, created_at)
                        VALUES
                            (:task_id, :client_id, :completed_on, :now_local, :completed_by_user_id, :completion_notes, :now_local)
                        """
                    ),
                    {**params, "now_local": now_local},
                )

            row = db.execute(
                text(
                    """
                    SELECT TOP 1 completed_at, completion_notes
                    FROM care.client_care_tasks_history
                    WHERE client_care_task_id = :task_id AND completed_on = :completed_on
                    ORDER BY id DESC
                    """
                ),
                {"task_id": task_id, "completed_on": completed_on.isoformat()},
            ).fetchone()
            db.commit()
            return ClientCareTaskCompletionResponse(
                client_id=client_id,
                task_id=task_id,
                completed=True,
                completed_on=completed_on.isoformat(),
                completed_at=(
                    row.completed_at.isoformat(sep=" ", timespec="seconds")
                    if row and row.completed_at is not None
                    else None
                ),
                completed_by=current_user.display_name or current_user.username,
                completion_notes=row.completion_notes if row else None,
            )

        if existing:
            db.execute(
                text(
                    """
                    DELETE FROM care.client_care_tasks_history
                    WHERE id = :history_id
                    """
                ),
                {"history_id": int(existing.id)},
            )
            db.commit()

        return ClientCareTaskCompletionResponse(
            client_id=client_id,
            task_id=task_id,
            completed=False,
            completed_on=completed_on.isoformat(),
            completed_at=None,
            completed_by=None,
            completion_notes=None,
        )
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid completion date.") from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}") from exc


@router.put("/{client_id}", response_model=ClientUpdateResponse)
def update_client(
    client_id: int,
    payload: ClientUpdateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_client_agency_scope),
):
    from backend.schemas import ClientUpdateResponse
    try:
        _ensure_client_exists(client_id, db, scope)
        now_local = now_eastern_naive()
        # Build dynamic SET clause from non-None fields
        set_parts: list[str] = []
        params: dict = {"client_id": client_id}

        field_map = {
            "first_name": "first_name",
            "last_name": "last_name",
            "date_of_birth": "date_of_birth",
            "gender": "gender",
            "primary_language": "primary_language",
            "phone": "phone",
            "email": "email",
            "status": "status",
            "medicaid_id": "medicaid_id",
            "race_ethnicity": "race_ethnicity",
            "marital_status": "marital_status",
            "secondary_language": "secondary_language",
            "communication_needs": "communication_needs",
            "emergency_contact_name": "emergency_contact_name",
            "emergency_contact_phone": "emergency_contact_phone",
            "emergency_contact_relationship": "emergency_contact_relationship",
            "legal_guardian": "legal_guardian",
            "guardian_phone": "guardian_phone",
            "power_of_attorney": "power_of_attorney",
            "representative_payee": "representative_payee",
            "care_coordinator": "care_coordinator",
            "physician": "physician",
            "level_of_care": "level_of_care",
            "care_plan_review_date": "care_plan_review_date",
            "care_plan_notes": "care_plan_notes",
        }

        for field, col in field_map.items():
            val = getattr(payload, field)
            if val is not None:
                set_parts.append(f"{col} = :{field}")
                params[field] = val

        if set_parts:
            db.execute(
                text(
                    f"UPDATE care.clients SET {', '.join(set_parts)}, updated_at = :now_local "
                    "WHERE id = :client_id AND is_active = 1"
                ),
                {**params, "now_local": now_local},
            )

        # Update address if address fields provided
        addr_map = {
            "street_address": "address1",
            "city": "city",
            "state": "state",
            "zip_code": "zip",
            "county": "county",
        }
        addr_parts: list[str] = []
        addr_params: dict = {"client_id": client_id}
        for field, col in addr_map.items():
            val = getattr(payload, field)
            if val is not None:
                addr_parts.append(f"{col} = :{field}")
                addr_params[field] = val

        if addr_parts:
            # Update existing primary address or insert
            existing = db.execute(
                text("SELECT id FROM care.client_addresses WHERE client_id = :client_id AND is_primary = 1"),
                {"client_id": client_id},
            ).fetchone()
            if existing:
                db.execute(
                    text(f"UPDATE care.client_addresses SET {', '.join(addr_parts)} WHERE client_id = :client_id AND is_primary = 1"),
                    addr_params,
                )
            else:
                cols = ", ".join(["client_id"] + list(addr_map[f] for f in addr_map if getattr(payload, f) is not None))
                vals = ", ".join([":client_id"] + [f":{f}" for f in addr_map if getattr(payload, f) is not None])
                db.execute(
                    text(f"INSERT INTO care.client_addresses (client_id, {cols}, is_primary) VALUES (:client_id, {vals}, 1)"),
                    addr_params,
                )

        # Guardian/emergency fields go to client record extended fields if columns exist
        db.commit()
        return ClientUpdateResponse(success=True, id=client_id, message="Client updated successfully")

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update failed: {exc}") from exc
