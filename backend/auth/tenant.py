"""Resolve tenant membership from trusted database records, never request headers."""
from fastapi import HTTPException
from sqlalchemy import text


def verified_user_agency(db, user):
    if user.role == 'super_admin':
        return None  # Platform administrators use their separate Entra sign-in.
    if user.agency_id is None:
        raise HTTPException(status_code=401, detail='Agency membership is required. Please sign in again.')
    agency = db.execute(text('''
        SELECT agency_code, tier, aggregator FROM care.agencies
        WHERE id = :agency_id AND is_active = 1
    '''), {'agency_id': user.agency_id}).fetchone()
    if agency is None:
        raise HTTPException(status_code=401, detail='Agency is unavailable. Please sign in again.')
    if user.role == 'caregiver':
        employee = db.execute(text('''
            SELECT id FROM care.employees
            WHERE id = :employee_id AND agency_id = :agency_id AND is_active = 1
        '''), {'employee_id': user.employee_id, 'agency_id': user.agency_id}).fetchone()
        if employee is None:
            raise HTTPException(status_code=401, detail='Caregiver agency membership is unavailable. Please sign in again.')
    return agency
