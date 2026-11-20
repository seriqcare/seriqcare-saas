"""Tracked exports of approved payroll or EVV-ready billing data; no claim submission."""
import calendar
import json
from datetime import timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.dependencies import AgencyScope, get_agency_scope
from backend.services.data_exports import (amount, billing_record, csv_text, export_reasons, hours, saved_export_amount,
                                           number, payroll_columns, payroll_record, read_export_rows, readiness_item)
from backend.services.timezone import now_eastern
from db.database import get_db

router = APIRouter()
Kind = Literal['billing', 'payroll']
Provider = Literal['universal', 'adp', 'paychex', 'quickbooks', 'gusto']


class ExportCreate(BaseModel):
    kind: Kind
    period: str
    request_id: UUID
    provider: Provider = 'universal'
    visit_ids: list[int] | None = Field(default=None, min_length=1, max_length=5000)


class AuthorizationLink(BaseModel):
    authorization_id: int = Field(gt=0)


def authorization_options(visit_id, db, aid):
    visit = db.execute(text('''SELECT id FROM care.visits
        WHERE id = :visit_id AND agency_id = :agency_id AND visit_cancelled = 0'''), {'visit_id': visit_id, 'agency_id': aid}).fetchone()
    if not visit:
        raise HTTPException(404, 'Visit not found.')
    return [dict(r) for r in db.execute(text('''
        SELECT sa.id, sa.auth_number, sa.service_start_date, sa.service_end_date,
            sa.authorized_units, p.name AS provider_name
        FROM care.visits v
        JOIN care.service_authorizations sa ON sa.agency_id = v.agency_id AND sa.client_id = v.client_id
          AND sa.service_code_id = v.service_code_id AND sa.is_active = 1
          AND sa.service_start_date <= v.service_date AND sa.service_end_date >= v.service_date
        LEFT JOIN care.providers p ON p.id = sa.provider_id AND p.agency_id = v.agency_id AND p.is_active = 1
        WHERE v.id = :visit_id AND v.agency_id = :agency_id
        ORDER BY sa.service_start_date DESC, sa.id
    '''), {'visit_id': visit_id, 'agency_id': aid}).mappings().all()]


