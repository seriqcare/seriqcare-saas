"""Validate and save all intake steps in the same transaction as the client."""
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import text


def ensure_intake_fields(engine):
    with engine.begin() as conn:
        conn.execute(text((Path(__file__).resolve().parents[2] / 'sql' / 'client_intake_fields.sql').read_text()))


def intake_options(db, agency_id):
    def rows(sql, params=None):
        return [dict(r) for r in db.execute(text(sql), params or {}).mappings().all()]
    return {
        'services': rows('SELECT id, hcpcs_code AS code, modifier, description, unit_type FROM care.service_codes WHERE is_active=1 ORDER BY hcpcs_code, modifier'),
        'providers': rows('SELECT id, name FROM care.providers WHERE agency_id=:agency AND is_active=1 ORDER BY name', {'agency': agency_id}),
        'waivers': rows('SELECT id, waiver_code AS code, waiver_name AS name FROM care.waivers WHERE is_active=1 ORDER BY waiver_name'),
    }


def resolve_intake(body, db, agency_id):
    if agency_id is None:
        raise HTTPException(403, 'Sign in to the agency before adding its clients.')
    service = None
    if body.service_code_id is not None:
        service = db.execute(text('SELECT id, hcpcs_code FROM care.service_codes WHERE id=:id AND is_active=1'), {'id': body.service_code_id}).fetchone()
        if not service or body.procedure_code and service.hcpcs_code != body.procedure_code:
            raise HTTPException(422, 'Select a valid service code.')
    elif body.procedure_code:
        choices = db.execute(text('SELECT id, hcpcs_code FROM care.service_codes WHERE hcpcs_code=:code AND is_active=1'), {'code': body.procedure_code}).fetchall()
        if len(choices) != 1:
            raise HTTPException(422, 'Select the service from the current service-code list.')
        service = choices[0]
    waiver = None
    if body.waiver_id is not None:
        waiver = db.execute(text('SELECT id, waiver_code FROM care.waivers WHERE id=:id AND is_active=1'), {'id': body.waiver_id}).fetchone()
        if not waiver:
            raise HTTPException(422, 'Select an active waiver program.')
    authorization = any(value is not None and value != '' for value in (
        body.authorized_units, body.authorization_start, body.authorization_end,
        body.provider_id, body.auth_number, body.auth_notes,
    ))
    if authorization:
        if not service or body.authorized_units is None or not body.authorization_start or not body.authorization_end or body.provider_id is None:
            raise HTTPException(422, 'Authorization requires a service, provider, positive units, start date, and end date.')
        if body.authorization_end < body.authorization_start:
            raise HTTPException(422, 'Authorization end must be on or after the start date.')
        if not db.execute(text('SELECT id FROM care.providers WHERE id=:id AND agency_id=:agency AND is_active=1'), {'id': body.provider_id, 'agency': agency_id}).fetchone():
            raise HTTPException(422, 'Select an active provider belonging to this agency.')
    if body.care_plan_start_date and body.care_plan_review_date and body.care_plan_review_date < body.care_plan_start_date:
        raise HTTPException(422, 'Care plan review date must be on or after the plan start date.')
    if body.insurance_effective_date and body.insurance_end_date and body.insurance_end_date < body.insurance_effective_date:
        raise HTTPException(422, 'Insurance end must be on or after its effective date.')
    return {'service': service, 'waiver': waiver, 'authorization': authorization}


def persist_intake(client_id, body, resolved, db, agency_id, created_at):
    fields = ('middle_name', 'primary_language', 'emergency_contact_name', 'emergency_contact_phone',
              'emergency_contact_relationship', 'care_coordinator', 'physician', 'level_of_care',
              'care_plan_start_date', 'care_plan_review_date', 'care_plan_notes', 'place_of_service')
    values = {field: getattr(body, field) for field in fields}
    values.update(client_id=client_id, agency_id=agency_id, intake_service_code_id=resolved['service'].id if resolved['service'] else None)
    assignments = ', '.join(f'{field}=:{field}' for field in fields) + ', intake_service_code_id=:intake_service_code_id'
    db.execute(text(f'UPDATE care.clients SET {assignments} WHERE id=:client_id AND agency_id=:agency_id'), values)
    if body.payer_name or body.payer_id or body.managed_care_plan or body.waiver_id:
        mapping = {'Pennsylvania Medicaid (MA)': ('PA-MEDICAID', 'MA'), 'Medicare Part A': ('MEDICARE', 'MEDICARE_A'), 'Private Insurance': ('PRIVATE', 'PRIVATE')}
        payer_id, program = mapping.get(body.payer_name, (body.payer_id or 'OTHER', 'OTHER'))
        db.execute(text('''INSERT INTO care.client_payer_info
            (client_id, payer_id, payer_name, program, managed_care_plan, waiver_id, effective_date, end_date, is_active)
            VALUES (:client_id,:payer_id,:payer_name,:program,:managed_care_plan,:waiver_id,:effective_date,:end_date,1)'''), {
                'client_id': client_id, 'payer_id': body.payer_id or payer_id, 'payer_name': body.payer_name,
                'program': resolved['waiver'].waiver_code if resolved['waiver'] else program,
                'managed_care_plan': body.managed_care_plan, 'waiver_id': body.waiver_id,
                'effective_date': body.insurance_effective_date, 'end_date': body.insurance_end_date,
            })
    if resolved['authorization']:
        db.execute(text('''INSERT INTO care.service_authorizations
            (agency_id,client_id,service_code_id,provider_id,auth_number,authorized_units,used_units,
             service_start_date,service_end_date,place_of_service,notes,is_active,created_at)
            VALUES (:agency_id,:client_id,:service_code_id,:provider_id,:auth_number,:units,0,:start,:end,:pos,:notes,1,:created_at)'''), {
                'agency_id': agency_id, 'client_id': client_id, 'service_code_id': resolved['service'].id,
                'provider_id': body.provider_id, 'auth_number': body.auth_number, 'units': body.authorized_units,
                'start': body.authorization_start, 'end': body.authorization_end, 'pos': body.place_of_service,
                'notes': body.auth_notes, 'created_at': created_at,
            })
