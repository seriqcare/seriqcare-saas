"""
Aggregator routing service.

Determines which external aggregator a visit should be submitted to based
on the service code's waiver:

    ODP waivers  → Sandata       (Office of Developmental Programs)
    All others   → HHAeXchange   (PDA / Medicaid / MA)

If a visit has no waiver attached to its service code, defaults to 'sandata'.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

# Waiver code prefixes that route to Sandata (case-insensitive)
_SANDATA_WAIVER_PREFIXES = ("ODP",)


def get_aggregator_for_visit(visit_id: int, db: Session) -> str:
    """
    Return 'sandata' or 'hhax' for the given visit_id.

    Looks up the waiver attached to the visit's service code.
    ODP waiver codes → Sandata; everything else → HHAeXchange.
    """
    try:
        row = db.execute(
            text("""
                SELECT w.waiver_code
                FROM   care.visits       v
                JOIN   care.service_codes sc ON sc.id = v.service_code_id
                LEFT JOIN care.waivers   w  ON w.id  = sc.waiver_id
                WHERE  v.id = :vid
            """),
            {"vid": visit_id},
        ).fetchone()
    except Exception:
        # Some deployed schemas do not include service_codes.waiver_id.
        # In that case use the documented default route.
        return "sandata"

    if row and row.waiver_code:
        waiver = row.waiver_code.upper()
        if any(waiver.startswith(p) for p in _SANDATA_WAIVER_PREFIXES):
            return "sandata"
        return "hhax"

    return "sandata"  # default when no waiver is attached


def get_aggregator_for_service_code(service_code_id: int, db: Session) -> str:
    """
    Return 'sandata' or 'hhax' for a given service_code_id.
    Convenience variant used when the visit_id is not yet available (e.g. pre-insert).
    """
    try:
        row = db.execute(
            text("""
                SELECT w.waiver_code
                FROM   care.service_codes sc
                LEFT JOIN care.waivers w ON w.id = sc.waiver_id
                WHERE  sc.id = :scid
            """),
            {"scid": service_code_id},
        ).fetchone()
    except Exception:
        return "sandata"

    if row and row.waiver_code:
        waiver = row.waiver_code.upper()
        if any(waiver.startswith(p) for p in _SANDATA_WAIVER_PREFIXES):
            return "sandata"
        return "hhax"

    return "sandata"