@router.get('/visits/{visit_id}/authorizations')
def get_authorization_options(visit_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    return {'items': authorization_options(visit_id, db, agency_id(scope))}


@router.put('/visits/{visit_id}/authorization')
def assign_authorization(visit_id: int, body: AuthorizationLink, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    aid = agency_id(scope)
    params = {'agency_id': aid, 'visit_id': visit_id, 'auth_id': body.authorization_id}
    try:
        db.execute(text('SELECT id FROM care.agencies WITH (UPDLOCK, HOLDLOCK) WHERE id = :agency_id'), params)
        options = authorization_options(visit_id, db, aid)
        if not any(row['id'] == body.authorization_id for row in options):
            raise HTTPException(422, 'Select an active authorization for this visit\'s agency, client, service, and date.')
        if db.execute(text("SELECT id FROM care.data_export_items WHERE visit_id = :visit_id AND agency_id = :agency_id AND kind = 'billing'"), params).fetchone():
            raise HTTPException(409, 'This visit is already in a billing export. Its saved snapshot cannot be changed.')
        db.execute(text('''UPDATE care.visits SET service_authorization_id = :auth_id, updated_at = :now
            WHERE id = :visit_id AND agency_id = :agency_id'''), params | {'now': now_eastern().replace(tzinfo=None)})
        db.commit()
        return {'visit_id': visit_id, 'authorization_id': body.authorization_id}
    except Exception:
        db.rollback()
        raise


def agency_id(scope):
    if scope.agency_id is None:
        raise HTTPException(403, 'Sign in to an agency to export its records.')
    return scope.agency_id


def period_bounds(kind, period, scope, db):
    today = now_eastern().date()
    if kind == 'payroll':
        if period not in ('pay_current', 'pay_previous', 'current', 'last2', 'last4'):
            raise HTTPException(422, 'Select a valid payroll period.')
        from backend.routers.timesheets import _pay_period_window_for_day
        from backend.routers.settings import _read, _normalize_pay_period
        if period in ('pay_current', 'pay_previous'):
            settings = _normalize_pay_period(_read(scope.agency_id, db).get('pay_period'))
            start, end = _pay_period_window_for_day(today, settings)
            return _pay_period_window_for_day(start - timedelta(days=1), settings) if period == 'pay_previous' else (start, end)
        start = today - timedelta(days=today.weekday())
        return start - timedelta(days={'current': 0, 'last2': 7, 'last4': 21}[period]), start + timedelta(days=6)
    if period in ('this_week', 'last_week'):
        start = today - timedelta(days=today.weekday()) - timedelta(days=7 if period == 'last_week' else 0)
        return start, start + timedelta(days=6)
    if period == 'last_month':
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if period not in ('this_month', 'last3m'):
        raise HTTPException(422, 'Select a valid billing period.')
    end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    start = today.replace(day=1)
    if period == 'last3m':
        for _ in range(2):
            start = (start - timedelta(days=1)).replace(day=1)
    return start, end


@router.get('/readiness')
def get_readiness(kind: Kind, period: str, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    aid = agency_id(scope)
    start, end = period_bounds(kind, period, scope, db)
    rows = read_export_rows(db, aid, kind, start, end)
    items = [readiness_item(row, kind) for row in rows]
    ready = [row for row in rows if not row.get('export_id') and not export_reasons(row, kind)]
    ready_amount = sum((amount(r, kind) for r in ready), Decimal(0))
    period_amount = ready_amount + sum((saved_export_amount(r, kind) for r in rows if r.get('export_id')), Decimal(0))
    return {
        'items': items, 'period_start': start, 'period_end': end,
        'stats': {'total': len(rows), 'ready': len(ready), 'exported': sum(bool(r.get('export_id')) for r in rows),
                  'blocked': len(rows) - len(ready) - sum(bool(r.get('export_id')) for r in rows),
                  'ready_amount': ready_amount, 'period_amount': period_amount,
                  'ready_hours': sum((hours(r) for r in ready), Decimal(0)),
                  'ready_units': sum((number(r.get('units')) for r in ready), Decimal(0))},
    }


_HEADER = '''SELECT id, kind, request_id, period_start, period_end, created_by_name,
    created_at, provider, visit_count, total_units, total_hours, total_amount
    FROM care.data_exports'''


def _header(db, export_id, aid):
    row = db.execute(text(_HEADER + ' WHERE id = :id AND agency_id = :agency_id'), {'id': export_id, 'agency_id': aid}).mappings().first()
    if not row:
        raise HTTPException(404, 'Export not found.')
    return dict(row)


@router.post('', status_code=201)
def create_export(body: ExportCreate, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    aid = agency_id(scope)
    try:
        # Serializes batch creation within the agency; uniqueness also guards each visit/kind.
        if not db.execute(text('SELECT id FROM care.agencies WITH (UPDLOCK, HOLDLOCK) WHERE id = :agency_id'), {'agency_id': aid}).fetchone():
            raise HTTPException(404, 'Agency not found.')
        existing = db.execute(text(_HEADER + ' WHERE agency_id = :agency_id AND request_id = :request_id'),
                              {'agency_id': aid, 'request_id': str(body.request_id)}).mappings().first()
        start, end = period_bounds(body.kind, body.period, scope, db)
        if existing:
            if (existing['kind'] != body.kind or existing['period_start'] != start or existing['period_end'] != end
                    or existing['provider'] != (body.provider if body.kind == 'payroll' else 'universal')):
                raise HTTPException(409, 'This request already created a different export. Refresh before creating another.')
            if body.visit_ids is not None:
                saved_ids = db.execute(text('''SELECT visit_id FROM care.data_export_items
                    WHERE export_id = :id AND agency_id = :agency_id'''), {'id': existing['id'], 'agency_id': aid}).scalars().all()
                if set(saved_ids) != set(body.visit_ids):
                    raise HTTPException(409, 'This request already exported a different set of visits.')
            db.commit()
            return dict(existing)
        rows = read_export_rows(db, aid, body.kind, start, end)
        if body.visit_ids is not None:
            requested = set(body.visit_ids)
            rows = [row for row in rows if row['visit_id'] in requested]
            if {row['visit_id'] for row in rows} != requested:
                raise HTTPException(404, 'One or more visits are unavailable in this agency and period.')
            if any(row.get('export_id') or export_reasons(row, body.kind) for row in rows):
                raise HTTPException(409, 'A selected visit is no longer ready or has already been exported. Refresh the list.')
        else:
            rows = [row for row in rows if not row.get('export_id') and not export_reasons(row, body.kind)]
        if not rows:
            raise HTTPException(409, 'No new eligible visits to export. Check approval and setup, or re-download an existing export from history.')
        if len(rows) > 5000:
            raise HTTPException(422, 'Select a shorter period to export at most 5,000 visits per file.')
        if body.kind == 'billing':
            for row in rows:
                if row.get('service_authorization_id') is None and row.get('authorization_id') is not None:
                    db.execute(text('''UPDATE care.visits SET service_authorization_id = :auth_id
                        WHERE id = :visit_id AND agency_id = :agency_id AND service_authorization_id IS NULL'''),
                               {'visit_id': row['visit_id'], 'agency_id': aid, 'auth_id': row['authorization_id']})
        snapshots = [billing_record(r) if body.kind == 'billing' else payroll_record(r, start, end) for r in rows]
        records = snapshots if body.kind == 'billing' else [payroll_columns(r, body.provider) for r in snapshots]
        inserted = db.execute(text('''
            INSERT INTO care.data_exports
              (agency_id, kind, request_id, period_start, period_end, created_by, created_by_name,
               provider, visit_count, total_units, total_hours, total_amount, csv_data)
            OUTPUT INSERTED.id
            VALUES (:agency_id, :kind, :request_id, :start, :end, :user_id, :username,
                    :provider, :count, :units, :hours, :amount, :csv)
        '''), {'agency_id': aid, 'kind': body.kind, 'request_id': str(body.request_id), 'start': start, 'end': end,
              'user_id': scope.user_id, 'username': scope.username,
              'provider': body.provider if body.kind == 'payroll' else 'universal', 'count': len(rows),
              'units': sum((number(r.get('units')) for r in rows), Decimal(0)),
              'hours': sum((hours(r) for r in rows), Decimal(0)),
              'amount': sum((amount(r, body.kind) for r in rows), Decimal(0)), 'csv': csv_text(records)}).fetchone()
        export_id = int(inserted.id)
        for row, snapshot in zip(rows, snapshots):
            db.execute(text('''INSERT INTO care.data_export_items(export_id, agency_id, kind, visit_id, snapshot_json)
                VALUES (:id, :agency_id, :kind, :visit_id, :snapshot)'''), {
                    'id': export_id, 'agency_id': aid, 'kind': body.kind, 'visit_id': row['visit_id'],
                    'snapshot': json.dumps(snapshot, default=str),
                })
        result = _header(db, export_id, aid)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.get('')
def list_exports(kind: Kind, page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100),
                 db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    aid = agency_id(scope)
    params = {'agency_id': aid, 'kind': kind, 'skip': (page - 1) * per_page, 'take': per_page}
    total = db.execute(text('SELECT COUNT(*) FROM care.data_exports WHERE agency_id = :agency_id AND kind = :kind'), params).scalar_one()
    rows = db.execute(text(_HEADER + ''' WHERE agency_id = :agency_id AND kind = :kind
        ORDER BY id DESC OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY'''), params).mappings().all()
    return {'items': [dict(r) for r in rows], 'total': total, 'page': page, 'per_page': per_page}


@router.get('/{export_id}')
def get_export(export_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    aid = agency_id(scope)
    result = _header(db, export_id, aid)
    rows = db.execute(text('''SELECT visit_id, snapshot_json FROM care.data_export_items
        WHERE export_id = :id AND agency_id = :agency_id ORDER BY id'''), {'id': export_id, 'agency_id': aid}).mappings().all()
    return result | {'items': [{'visit_id': r['visit_id'], 'data': json.loads(r['snapshot_json'])} for r in rows]}


@router.get('/{export_id}/download')
def download_export(export_id: int, db: Session = Depends(get_db), scope: AgencyScope = Depends(get_agency_scope)):
    aid = agency_id(scope)
    row = db.execute(text('SELECT kind, provider, csv_data FROM care.data_exports WHERE id = :id AND agency_id = :agency_id'),
                     {'id': export_id, 'agency_id': aid}).fetchone()
    if not row:
        raise HTTPException(404, 'Export not found.')
    return Response(content='\ufeff' + row.csv_data, media_type='text/csv; charset=utf-8', headers={
        'Content-Disposition': f'attachment; filename="{row.kind}-{row.provider}-{export_id}.csv"',
        'Cache-Control': 'no-store',
    })
