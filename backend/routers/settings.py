"""
PUT /api/settings/agency  — persist agency settings.
GET /api/settings/agency  — retrieve current settings.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_agency_scope, AgencyScope
from backend.payroll_settings import ensure_default_pay_group, ensure_payroll_tables
from backend.services.timezone import SQLSERVER_EASTERN_NOW_EXPR
from backend.schemas import (
    AgencySettings,
    AgencySettingsResponse,
    PayrollGroup,
    PayrollPayPeriod,
    PayrollRateItem,
    PayrollSettingsResponse,
    PayrollSettingsUpdateRequest,
)
from db.database import get_db

router = APIRouter()

# Settings are persisted to a JSON file next to the backend package.
_SETTINGS_DIR  = Path(__file__).parent.parent.parent / "settings"
_AGENCY_FILE   = _SETTINGS_DIR / "agency.json"

_DEFAULT: dict = {
    "agencyName": "",
    "email": "",
    "phone": "",
    "address": "",
    "website": "",
    "timezone": "America/New_York",
    "currency": "usd",
    "defaultHourlyRate": "",
    "integration_mode": "SANDATA",
    "pay_period": {
        "frequency": "weekly",
        "week_starts_on": "monday",
        "anchor_date": None,
        "monthly_day": None,
        "semi_monthly_days": [1, 15],
    },
}

_PAY_PERIOD_FREQUENCIES = {"daily", "weekly", "biweekly", "semimonthly", "monthly"}
_WEEK_START_DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


def _default_settings() -> dict:
    return json.loads(json.dumps(_DEFAULT))


def _aggregator_to_mode(value: str | None) -> str:
    if (value or "").lower() == "hhax":
        return "HHAX"
    return "SANDATA"


def _mode_to_aggregator(value: str | None) -> str:
    if (value or "").upper() == "HHAX":
        return "hhax"
    return "sandata"


def _agency_file(agency_id: int | None) -> Path:
    if agency_id:
        return _SETTINGS_DIR / f"agency_{agency_id}.json"
    return _AGENCY_FILE


def _read_legacy_file(agency_id: int | None = None) -> dict:
    try:
        f = _agency_file(agency_id)
        if f.exists():
            return _merge_settings(json.loads(f.read_text(encoding="utf-8")))
        # Fall back to legacy shared file on first run
        if _AGENCY_FILE.exists():
            return _merge_settings(json.loads(_AGENCY_FILE.read_text(encoding="utf-8")))
    except Exception:
        pass
    return _default_settings()


def _write_legacy_file(data: dict, agency_id: int | None = None) -> None:
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _agency_file(agency_id).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _merge_settings(value: dict | None) -> dict:
    settings = _default_settings()
    raw = value if isinstance(value, dict) else {}

    for key, default_value in settings.items():
        if key == "pay_period":
            continue
        settings[key] = raw.get(key, default_value)

    settings["pay_period"] = _normalize_pay_period(raw.get("pay_period"))
    return settings


def _settings_table_exists(db: Session | None) -> bool:
    if db is None:
        return False
    row = db.execute(text("SELECT OBJECT_ID('care.agency_settings', 'U') AS obj_id")).fetchone()
    return row is not None and row.obj_id is not None


def _write_db_settings(data: dict, agency_id: int, db: Session) -> None:
    db.execute(
        text(
            f"""
            IF EXISTS (SELECT 1 FROM care.agency_settings WHERE agency_id = :agency_id)
            BEGIN
                UPDATE care.agency_settings
                SET settings_json = :settings_json,
                    updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                WHERE agency_id = :agency_id
            END
            ELSE
            BEGIN
                INSERT INTO care.agency_settings (agency_id, settings_json)
                VALUES (:agency_id, :settings_json)
            END
            """
        ),
        {
            "agency_id": agency_id,
            "settings_json": json.dumps(_merge_settings(data)),
        },
    )


def _read(agency_id: int | None = None, db: Session | None = None) -> dict:
    if agency_id is not None and _settings_table_exists(db):
        row = db.execute(
            text("SELECT settings_json FROM care.agency_settings WHERE agency_id = :agency_id"),
            {"agency_id": agency_id},
        ).fetchone()
        if row is not None and row.settings_json:
            try:
                return _merge_settings(json.loads(row.settings_json))
            except Exception:
                return _default_settings()

        legacy = _read_legacy_file(agency_id)
        _write_db_settings(legacy, agency_id, db)
        return legacy

    return _read_legacy_file(agency_id)


def _write(data: dict, agency_id: int | None = None, db: Session | None = None) -> None:
    normalized = _merge_settings(data)
    if agency_id is not None and _settings_table_exists(db):
        _write_db_settings(normalized, agency_id, db)
        return
    _write_legacy_file(normalized, agency_id)


def _normalize_pay_period(value: dict | None) -> dict:
    default_period = dict(_DEFAULT["pay_period"])
    raw = value if isinstance(value, dict) else {}

    frequency = str(raw.get("frequency") or default_period["frequency"]).strip().lower()
    if frequency not in _PAY_PERIOD_FREQUENCIES:
        frequency = str(default_period["frequency"])

    week_starts_on = raw.get("week_starts_on")
    if week_starts_on is not None:
        week_starts_on = str(week_starts_on).strip().lower() or None
    if week_starts_on not in _WEEK_START_DAYS:
        week_starts_on = default_period["week_starts_on"] if frequency in {"weekly", "biweekly"} else None

    anchor_date = raw.get("anchor_date")
    anchor_date = str(anchor_date).strip() if anchor_date else None

    monthly_day = raw.get("monthly_day")
    try:
        monthly_day = int(monthly_day) if monthly_day is not None else None
    except (TypeError, ValueError):
        monthly_day = None
    if monthly_day is not None and not 1 <= monthly_day <= 31:
        monthly_day = None

    semi_monthly_days: list[int] = []
    semi_monthly_days_raw = raw.get("semi_monthly_days")
    if isinstance(semi_monthly_days_raw, list):
        for item in semi_monthly_days_raw:
            try:
                day = int(item)
            except (TypeError, ValueError):
                continue
            if 1 <= day <= 31 and day not in semi_monthly_days:
                semi_monthly_days.append(day)
    semi_monthly_days.sort()
    if len(semi_monthly_days) < 2:
        semi_monthly_days = list(default_period["semi_monthly_days"])
    else:
        semi_monthly_days = semi_monthly_days[:2]

    return {
        "frequency": frequency,
        "week_starts_on": week_starts_on,
        "anchor_date": anchor_date,
        "monthly_day": monthly_day,
        "semi_monthly_days": semi_monthly_days,
    }


def _validate_pay_period(pay_period: PayrollPayPeriod) -> dict:
    normalized = _normalize_pay_period(pay_period.model_dump())

    if normalized["frequency"] in {"weekly", "biweekly"} and not normalized["week_starts_on"]:
        raise HTTPException(status_code=422, detail="Weekly and biweekly pay periods require a week start day.")
    if normalized["frequency"] == "biweekly" and not normalized["anchor_date"]:
        raise HTTPException(status_code=422, detail="Biweekly pay periods require a first period start date.")
    if normalized["frequency"] == "monthly" and normalized["monthly_day"] is None:
        raise HTTPException(status_code=422, detail="Monthly pay periods require a day of month.")
    if normalized["frequency"] == "semimonthly" and len(normalized["semi_monthly_days"]) != 2:
        raise HTTPException(status_code=422, detail="Semimonthly pay periods require two pay days in the month.")

    return normalized


@router.get("/agency", response_model=AgencySettings)
def get_agency(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    settings = _read(scope.agency_id, db)

    if scope.agency_id is not None:
        row = db.execute(
            text(
                """
                SELECT name, aggregator
                FROM care.agencies
                WHERE id = :id
                """
            ),
            {"id": scope.agency_id},
        ).fetchone()
        if row is not None:
            settings["agencyName"] = row.name or settings.get("agencyName", "")
            settings["integration_mode"] = _aggregator_to_mode(row.aggregator)

    return AgencySettings(**settings)


@router.put("/agency", response_model=AgencySettingsResponse)
def update_agency(
    body: AgencySettings,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        current = _read(scope.agency_id, db)
        patch = body.model_dump(exclude_none=True)
        current.update(patch)

        if scope.agency_id is not None:
            agency_name = patch.get("agencyName")
            integration_mode = patch.get("integration_mode")

            set_clauses: list[str] = []
            params: dict[str, object] = {"id": scope.agency_id}

            if agency_name is not None:
                set_clauses.append("name = :name")
                params["name"] = str(agency_name).strip()

            if integration_mode is not None:
                set_clauses.append("aggregator = :aggregator")
                params["aggregator"] = _mode_to_aggregator(str(integration_mode))

            if set_clauses:
                db.execute(
                    text(f"UPDATE care.agencies SET {', '.join(set_clauses)} WHERE id = :id"),
                    params,
                )

        _write(current, scope.agency_id, db)
        db.commit()
        return AgencySettingsResponse(success=True, message="Agency settings saved.")
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Save failed: {exc}") from exc


def _load_payroll_groups(db: Session) -> list[PayrollGroup]:
    ensure_default_pay_group(db)

    rows = db.execute(
        text(
            """
            SELECT
                g.id AS group_id,
                g.name AS group_name,
                g.description AS group_description,
                r.id AS rate_id,
                r.name AS rate_name,
                r.pay_type,
                CAST(r.rate AS FLOAT) AS rate,
                r.applies_on,
                r.start_time,
                r.end_time,
                CONVERT(VARCHAR, r.effective_date, 23) AS effective_date,
                r.sort_order,
                r.is_base_rate
            FROM care.pay_groups g
            LEFT JOIN care.pay_group_rates r ON r.pay_group_id = g.id
            ORDER BY g.name, ISNULL(r.sort_order, 0), r.id
            """
        )
    ).fetchall()

    groups: dict[int, PayrollGroup] = {}
    for row in rows:
        group_id = int(row.group_id)
        if group_id not in groups:
            groups[group_id] = PayrollGroup(
                id=group_id,
                name=str(row.group_name),
                description=row.group_description,
                items=[],
            )
        if row.rate_id is not None:
            groups[group_id].items.append(
                PayrollRateItem(
                    id=int(row.rate_id),
                    name=str(row.rate_name),
                    pay_type=str(row.pay_type),
                    rate=round(float(row.rate or 0), 2),
                    applies_on=row.applies_on,
                    start_time=row.start_time,
                    end_time=row.end_time,
                    effective_date=row.effective_date,
                    sort_order=int(row.sort_order or 0),
                    is_base_rate=bool(row.is_base_rate),
                )
            )
    return list(groups.values())


@router.get("/payroll", response_model=PayrollSettingsResponse)
def get_payroll_settings(
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        settings = _read(scope.agency_id, db)
        return PayrollSettingsResponse(
            groups=_load_payroll_groups(db),
            pay_period=PayrollPayPeriod(**_normalize_pay_period(settings.get("pay_period"))),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Payroll settings load failed: {exc}") from exc


@router.put("/payroll", response_model=PayrollSettingsResponse)
def update_payroll_settings(
    body: PayrollSettingsUpdateRequest,
    db: Session = Depends(get_db),
    scope: AgencyScope = Depends(get_agency_scope),
):
    try:
        ensure_payroll_tables(db)
        normalized_pay_period = _validate_pay_period(body.pay_period)

        incoming_group_ids = [int(group.id) for group in body.groups if group.id is not None]
        incoming_rate_ids = [int(item.id) for group in body.groups for item in group.items if item.id is not None]

        if incoming_rate_ids:
            db.execute(
                text(
                    f"""
                    UPDATE care.employee_payroll_settings
                    SET pay_group_rate_id = NULL,
                        updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                    WHERE pay_group_rate_id NOT IN :kept_rate_ids
                    """
                ).bindparams(bindparam("kept_rate_ids", expanding=True)),
                {"kept_rate_ids": incoming_rate_ids},
            )
        else:
            db.execute(
                text(
                    f"""
                    UPDATE care.employee_payroll_settings
                    SET pay_group_rate_id = NULL,
                        updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                    """
                )
            )

        if incoming_group_ids:
            db.execute(
                text(
                    f"""
                    UPDATE care.employee_payroll_settings
                    SET pay_group_id = NULL,
                        pay_group_rate_id = NULL,
                        updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                    WHERE pay_group_id NOT IN :kept_group_ids
                    """
                ).bindparams(bindparam("kept_group_ids", expanding=True)),
                {"kept_group_ids": incoming_group_ids},
            )
        else:
            db.execute(
                text(
                    f"""
                    UPDATE care.employee_payroll_settings
                    SET pay_group_id = NULL,
                        pay_group_rate_id = NULL,
                        updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                    """
                )
            )

        saved_group_ids: list[int] = []
        saved_rate_ids: list[int] = []

        for group_index, group in enumerate(body.groups):
            name = group.name.strip()
            if not name:
                raise HTTPException(status_code=422, detail="Pay group name is required.")
            if not group.items:
                raise HTTPException(status_code=422, detail=f"Pay group '{name}' must include at least one pay item.")

            if group.id is not None:
                db.execute(
                    text(
                        f"""
                        UPDATE care.pay_groups
                        SET name = :name,
                            description = :description,
                            updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                        WHERE id = :id
                        """
                    ),
                    {"id": int(group.id), "name": name, "description": group.description},
                )
                group_id = int(group.id)
            else:
                inserted = db.execute(
                    text(
                        """
                        INSERT INTO care.pay_groups (name, description)
                        OUTPUT INSERTED.id
                        VALUES (:name, :description)
                        """
                    ),
                    {"name": name, "description": group.description},
                ).fetchone()
                group_id = int(inserted.id)
            saved_group_ids.append(group_id)

            base_rate_seen = False
            for item_index, item in enumerate(group.items):
                item_name = item.name.strip()
                if not item_name:
                    raise HTTPException(status_code=422, detail=f"Pay item name is required for group '{name}'.")
                pay_type = item.pay_type.strip() if item.pay_type else "Hourly"
                if pay_type not in {"Hourly", "Per Visit"}:
                    raise HTTPException(status_code=422, detail="Pay type must be Hourly or Per Visit.")
                rate = round(float(item.rate), 2)
                is_base_rate = bool(item.is_base_rate) or item_index == 0
                if is_base_rate:
                    if base_rate_seen:
                        is_base_rate = False
                    base_rate_seen = True

                params = {
                    "id": int(item.id) if item.id is not None else None,
                    "pay_group_id": group_id,
                    "name": item_name,
                    "pay_type": pay_type,
                    "rate": rate,
                    "applies_on": item.applies_on,
                    "start_time": item.start_time,
                    "end_time": item.end_time,
                    "effective_date": item.effective_date,
                    "sort_order": int(item.sort_order if item.sort_order is not None else item_index),
                    "is_base_rate": 1 if is_base_rate else 0,
                }

                if item.id is not None:
                    db.execute(
                        text(
                            f"""
                            UPDATE care.pay_group_rates
                            SET pay_group_id = :pay_group_id,
                                name = :name,
                                pay_type = :pay_type,
                                rate = :rate,
                                applies_on = :applies_on,
                                start_time = :start_time,
                                end_time = :end_time,
                                effective_date = :effective_date,
                                sort_order = :sort_order,
                                is_base_rate = :is_base_rate,
                                updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                    rate_id = int(item.id)
                else:
                    inserted = db.execute(
                        text(
                            """
                            INSERT INTO care.pay_group_rates
                                (pay_group_id, name, pay_type, rate, applies_on, start_time, end_time, effective_date, sort_order, is_base_rate)
                            OUTPUT INSERTED.id
                            VALUES
                                (:pay_group_id, :name, :pay_type, :rate, :applies_on, :start_time, :end_time, :effective_date, :sort_order, :is_base_rate)
                            """
                        ),
                        params,
                    ).fetchone()
                    rate_id = int(inserted.id)
                saved_rate_ids.append(rate_id)

            db.execute(
                text(
                    f"""
                    UPDATE care.pay_group_rates
                    SET is_base_rate = CASE WHEN id = (
                        SELECT TOP 1 id
                        FROM care.pay_group_rates
                        WHERE pay_group_id = :pay_group_id
                        ORDER BY is_base_rate DESC, sort_order ASC, id ASC
                    ) THEN 1 ELSE 0 END,
                        updated_at = {SQLSERVER_EASTERN_NOW_EXPR}
                    WHERE pay_group_id = :pay_group_id
                    """
                ),
                {"pay_group_id": group_id},
            )

        if saved_rate_ids:
            db.execute(
                text(
                    """
                    DELETE FROM care.pay_group_rates
                    WHERE id NOT IN :saved_rate_ids
                    """
                ).bindparams(bindparam("saved_rate_ids", expanding=True)),
                {"saved_rate_ids": saved_rate_ids},
            )
        else:
            db.execute(text("DELETE FROM care.pay_group_rates"))

        if saved_group_ids:
            db.execute(
                text(
                    """
                    DELETE FROM care.pay_groups
                    WHERE id NOT IN :saved_group_ids
                    """
                ).bindparams(bindparam("saved_group_ids", expanding=True)),
                {"saved_group_ids": saved_group_ids},
            )
        else:
            db.execute(text("DELETE FROM care.pay_groups"))

        settings = _read(scope.agency_id, db)
        settings["pay_period"] = normalized_pay_period
        _write(settings, scope.agency_id, db)
        db.commit()
        return PayrollSettingsResponse(
            groups=_load_payroll_groups(db),
            pay_period=PayrollPayPeriod(**normalized_pay_period),
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Payroll settings save failed: {exc}") from exc
