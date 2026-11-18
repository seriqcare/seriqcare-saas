"""Agency-owned billing rates, separate from caregiver payroll rates."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import AgencyScope, get_agency_scope, require_role
from db.database import get_db

router = APIRouter()


class ServiceRateInput(BaseModel):
    service_code_id: int = Field(gt=0)
    rate_per_unit: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode='after')
    def validate_dates(self):
        if self.effective_to is not None and self.effective_to < self.effective_from:
            raise ValueError('End date must be on or after the start date.')
        return self


def _agency(scope: AgencyScope) -> int:
    if scope.agency_id is None:
        raise HTTPException(403, 'Sign in to an agency to manage its service rates.')
    return scope.agency_id


@router.get('/service-rates')
def get_service_rates(db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    agency_id = _agency(scope)
    services = db.execute(text('''
        SELECT id, hcpcs_code, modifier, description, unit_type, minutes_per_unit
        FROM care.service_codes WHERE is_active = 1 ORDER BY hcpcs_code, modifier
    ''')).mappings().all()
    rates = db.execute(text('''
        SELECT r.id, r.service_code_id, r.rate_per_unit, r.effective_from, r.effective_to,
               sc.hcpcs_code, sc.modifier, sc.description, sc.unit_type
        FROM care.agency_service_rates r
        JOIN care.service_codes sc ON sc.id = r.service_code_id
        WHERE r.agency_id = :agency_id
        ORDER BY sc.hcpcs_code, sc.modifier, r.effective_from DESC, r.id DESC
    '''), {'agency_id': agency_id}).mappings().all()
    return {'services': [dict(r) for r in services], 'rates': [dict(r) for r in rates]}


def _save_rate(body: ServiceRateInput, rate_id: int | None, db: Session, scope: AgencyScope):
    agency_id = _agency(scope)
    params = body.model_dump() | {'agency_id': agency_id, 'rate_id': rate_id, 'user_id': scope.user_id}
    try:
        # Serialize edits for this agency so concurrent saves cannot create overlaps.
        agency = db.execute(text('''
            SELECT id FROM care.agencies WITH (UPDLOCK, HOLDLOCK) WHERE id = :agency_id
        '''), params).fetchone()
        if not agency:
            raise HTTPException(404, 'Agency not found.')
        if rate_id is not None:
            existing = db.execute(text('''
                SELECT id FROM care.agency_service_rates
                WHERE id = :rate_id AND agency_id = :agency_id
            '''), params).fetchone()
            if not existing:
                raise HTTPException(404, 'Service rate not found.')
        service = db.execute(text('''
            SELECT id FROM care.service_codes WHERE id = :service_code_id AND is_active = 1
        '''), params).fetchone()
        if not service:
            raise HTTPException(422, 'Select an active service code.')
        overlap = db.execute(text('''
            SELECT TOP 1 id FROM care.agency_service_rates
            WHERE agency_id = :agency_id AND service_code_id = :service_code_id
              AND (:rate_id IS NULL OR id <> :rate_id)
              AND (:effective_to IS NULL OR effective_from <= :effective_to)
              AND (effective_to IS NULL OR effective_to >= :effective_from)
        '''), params).fetchone()
        if overlap:
            raise HTTPException(409, 'These dates overlap an existing rate. End the earlier rate before adding a new one.')
        if rate_id is None:
            row = db.execute(text('''
                INSERT INTO care.agency_service_rates
                    (agency_id, service_code_id, rate_per_unit, effective_from, effective_to, updated_by)
                OUTPUT INSERTED.id
                VALUES (:agency_id, :service_code_id, :rate_per_unit, :effective_from, :effective_to, :user_id)
            '''), params).fetchone()
            rate_id = row.id
        else:
            db.execute(text('''
                UPDATE care.agency_service_rates
                SET service_code_id = :service_code_id, rate_per_unit = :rate_per_unit,
                    effective_from = :effective_from, effective_to = :effective_to,
                    updated_by = :user_id, updated_at = SYSUTCDATETIME()
                WHERE id = :rate_id AND agency_id = :agency_id
            '''), params)
        db.commit()
        return {'id': rate_id}
    except Exception:
        db.rollback()
        raise


@router.post('/service-rates', dependencies=[Depends(require_role('agency_admin'))])
def create_service_rate(body: ServiceRateInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    return _save_rate(body, None, db, scope)


@router.put('/service-rates/{rate_id}', dependencies=[Depends(require_role('agency_admin'))])
def update_service_rate(rate_id: int, body: ServiceRateInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    return _save_rate(body, rate_id, db, scope)
