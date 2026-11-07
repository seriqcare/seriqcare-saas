"""
Audit log helper — writes to audit.audit_log.

Usage
-----
Entity change (INSERT / UPDATE / DELETE):
    write_audit(db, table_name="clients", record_id=42, action="UPDATE",
                field_name="status", old_value="Active", new_value="Inactive",
                changed_by=user.id, changed_by_name=user.display_name,
                agency_id=user.agency_id, client_type="web", ip_address=ip)

Activity event (LOGIN / LOGOUT / FAILED_LOGIN / CLOCK_IN / CLOCK_OUT / PASSWORD_RESET):
    write_audit(db, table_name="auth", record_id=user.id, action="LOGIN",
                changed_by=user.id, changed_by_name=user.display_name,
                agency_id=user.agency_id, client_type="web", ip_address=ip,
                detail="device_name")

By default write_audit() does NOT commit so the caller's transaction is
not affected.  Pass commit=True when you need an immediate commit (e.g.
after FAILED_LOGIN before raising HTTPException, or after the main commit
has already been issued).

The entire call is wrapped in try/except — an audit failure never breaks
the main request flow; it only emits a WARNING log.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("seriqcare.audit")


def write_audit(
    db: Session,
    *,
    table_name: str,
    action: str,
    agency_id: Optional[int] = None,
    record_id: Optional[int] = None,
    field_name: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    changed_by: Optional[int] = None,
    changed_by_name: Optional[str] = None,
    client_type: Optional[str] = None,
    ip_address: Optional[str] = None,
    detail: Optional[str] = None,
    session_id: Optional[str] = None,
    commit: bool = False,
) -> None:
    try:
        db.execute(
            text("""
                INSERT INTO audit.audit_log
                    (agency_id, table_name, record_id, action, field_name,
                     old_value, new_value, changed_by, changed_by_name,
                     client_type, ip_address, detail, session_id)
                VALUES
                    (:agency_id, :table_name, :record_id, :action, :field_name,
                     :old_value, :new_value, :changed_by, :changed_by_name,
                     :client_type, :ip_address, :detail, :session_id)
            """),
            {
                "agency_id":       agency_id,
                "table_name":      table_name,
                "record_id":       record_id,
                "action":          action,
                "field_name":      field_name,
                "old_value":       old_value,
                "new_value":       new_value,
                "changed_by":      changed_by,
                "changed_by_name": changed_by_name,
                "client_type":     client_type,
                "ip_address":      ip_address,
                "detail":          detail,
                "session_id":      session_id,
            },
        )
        if commit:
            db.commit()
    except Exception as exc:
        log.warning("audit_log write failed [%s/%s]: %s", table_name, action, exc)
