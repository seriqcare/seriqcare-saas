"""
EVV Validation service.

validate_and_gate(visit_id, db)
    — checks completeness of visit_evv data,
      updates evv_status, then applies the state gate to move the appropriate
      aggregator column in visit_integration_status to 'Ready'.

State gate rule (design doc):
    Only evv_status IN ('Verified', 'Adjusted', 'Exempt')
    can move sandata_status / hhax_status to 'Ready'.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session


def validate_and_gate(visit_id: int, db: Session) -> str:
    """
    Validate EVV completeness for a visit and update statuses.

    Returns the new evv_status: 'Verified' | 'Failed' | 'Exempt'.
    Also updates visit_integration_status if the gate passes.
    Does NOT commit — caller is responsible for committing.
    """
    row = db.execute(
        text("""
            SELECT
                ev.call_in_datetime,
                ev.call_out_datetime,
                ev.call_in_latitude,
                ev.call_in_longitude,
                ev.call_out_latitude,
                ev.call_out_longitude,
                ev.evv_status,
                sc.is_evv_required
            FROM care.visits v
            JOIN  care.visit_evv     ev ON ev.visit_id = v.id
            JOIN  care.service_codes sc ON sc.id = v.service_code_id
            WHERE v.id = :vid AND v.visit_cancelled = 0
        """),
        {"vid": visit_id},
    ).fetchone()

    if row is None:
        return "Failed"

    now = datetime.now(timezone.utc)

    # Determine new evv_status
    if not row.is_evv_required:
        new_evv_status = "Exempt"
    elif (
        row.call_in_datetime  is not None
        and row.call_out_datetime is not None
        and row.call_in_latitude  is not None
        and row.call_out_latitude is not None
    ):
        new_evv_status = "Verified"
    else:
        new_evv_status = "Failed"

    # Only overwrite if not already manually set to Adjusted/Exempt
    if row.evv_status not in ("Adjusted", "Exempt"):
        db.execute(
            text("""
                UPDATE care.visit_evv
                SET    evv_status = :status, updated_at = :now
                WHERE  visit_id = :vid
            """),
            {"status": new_evv_status, "now": now, "vid": visit_id},
        )

    effective_status = row.evv_status if row.evv_status in ("Adjusted", "Exempt") else new_evv_status

    # State gate: set the right aggregator column to 'Ready'
    if effective_status in ("Verified", "Adjusted", "Exempt"):
        from backend.services.aggregator_router import get_aggregator_for_visit
        aggregator = get_aggregator_for_visit(visit_id, db)
        _set_integration_ready(visit_id, aggregator, now, db)

    return effective_status


def _set_integration_ready(
    visit_id: int, aggregator: str, now: datetime, db: Session
) -> None:
    """Advance the appropriate aggregator column to 'Ready' (only from Draft or NULL)."""
    if aggregator == "sandata":
        db.execute(
            text("""
                UPDATE care.visit_integration_status
                SET    sandata_status = 'Ready', sandata_last_at = :now, updated_at = :now
                WHERE  visit_id = :vid
                  AND  (sandata_status IS NULL OR sandata_status = 'Draft')
            """),
            {"now": now, "vid": visit_id},
        )
    elif aggregator == "hhax":
        db.execute(
            text("""
                UPDATE care.visit_integration_status
                SET    hhax_status = 'Ready', hhax_last_at = :now, updated_at = :now
                WHERE  visit_id = :vid
                  AND  (hhax_status IS NULL OR hhax_status = 'Draft')
            """),
            {"now": now, "vid": visit_id},
        )
