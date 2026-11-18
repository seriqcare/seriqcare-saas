"""Client record editors. Every lookup and write is scoped through the client."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import AgencyScope
from backend.routers.clients import _ensure_client_exists, get_client_agency_scope
from backend.services.timezone import SQLSERVER_LOCAL_DATE_EXPR, SQLSERVER_EASTERN_NOW_EXPR
from db.database import get_db

router = APIRouter()


class Period(BaseModel):
    @model_validator(mode='after')
    def valid_period(self):
        start = getattr(self, 'effective_date', None) or getattr(self, 'service_start_date', None)
        end = getattr(self, 'end_date', None) or getattr(self, 'service_end_date', None)
        if start and end and end < start:
            raise ValueError('End date must be on or after start date.')
        return self


class InsuranceInput(Period):
    payer_id: str = Field(min_length=1, max_length=20)
    program: str = Field(min_length=1, max_length=20)
    waiver_id: int | None = Field(default=None, gt=0)
    effective_date: date
    end_date: date | None = None
    is_active: bool = True


class AuthorizationInput(Period):
    service_code_id: int = Field(gt=0)
    provider_id: int = Field(gt=0)
    auth_number: str | None = Field(default=None, max_length=50)
    authorized_units: float = Field(gt=0, le=99999999.99, allow_inf_nan=False)
    service_start_date: date
    service_end_date: date
    is_active: bool = True


class GoalInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default='', max_length=4000)
    target_date: date | None = None
    progress: int = Field(default=0, ge=0, le=100)
    status: Literal['Not Started', 'In Progress', 'Completed', 'On Hold'] = 'Not Started'
    notes: str = Field(default='', max_length=4000)


def _client_agency(client_id, db, scope):
    _ensure_client_exists(client_id, db, scope)
    return db.execute(text('SELECT agency_id FROM care.clients WHERE id = :id'), {'id': client_id}).scalar_one()


@router.get('/{client_id}/edit-options')
def edit_options(client_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    agency_id = _client_agency(client_id, db, scope)
    def rows(sql, params=None):
        return [dict(r) for r in db.execute(text(sql), params or {}).mappings().all()]
    return {
        'services': rows('SELECT id, hcpcs_code AS code, description, modifier FROM care.service_codes WHERE is_active = 1 ORDER BY hcpcs_code, modifier'),
        'providers': rows('SELECT id, name FROM care.providers WHERE agency_id = :agency AND is_active = 1 ORDER BY name', {'agency': agency_id}),
        'waivers': rows('SELECT id, waiver_code AS code, waiver_name AS name FROM care.waivers WHERE is_active = 1 ORDER BY waiver_name'),
    }


@router.get('/{client_id}/overview')
def overview(client_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    agency_id = _client_agency(client_id, db, scope)
    return dict(db.execute(text(f'''
        SELECT (SELECT COUNT(*) FROM care.visits WHERE client_id = :id AND agency_id = :agency AND visit_cancelled = 0) AS total_visits,
               (SELECT COUNT(*) FROM care.service_authorizations
                WHERE client_id = :id AND agency_id = :agency AND is_active = 1
                  AND service_start_date <= {SQLSERVER_LOCAL_DATE_EXPR}
                  AND service_end_date >= {SQLSERVER_LOCAL_DATE_EXPR}) AS active_authorizations
    '''), {'id': client_id, 'agency': agency_id}).mappings().one())


@router.get('/{client_id}/goals')
def goals(client_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    _ensure_client_exists(client_id, db, scope)
    return [dict(r) for r in db.execute(text('''
        SELECT id, title, description, CONVERT(VARCHAR(10), target_date, 23) AS target_date,
               progress, status, notes FROM care.client_goals WHERE client_id = :id ORDER BY id
    '''), {'id': client_id}).mappings().all()]


def _save_goal(client_id, body, db, scope, record_id=None):
    _ensure_client_exists(client_id, db, scope)
    values = body.model_dump()
    values['title'] = values['title'].strip()
    if not values['title']:
        raise HTTPException(422, 'Goal title is required.')
    if values['status'] == 'Completed':
        values['progress'] = 100
    values.update(client_id=client_id, id=record_id)
    try:
        if record_id is None:
            row = db.execute(text(f'''
                INSERT INTO care.client_goals (client_id, title, description, target_date, progress, status, notes, updated_at)
                OUTPUT INSERTED.id VALUES (:client_id, :title, :description, :target_date, :progress, :status, :notes, {SQLSERVER_EASTERN_NOW_EXPR})
            '''), values).fetchone()
        else:
            row = db.execute(text(f'''
                UPDATE care.client_goals SET title=:title, description=:description, target_date=:target_date,
                    progress=:progress, status=:status, notes=:notes, updated_at={SQLSERVER_EASTERN_NOW_EXPR}
                OUTPUT INSERTED.id WHERE id=:id AND client_id=:client_id
            '''), values).fetchone()
        if not row:
            raise HTTPException(404, 'Goal not found.')
        db.commit()
        return {'id': row.id, 'success': True}
    except Exception:
        db.rollback()
        raise


@router.post('/{client_id}/goals', status_code=201)
def add_goal(client_id: int, body: GoalInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    return _save_goal(client_id, body, db, scope)


@router.put('/{client_id}/goals/{record_id}')
def edit_goal(client_id: int, record_id: int, body: GoalInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    return _save_goal(client_id, body, db, scope, record_id)


def _save_insurance(client_id, body, db, scope, record_id=None):
    _ensure_client_exists(client_id, db, scope)
    values = body.model_dump()
    for field in ('payer_id', 'program'):
        values[field] = values[field].strip()
        if not values[field]:
            raise HTTPException(422, 'Payer ID and program are required.')
    if body.waiver_id and not db.execute(text('SELECT id FROM care.waivers WHERE id=:id AND is_active=1'), {'id': body.waiver_id}).fetchone():
        raise HTTPException(422, 'Select an active waiver.')
    values.update(client_id=client_id, id=record_id)
    try:
        if record_id is None:
            row = db.execute(text('''
                INSERT INTO care.client_payer_info (client_id,payer_id,program,waiver_id,effective_date,end_date,is_active)
                OUTPUT INSERTED.id VALUES (:client_id,:payer_id,:program,:waiver_id,:effective_date,:end_date,:is_active)
            '''), values).fetchone()
        else:
            row = db.execute(text('''
                UPDATE care.client_payer_info SET payer_id=:payer_id,program=:program,waiver_id=:waiver_id,
                    effective_date=:effective_date,end_date=:end_date,is_active=:is_active
                OUTPUT INSERTED.id WHERE id=:id AND client_id=:client_id
            '''), values).fetchone()
        if not row:
            raise HTTPException(404, 'Insurance record not found.')
        db.commit()
        return {'id': row.id, 'success': True}
    except Exception:
        db.rollback()
        raise


@router.post('/{client_id}/insurance', status_code=201)
def add_insurance(client_id: int, body: InsuranceInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    return _save_insurance(client_id, body, db, scope)


@router.put('/{client_id}/insurance/{record_id}')
def edit_insurance(client_id: int, record_id: int, body: InsuranceInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    return _save_insurance(client_id, body, db, scope, record_id)


def _save_authorization(client_id, body, db, scope, record_id=None):
    agency_id = _client_agency(client_id, db, scope)
    if not db.execute(text('SELECT id FROM care.providers WHERE id=:id AND agency_id=:agency AND is_active=1'), {'id': body.provider_id, 'agency': agency_id}).fetchone():
        raise HTTPException(422, 'Select an active provider from this agency.')
    if not db.execute(text('SELECT id FROM care.service_codes WHERE id=:id AND is_active=1'), {'id': body.service_code_id}).fetchone():
        raise HTTPException(422, 'Select an active service.')
    values = body.model_dump()
    values.update(client_id=client_id, agency_id=agency_id, id=record_id)
    try:
        if record_id is None:
            row = db.execute(text('''
                INSERT INTO care.service_authorizations (agency_id,client_id,service_code_id,provider_id,auth_number,
                    authorized_units,used_units,service_start_date,service_end_date,is_active)
                OUTPUT INSERTED.id VALUES (:agency_id,:client_id,:service_code_id,:provider_id,:auth_number,
                    :authorized_units,0,:service_start_date,:service_end_date,:is_active)
            '''), values).fetchone()
        else:
            row = db.execute(text('''
                UPDATE care.service_authorizations SET service_code_id=:service_code_id,provider_id=:provider_id,
                    auth_number=:auth_number,authorized_units=:authorized_units,service_start_date=:service_start_date,
                    service_end_date=:service_end_date,is_active=:is_active
                OUTPUT INSERTED.id WHERE id=:id AND client_id=:client_id AND agency_id=:agency_id
            '''), values).fetchone()
        if not row:
            raise HTTPException(404, 'Authorization not found.')
        db.commit()
        return {'id': row.id, 'success': True}
    except Exception:
        db.rollback()
        raise


@router.post('/{client_id}/authorizations', status_code=201)
def add_authorization(client_id: int, body: AuthorizationInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    return _save_authorization(client_id, body, db, scope)


@router.put('/{client_id}/authorizations/{record_id}')
def edit_authorization(client_id: int, record_id: int, body: AuthorizationInput, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_client_agency_scope)):
    return _save_authorization(client_id, body, db, scope, record_id)
