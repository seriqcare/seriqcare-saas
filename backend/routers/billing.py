"""
Billing router — Phase 1 + 2 + 3 + status management + bulk generation

GET  /api/billing                        → Paginated billing entry list (BillingResponse)
GET  /api/billing/stats                  → KPI totals for the current period (BillingStats)
POST /api/billing/generate               → Create care.billing_claims from approved visits
GET  /api/billing/auth-utilization       → Per-client auth used/remaining/expiring (Phase 2)
GET  /api/billing/claims                 → Paginated list of generated claims (Phase 3)
GET  /api/billing/claims/{claim_id}      → Claim detail with line items (Phase 3)
GET  /api/billing/claims/{claim_id}/export → Single-claim CSV or 837P stub (Phase 3)
GET  /api/billing/export                 → Bulk billing-entries CSV for a period (Phase 3)
"""
from __future__ import annotations

import calendar
import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.database import get_db
from backend.auth.dependencies import get_agency_scope, AgencyScope
from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR
from backend.schemas import (
    AuthUtilizationItem,
    BillingClaimCreate,
    BillingClaimDetail,
    BillingClaimLineItem,
    BillingClaimListItem,
    BillingClaimListResponse,
    BillingClaimResponse,
    BillingEntry,
    BillingResponse,
    BillingStats,
    BulkGenerateRequest,
    BulkGenerateResponse,
    ClaimGroup,
    ClaimGroupPreview,
    ClaimStatusUpdate,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _period_bounds(period: str) -> tuple[date, date]:
    """Return (start, end) inclusive date bounds for a named period."""
    today = date.today()
    y, m = today.year, today.month

    if period == "last_month":
        last_day_prev = today.replace(day=1) - timedelta(days=1)
        return last_day_prev.replace(day=1), last_day_prev

    if period == "last3m":
        # 3 full calendar months back to end of current month
        sm = m - 2
        sy = y
        if sm <= 0:
            sy -= 1
            sm += 12
        last_day = calendar.monthrange(y, m)[1]
        return date(sy, sm, 1), date(y, m, last_day)

    # Default: this_month
    last_day = calendar.monthrange(y, m)[1]
    return today.replace(day=1), date(y, m, last_day)


# Common JOIN used by all billing queries
# OUTER APPLY TOP 1 on billing_claim_visits prevents row fan-out when a visit
# belongs to more than one claim (many-to-many).  We always surface the most
# recent claim for display purposes.
_BASE_JOIN = """
    FROM care.visits v
    JOIN  care.employees    e   ON e.id  = v.employee_id
    JOIN  care.clients      c   ON c.id  = v.client_id
    JOIN  care.service_codes sc ON sc.id = v.service_code_id
    LEFT JOIN care.visit_evv                ev  ON ev.visit_id  = v.id
    LEFT JOIN care.visit_billing            vb  ON vb.visit_id  = v.id
    LEFT JOIN care.visit_integration_status vi  ON vi.visit_id  = v.id
    OUTER APPLY (
        SELECT TOP 1 claim_id
        FROM   care.billing_claim_visits
        WHERE  visit_id = v.id
        ORDER  BY id DESC
    ) bcv
    LEFT JOIN care.billing_claims bcl ON bcl.id = bcv.claim_id
"""

# Derived billing_status column expression
_BILLING_STATUS = """
    CASE
        WHEN bcl.id IS NOT NULL AND bcl.status = 'Submitted' THEN 'Submitted'
        WHEN bcl.id IS NOT NULL AND bcl.status = 'Paid'      THEN 'Paid'
        WHEN bcl.id IS NOT NULL AND bcl.status = 'Denied'    THEN 'Denied'
        WHEN bcl.id IS NOT NULL AND bcl.status = 'Voided'    THEN 'Voided'
        WHEN bcl.id IS NOT NULL                               THEN bcl.status
        WHEN vb.approval_status = 'Approved'
         AND ev.evv_status IN ('Verified', 'Adjusted')        THEN 'Ready'
        WHEN vb.approval_status = 'Approved'                  THEN 'Approved'
        WHEN vb.approval_status = 'Denied'                    THEN 'Denied'
        ELSE 'Pending'
    END
"""


def _status_where(status: str) -> str | None:
    """Translate a tab name to a SQL WHERE fragment for billing_status."""
    mapping = {
        "Ready":     ("vb.approval_status = 'Approved' "
                      "AND ev.evv_status IN ('Verified', 'Adjusted') "
                      "AND bcl.id IS NULL"),
        "Submitted": "bcl.id IS NOT NULL AND bcl.status = 'Submitted'",
        "Paid":      "bcl.id IS NOT NULL AND bcl.status = 'Paid'",
        "Denied":    "bcl.id IS NOT NULL AND bcl.status = 'Denied'",
    }
    return mapping.get(status)


def _base_where(
    period_start: date, period_end: date, scope: "AgencyScope | None" = None
) -> tuple[str, dict]:
    """Return the always-on WHERE fragment and its params."""
    parts = [
        "v.visit_cancelled = 0",
        "v.service_date >= :period_start",
        "v.service_date <= :period_end",
    ]
    params: dict = {
        "period_start": period_start.isoformat(),
        "period_end":   period_end.isoformat(),
    }
    if scope is not None:
        parts.append(scope.sql_filter("v"))
        scope.bind(params)
    return " AND ".join(parts), params


def _stats_from_row(row) -> BillingStats:
    return BillingStats(
        total_visits=int(row.total_visits or 0),
        total_units=round(float(row.total_units or 0), 2),
        total_estimated_amount=round(float(row.total_estimated_amount or 0), 2),
        ready_to_bill=int(row.ready_to_bill or 0),
        pending_claims=int(row.pending_claims or 0),
        approved=int(row.approved or 0),
        denied=int(row.denied or 0),
    )


_STATS_SELECT = f"""
    SELECT
        COUNT(*)                                                         AS total_visits,
        ISNULL(SUM(COALESCE(vb.approved_units, vb.billed_units, 0)), 0) AS total_units,
        ISNULL(SUM(
            COALESCE(vb.approved_units, vb.billed_units, 0) *
            ISNULL(sc.default_rate, 0)
        ), 0)                                                            AS total_estimated_amount,
        COUNT(CASE
            WHEN vb.approval_status = 'Approved'
             AND ev.evv_status IN ('Verified', 'Adjusted')
             AND bcl.id IS NULL THEN 1 END)                              AS ready_to_bill,
        COUNT(CASE
            WHEN bcl.id IS NOT NULL
             AND bcl.status IN ('Draft','Ready','Submitted') THEN 1 END) AS pending_claims,
        COUNT(CASE
            WHEN bcl.id IS NOT NULL
             AND bcl.status = 'Paid' THEN 1 END)                         AS approved,
        COUNT(CASE
            WHEN bcl.id IS NOT NULL
             AND bcl.status = 'Denied' THEN 1 END)                       AS denied
"""


# ---------------------------------------------------------------------------
# GET /api/billing
# ---------------------------------------------------------------------------

@router.get("", response_model=BillingResponse)
def get_billing(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    period: str = Query(default="this_month"),
    status: str = Query(default=""),
    search: str = Query(default=""),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        period_start, period_end = _period_bounds(period)
        offset = (page - 1) * per_page

        where_sql, params = _base_where(period_start, period_end, scope)
        params["offset"]   = offset
        params["per_page"] = per_page

        extra_parts: list[str] = []

        if status and status.lower() not in ("all", ""):
            sw = _status_where(status)
            if sw:
                extra_parts.append(sw)

        if search and search.strip():
            extra_parts.append(
                "(CAST(v.id AS VARCHAR(20)) LIKE :search "
                "OR c.first_name + ' ' + c.last_name LIKE :search "
                "OR e.first_name + ' ' + e.last_name LIKE :search)"
            )
            params["search"] = f"%{search.strip()}%"

        if extra_parts:
            where_sql = where_sql + " AND " + " AND ".join(extra_parts)

        # -- Total count --
        count_row = db.execute(
            text(f"SELECT COUNT(*) AS total {_BASE_JOIN} WHERE {where_sql}"),
            params,
        ).fetchone()
        total = int(count_row.total or 0)

        # -- Stats (always full period, no status/search filter) --
        stats_where, stats_params = _base_where(period_start, period_end, scope)
        stats_row = db.execute(
            text(f"{_STATS_SELECT} {_BASE_JOIN} WHERE {stats_where}"),
            stats_params,
        ).fetchone()
        stats = _stats_from_row(stats_row)

        # -- Items --
        rows = db.execute(
            text(f"""
                SELECT
                    v.id                                                   AS visit_id,
                    CONVERT(VARCHAR, v.service_date, 23)                   AS service_date,
                    c.first_name + ' ' + c.last_name                       AS client_name,
                    e.first_name + ' ' + e.last_name                       AS employee_name,
                    sc.hcpcs_code                                          AS service_code,
                    CAST(vb.billed_units   AS FLOAT)                       AS billed_units,
                    CAST(vb.approved_units AS FLOAT)                       AS approved_units,
                    ev.evv_status,
                    vb.approval_status,
                    vi.sandata_status,
                    vi.hhax_status,
                    CAST(sc.default_rate AS FLOAT)                         AS default_rate,
                    CAST(
                        COALESCE(vb.approved_units, vb.billed_units, 0) *
                        ISNULL(sc.default_rate, 0)
                    AS FLOAT)                                              AS estimated_amount,
                    bcv.claim_id,
                    {_BILLING_STATUS}                                      AS billing_status
                {_BASE_JOIN}
                WHERE {where_sql}
                ORDER BY v.service_date DESC, v.id DESC
                OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
            """),
            params,
        ).fetchall()

        items = [
            BillingEntry(
                visit_id=r.visit_id,
                service_date=r.service_date,
                client_name=r.client_name,
                employee_name=r.employee_name,
                service_code=r.service_code,
                billed_units=r.billed_units,
                approved_units=r.approved_units,
                evv_status=r.evv_status,
                approval_status=r.approval_status,
                sandata_status=r.sandata_status,
                hhax_status=r.hhax_status,
                default_rate=r.default_rate,
                estimated_amount=r.estimated_amount,
                claim_id=r.claim_id,
                billing_status=r.billing_status or "Pending",
            )
            for r in rows
        ]

        return BillingResponse(
            total=total, page=page, per_page=per_page, stats=stats, items=items
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# GET /api/billing/stats
# ---------------------------------------------------------------------------

@router.get("/stats", response_model=BillingStats)
def get_billing_stats(
    period: str = Query(default="this_month"),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        period_start, period_end = _period_bounds(period)
        where_sql, params = _base_where(period_start, period_end, scope)
        row = db.execute(
            text(f"{_STATS_SELECT} {_BASE_JOIN} WHERE {where_sql}"),
            params,
        ).fetchone()
        return _stats_from_row(row)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# POST /api/billing/generate
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=BillingClaimResponse)
def generate_claim(
    body: BillingClaimCreate,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    if not body.visit_ids:
        raise HTTPException(status_code=400, detail="visit_ids must not be empty")
    if body.payer not in ("sandata", "hhax", "private"):
        raise HTTPException(status_code=400, detail="payer must be sandata, hhax, or private")

    try:
        # Validate IDs are integers (prevent injection)
        visit_id_list = [int(vid) for vid in body.visit_ids]
        placeholders = ",".join(str(v) for v in visit_id_list)

        visit_rows = db.execute(
            text(f"""
                SELECT
                    v.id, v.agency_id,
                    CAST(
                        COALESCE(vb.approved_units, vb.billed_units, 0)
                    AS FLOAT) AS units,
                    CAST(
                        COALESCE(vb.approved_units, vb.billed_units, 0) *
                        ISNULL(sc.default_rate, 0)
                    AS FLOAT) AS amount
                FROM care.visits v
                JOIN care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
                JOIN care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
                JOIN  care.service_codes sc ON sc.id = v.service_code_id
                LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
                WHERE v.id IN ({placeholders})
                  AND v.visit_cancelled = 0
                  AND {scope.sql_filter("v")}
            """),
            scope.bind({}),
        ).fetchall()

        if not visit_rows or {int(r.id) for r in visit_rows} != set(visit_id_list):
            raise HTTPException(status_code=404, detail="No eligible visits found for provided IDs")

        agency_ids = {r.agency_id for r in visit_rows}
        if len(agency_ids) != 1 or None in agency_ids:
            raise HTTPException(status_code=400, detail="All visits must belong to one agency")
        agency_id    = next(iter(agency_ids))
        total_units  = round(sum(float(r.units  or 0) for r in visit_rows), 2)
        total_amount = round(sum(float(r.amount or 0) for r in visit_rows), 2)

        # Insert claim header
        claim_row = db.execute(
            text(f"""
                INSERT INTO care.billing_claims
                    (agency_id, claim_date, payer, status, total_units, total_amount)
                OUTPUT INSERTED.id
                VALUES
                    (:agency_id, CAST({SQLSERVER_EASTERN_NOW_EXPR} AS DATE), :payer, 'Draft',
                     :total_units, :total_amount)
            """),
            {
                "agency_id":    agency_id,
                "payer":        body.payer,
                "total_units":  total_units,
                "total_amount": total_amount,
            },
        ).fetchone()
        claim_id = int(claim_row.id)

        # Insert line items
        for r in visit_rows:
            db.execute(
                text("""
                    INSERT INTO care.billing_claim_visits (claim_id, visit_id, units, amount)
                    VALUES (:claim_id, :visit_id, :units, :amount)
                """),
                {
                    "claim_id": claim_id,
                    "visit_id": int(r.id),
                    "units":    float(r.units  or 0),
                    "amount":   float(r.amount or 0),
                },
            )

        db.commit()

        return BillingClaimResponse(
            id=claim_id,
            claim_date=date.today().isoformat(),
            payer=body.payer,
            status="Draft",
            total_units=total_units,
            total_amount=total_amount,
            visit_count=len(visit_rows),
        )

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# GET /api/billing/auth-utilization  (Phase 2)
# ---------------------------------------------------------------------------

@router.get("/auth-utilization", response_model=list[AuthUtilizationItem])
def get_auth_utilization(
    limit: int = Query(10, ge=1, le=100),
    expiring_days: int = Query(default=0),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Return per-authorization utilization rows, ordered by utilization % descending.

    expiring_days (optional): if > 0, filter to auths expiring within that many days.
    """
    try:
        params: dict = scope.bind({"limit": limit})
        extra_where = f"AND {scope.sql_filter('sa')}"

        if expiring_days > 0:
            extra_where += " AND DATEDIFF(day, GETDATE(), sa.service_end_date) BETWEEN 0 AND :expiring_days"
            params["expiring_days"] = expiring_days

        rows = db.execute(
            text(f"""
                SELECT TOP (:limit)
                    sa.id                                                   AS auth_id,
                    c.id                                                    AS client_id,
                    c.first_name + ' ' + c.last_name                       AS client_name,
                    sc.hcpcs_code                                           AS service_code,
                    sa.auth_number,
                    CAST(sa.authorized_units AS FLOAT)                      AS authorized_units,
                    CAST(sa.used_units       AS FLOAT)                      AS used_units,
                    CAST(sa.authorized_units - sa.used_units AS FLOAT)      AS remaining_units,
                    CAST(
                        CASE WHEN sa.authorized_units > 0
                             THEN sa.used_units * 100.0 / sa.authorized_units
                             ELSE 0 END
                    AS FLOAT)                                               AS utilization_pct,
                    CONVERT(VARCHAR, sa.service_start_date, 23)             AS service_start_date,
                    CONVERT(VARCHAR, sa.service_end_date,   23)             AS service_end_date,
                    DATEDIFF(day, GETDATE(), sa.service_end_date)           AS days_until_expiry,
                    sa.is_active
                FROM care.service_authorizations sa
                JOIN care.clients      c  ON c.id  = sa.client_id
                JOIN care.service_codes sc ON sc.id = sa.service_code_id
                WHERE sa.is_active = 1
                  {extra_where}
                ORDER BY
                    CASE WHEN sa.authorized_units > 0
                         THEN sa.used_units * 100.0 / sa.authorized_units
                         ELSE 0 END DESC
            """),
            params,
        ).fetchall()

        return [
            AuthUtilizationItem(
                auth_id=r.auth_id,
                client_id=r.client_id,
                client_name=r.client_name,
                service_code=r.service_code,
                auth_number=r.auth_number,
                authorized_units=round(float(r.authorized_units or 0), 2),
                used_units=round(float(r.used_units or 0), 2),
                remaining_units=round(float(r.remaining_units or 0), 2),
                utilization_pct=round(float(r.utilization_pct or 0), 1),
                service_start_date=r.service_start_date,
                service_end_date=r.service_end_date,
                days_until_expiry=int(r.days_until_expiry or 0),
                is_active=bool(r.is_active),
            )
            for r in rows
        ]

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# GET /api/billing/claims  (Phase 3)
# ---------------------------------------------------------------------------

@router.get("/claims", response_model=BillingClaimListResponse)
def list_claims(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str = Query(default=""),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """Paginated list of generated billing claim headers."""
    try:
        offset = (page - 1) * per_page
        where_parts = [scope.sql_filter("bcl")]
        params: dict = scope.bind({"offset": offset, "per_page": per_page})

        if status and status.lower() not in ("all", ""):
            where_parts.append("bcl.status = :status")
            params["status"] = status

        where_sql = " AND ".join(where_parts)

        count_row = db.execute(
            text(f"SELECT COUNT(*) AS total FROM care.billing_claims bcl WHERE {where_sql}"),
            params,
        ).fetchone()
        total = int(count_row.total or 0)

        rows = db.execute(
            text(f"""
                SELECT
                    bcl.id,
                    CONVERT(VARCHAR, bcl.claim_date, 23)        AS claim_date,
                    bcl.payer,
                    bcl.status,
                    CAST(bcl.total_units  AS FLOAT)             AS total_units,
                    CAST(bcl.total_amount AS FLOAT)             AS total_amount,
                    COUNT(bcv.id)                               AS visit_count,
                    CONVERT(VARCHAR, bcl.created_at, 23)        AS created_at
                FROM care.billing_claims bcl
                LEFT JOIN care.billing_claim_visits bcv ON bcv.claim_id = bcl.id
                WHERE {where_sql}
                GROUP BY bcl.id, bcl.claim_date, bcl.payer, bcl.status,
                         bcl.total_units, bcl.total_amount, bcl.created_at
                ORDER BY bcl.claim_date DESC, bcl.id DESC
                OFFSET :offset ROWS FETCH NEXT :per_page ROWS ONLY
            """),
            params,
        ).fetchall()

        items = [
            BillingClaimListItem(
                id=r.id,
                claim_date=r.claim_date,
                payer=r.payer,
                status=r.status,
                total_units=round(float(r.total_units or 0), 2),
                total_amount=round(float(r.total_amount or 0), 2),
                visit_count=int(r.visit_count or 0),
                created_at=r.created_at,
            )
            for r in rows
        ]

        return BillingClaimListResponse(total=total, page=page, per_page=per_page, items=items)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# GET /api/billing/claims/{claim_id}  (Phase 3)
# ---------------------------------------------------------------------------

@router.get("/claims/{claim_id}", response_model=BillingClaimDetail)
def get_claim_detail(
    claim_id: int,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """Claim header + all line-item visits."""
    try:
        header = db.execute(
            text(f"""
                SELECT
                    id,
                    CONVERT(VARCHAR, claim_date, 23)   AS claim_date,
                    payer,
                    status,
                    CAST(total_units  AS FLOAT)        AS total_units,
                    CAST(total_amount AS FLOAT)        AS total_amount,
                    CONVERT(VARCHAR, created_at, 120)  AS created_at
                FROM care.billing_claims
                WHERE id = :claim_id
                  AND {scope.sql_filter()}
            """),
            scope.bind({"claim_id": claim_id}),
        ).fetchone()

        if not header:
            raise HTTPException(status_code=404, detail="Claim not found")

        lines = db.execute(
            text("""
                SELECT
                    bcv.id                                                     AS line_id,
                    bcv.visit_id,
                    CONVERT(VARCHAR, v.service_date, 23)                       AS service_date,
                    c.first_name + ' ' + c.last_name                           AS client_name,
                    e.first_name + ' ' + e.last_name                           AS employee_name,
                    sc.hcpcs_code                                               AS service_code,
                    CAST(bcv.units  AS FLOAT)                                   AS units,
                    CAST(bcv.amount AS FLOAT)                                   AS amount
                FROM care.billing_claim_visits bcv
                JOIN  care.billing_claims bcl ON bcl.id = bcv.claim_id
                JOIN  care.visits        v   ON v.id = bcv.visit_id AND v.agency_id = bcl.agency_id
                JOIN  care.clients       c   ON c.id  = v.client_id AND c.agency_id = v.agency_id
                JOIN  care.employees     e   ON e.id  = v.employee_id AND e.agency_id = v.agency_id
                JOIN  care.service_codes sc  ON sc.id = v.service_code_id
                WHERE bcv.claim_id = :claim_id
                ORDER BY v.service_date, bcv.id
            """),
            {"claim_id": claim_id},
        ).fetchall()

        return BillingClaimDetail(
            id=header.id,
            claim_date=header.claim_date,
            payer=header.payer,
            status=header.status,
            total_units=round(float(header.total_units or 0), 2),
            total_amount=round(float(header.total_amount or 0), 2),
            created_at=header.created_at,
            line_items=[
                BillingClaimLineItem(
                    line_id=r.line_id,
                    visit_id=r.visit_id,
                    service_date=r.service_date,
                    client_name=r.client_name,
                    employee_name=r.employee_name,
                    service_code=r.service_code,
                    units=round(float(r.units or 0), 2),
                    amount=round(float(r.amount or 0), 2),
                )
                for r in lines
            ],
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# GET /api/billing/claims/{claim_id}/export  (Phase 3)
# ---------------------------------------------------------------------------

@router.get("/claims/{claim_id}/export")
def export_claim(
    claim_id: int,
    format: str = Query(default="csv"),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """Download a single claim as CSV or a 837P stub text file."""
    detail = get_claim_detail(claim_id, db, scope)

    if format == "837p":
        stub_lines = [
            f"ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       "
            f"*{detail.claim_date.replace('-','')}*0000*^*00501*000000001*0*P*:",
            "GS*HC*SENDER*RECEIVER*20260101*0000*1*X*005010X222A1",
            "ST*837*0001*005010X222A1",
            f"BPR*I*{detail.total_amount:.2f}*C*ACH",
            f"CLM*{detail.id}*{detail.total_amount:.2f}",
            "SE*5*0001",
            "GE*1*1",
            "IEA*1*000000001",
            "",
            "-- NOTE: This is a stub 837P file for testing only.",
            "-- Full EDI generation requires clearinghouse integration (Phase 4).",
        ]
        content = "\n".join(stub_lines)
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(
            content=content,
            headers={"Content-Disposition": f"attachment; filename=claim_{claim_id}.837"},
        )

    # Default: CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Claim ID", "Claim Date", "Payer", "Status",
        "Visit ID", "Service Date", "Client", "Caregiver", "Service Code",
        "Units", "Est. Amount ($)",
    ])
    for li in detail.line_items:
        writer.writerow([
            detail.id, detail.claim_date, detail.payer, detail.status,
            li.visit_id, li.service_date, li.client_name, li.employee_name,
            li.service_code or "",
            f"{li.units:.2f}", f"{li.amount:.2f}",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=claim_{claim_id}.csv"},
    )


# ---------------------------------------------------------------------------
# GET /api/billing/export  (Phase 3) — bulk billing-entries CSV for a period
# ---------------------------------------------------------------------------

@router.get("/export")
def export_billing_entries(
    period: str = Query(default="this_month"),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """Download all billing entries for a period as CSV."""
    try:
        period_start, period_end = _period_bounds(period)
        where_sql, params = _base_where(period_start, period_end, scope)

        rows = db.execute(
            text(f"""
                SELECT
                    v.id                                                        AS visit_id,
                    CONVERT(VARCHAR, v.service_date, 23)                        AS service_date,
                    c.first_name + ' ' + c.last_name                            AS client_name,
                    e.first_name + ' ' + e.last_name                            AS employee_name,
                    sc.hcpcs_code                                                AS service_code,
                    CAST(vb.billed_units   AS FLOAT)                             AS billed_units,
                    CAST(vb.approved_units AS FLOAT)                             AS approved_units,
                    ev.evv_status,
                    vb.approval_status,
                    vi.sandata_status,
                    vi.hhax_status,
                    CAST(sc.default_rate AS FLOAT)                               AS default_rate,
                    CAST(
                        COALESCE(vb.approved_units, vb.billed_units, 0) *
                        ISNULL(sc.default_rate, 0)
                    AS FLOAT)                                                    AS estimated_amount,
                    bcv.claim_id,
                    {_BILLING_STATUS}                                            AS billing_status
                {_BASE_JOIN}
                WHERE {where_sql}
                ORDER BY v.service_date DESC, v.id DESC
            """),
            params,
        ).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Visit ID", "Service Date", "Client", "Caregiver", "Service Code",
            "Billed Units", "Approved Units", "Est. Amount ($)",
            "EVV Status", "Approval Status", "Sandata Status", "HHAeXchange Status",
            "Rate ($/unit)", "Billing Status", "Claim ID",
        ])
        for r in rows:
            writer.writerow([
                r.visit_id,
                r.service_date,
                r.client_name,
                r.employee_name,
                r.service_code or "",
                f"{r.billed_units:.2f}" if r.billed_units is not None else "",
                f"{r.approved_units:.2f}" if r.approved_units is not None else "",
                f"{r.estimated_amount:.2f}" if r.estimated_amount is not None else "",
                r.evv_status or "",
                r.approval_status or "",
                r.sandata_status or "",
                r.hhax_status or "",
                f"{r.default_rate:.2f}" if r.default_rate is not None else "",
                r.billing_status or "Pending",
                r.claim_id or "",
            ])
        output.seek(0)

        filename = f"billing_{period}_{period_start.isoformat()}_{period_end.isoformat()}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ===========================================================================
# Grouping + bulk generation + status management
# ===========================================================================

# Valid claim status transitions
_VALID_TRANSITIONS: dict[str, set[str]] = {
    "Draft":     {"Ready", "Voided"},
    "Ready":     {"Submitted", "Voided"},
    "Submitted": {"Paid", "Denied", "Voided"},
}

_GROUPING_QUERY = """
    SELECT
        v.id                                                        AS visit_id,
        v.agency_id,
        v.client_id,
        c.first_name + ' ' + c.last_name                           AS client_name,
        CASE
            WHEN vi.sandata_status IS NOT NULL THEN 'sandata'
            WHEN vi.hhax_status    IS NOT NULL THEN 'hhax'
            ELSE                                    'private'
        END                                                         AS payer,
        v.service_authorization_id,
        -- Monday of visit week (@@DATEFIRST-agnostic)
        CONVERT(VARCHAR,
            DATEADD(day,
                -((DATEPART(dw, v.service_date) + @@DATEFIRST - 2) % 7),
                v.service_date
            ), 23)                                                  AS week_start,
        CAST(COALESCE(vb.approved_units, vb.billed_units, 0) AS FLOAT)  AS units,
        CAST(
            COALESCE(vb.approved_units, vb.billed_units, 0) *
            ISNULL(sc.default_rate, 0)
        AS FLOAT)                                                   AS amount
    FROM care.visits v
    JOIN  care.clients       c   ON c.id = v.client_id AND c.agency_id = v.agency_id
    JOIN  care.employees     e   ON e.id = v.employee_id AND e.agency_id = v.agency_id
    JOIN  care.service_codes sc  ON sc.id = v.service_code_id
    LEFT JOIN care.visit_evv                ev  ON ev.visit_id  = v.id
    LEFT JOIN care.visit_billing            vb  ON vb.visit_id  = v.id
    LEFT JOIN care.visit_integration_status vi  ON vi.visit_id  = v.id
    LEFT JOIN care.billing_claim_visits     bcv ON bcv.visit_id = v.id
    WHERE v.visit_cancelled = 0
      AND vb.approval_status = 'Approved'
      AND ev.evv_status IN ('Verified', 'Adjusted')
      AND COALESCE(vb.approved_units, vb.billed_units, 0) > 0
      AND bcv.visit_id IS NULL
      AND v.service_date >= :period_start
      AND v.service_date <= :period_end
      AND {agency_filter}
    ORDER BY v.client_id, week_start
"""


def _build_groups(db: Session, period_start: date, period_end: date, scope: AgencyScope) -> list[dict]:
    """
    Find all eligible, unclaimed visits in the period and group by
    (client_id, payer, service_authorization_id, billing_week).
    Returns a list of group dicts including per-visit detail for claim insertion.
    """
    rows = db.execute(
        text(_GROUPING_QUERY.format(agency_filter=scope.sql_filter("v"))),
        scope.bind({"period_start": period_start.isoformat(), "period_end": period_end.isoformat()}),
    ).fetchall()

    bucket: dict[tuple, dict] = {}
    for r in rows:
        key = (r.agency_id, r.client_id, r.payer, r.service_authorization_id, r.week_start)
        if key not in bucket:
            bucket[key] = {
                "agency_id":               r.agency_id,
                "client_id":               r.client_id,
                "client_name":             r.client_name,
                "payer":                   r.payer,
                "service_authorization_id": r.service_authorization_id,
                "week_start":              r.week_start,
                "visits":                  [],
                "total_units":             0.0,
                "total_amount":            0.0,
            }
        bucket[key]["visits"].append({
            "visit_id": int(r.visit_id),
            "units":    float(r.units  or 0),
            "amount":   float(r.amount or 0),
        })
        bucket[key]["total_units"]  += float(r.units  or 0)
        bucket[key]["total_amount"] += float(r.amount or 0)

    return list(bucket.values())


# ---------------------------------------------------------------------------
# GET /api/billing/group-visits  — preview grouping (no DB writes)
# ---------------------------------------------------------------------------

@router.get("/group-visits", response_model=ClaimGroupPreview)
def preview_claim_groups(
    period: str = Query(default="this_month"),
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """Return how Ready visits will be grouped into claims, without creating anything."""
    try:
        period_start, period_end = _period_bounds(period)
        raw = _build_groups(db, period_start, period_end, scope)

        groups = []
        for g in raw:
            week_end = (date.fromisoformat(g["week_start"]) + timedelta(days=6)).isoformat()
            groups.append(ClaimGroup(
                client_id=g["client_id"],
                client_name=g["client_name"],
                payer=g["payer"],
                service_authorization_id=g["service_authorization_id"],
                period_start_date=g["week_start"],
                period_end_date=week_end,
                visit_ids=[v["visit_id"] for v in g["visits"]],
                visit_count=len(g["visits"]),
                total_units=round(g["total_units"], 2),
                total_amount=round(g["total_amount"], 2),
            ))

        return ClaimGroupPreview(
            groups=groups,
            total_groups=len(groups),
            total_visits=sum(len(g["visits"]) for g in raw),
            total_units=round(sum(g["total_units"] for g in raw), 2),
            total_amount=round(sum(g["total_amount"] for g in raw), 2),
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# POST /api/billing/generate-bulk  — group + create all claims for a period
# ---------------------------------------------------------------------------

@router.post("/generate-bulk", response_model=BulkGenerateResponse)
def generate_bulk_claims(
    body: BulkGenerateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Group all Ready-to-bill unclaimed visits for the period and create one
    care.billing_claims record per group (plus billing_claim_visits line items).
    Grouping key: (client_id, payer, service_authorization_id, billing_week).
    """
    try:
        period_start, period_end = _period_bounds(body.period)
        raw = _build_groups(db, period_start, period_end, scope)

        if not raw:
            raise HTTPException(status_code=404, detail="No Ready-to-bill visits found for this period")

        claim_ids: list[int] = []
        total_visits = 0
        total_units  = 0.0
        total_amount = 0.0

        for g in raw:
            claim_row = db.execute(
                text(f"""
                    INSERT INTO care.billing_claims
                        (agency_id, claim_date, payer, status, total_units, total_amount)
                    OUTPUT INSERTED.id
                    VALUES (:agency_id, CAST({SQLSERVER_EASTERN_NOW_EXPR} AS DATE), :payer, 'Draft',
                            :total_units, :total_amount)
                """),
                {
                    "agency_id":    g["agency_id"],
                    "payer":        g["payer"],
                    "total_units":  round(g["total_units"], 2),
                    "total_amount": round(g["total_amount"], 2),
                },
            ).fetchone()
            claim_id = int(claim_row.id)
            claim_ids.append(claim_id)

            for v in g["visits"]:
                db.execute(
                    text("""
                        INSERT INTO care.billing_claim_visits (claim_id, visit_id, units, amount)
                        VALUES (:claim_id, :visit_id, :units, :amount)
                    """),
                    {
                        "claim_id": claim_id,
                        "visit_id": v["visit_id"],
                        "units":    v["units"],
                        "amount":   v["amount"],
                    },
                )

            total_visits += len(g["visits"])
            total_units  += g["total_units"]
            total_amount += g["total_amount"]

        db.commit()

        return BulkGenerateResponse(
            claims_created=len(claim_ids),
            total_visits=total_visits,
            total_units=round(total_units, 2),
            total_amount=round(total_amount, 2),
            claim_ids=claim_ids,
        )

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# PATCH /api/billing/claims/{claim_id}/status  — claim status management
# ---------------------------------------------------------------------------

@router.patch("/claims/{claim_id}/status", response_model=BillingClaimListItem)
def update_claim_status(
    claim_id: int,
    body: ClaimStatusUpdate,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    """
    Advance a claim's status.  Valid transitions:
      Draft     → Ready | Voided
      Ready     → Submitted | Voided
      Submitted → Paid | Denied | Voided
    """
    try:
        row = db.execute(
            text(f"""
                SELECT
                    bcl.id, bcl.status,
                    CAST(bcl.total_units  AS FLOAT)       AS total_units,
                    CAST(bcl.total_amount AS FLOAT)       AS total_amount,
                    CONVERT(VARCHAR, bcl.claim_date, 23)  AS claim_date,
                    bcl.payer,
                    CONVERT(VARCHAR, bcl.created_at, 23)  AS created_at,
                    COUNT(bcv.id)                         AS visit_count
                FROM care.billing_claims bcl
                LEFT JOIN care.billing_claim_visits bcv ON bcv.claim_id = bcl.id
                WHERE bcl.id = :claim_id AND {scope.sql_filter("bcl")}
                GROUP BY bcl.id, bcl.status, bcl.total_units, bcl.total_amount,
                         bcl.claim_date, bcl.payer, bcl.created_at
            """),
            scope.bind({"claim_id": claim_id}),
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Claim not found")

        allowed = _VALID_TRANSITIONS.get(row.status, set())
        if body.status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition {row.status} → {body.status}. Allowed: {sorted(allowed) or 'none (final state)'}",
            )

        db.execute(
            text(f"""
                UPDATE care.billing_claims
                SET status = :status, updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                WHERE id = :claim_id
                  AND {scope.sql_filter()}
            """),
            scope.bind({"status": body.status, "claim_id": claim_id}),
        )
        db.commit()

        return BillingClaimListItem(
            id=row.id,
            claim_date=row.claim_date,
            payer=row.payer,
            status=body.status,
            total_units=round(float(row.total_units  or 0), 2),
            total_amount=round(float(row.total_amount or 0), 2),
            visit_count=int(row.visit_count or 0),
            created_at=row.created_at,
        )

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
