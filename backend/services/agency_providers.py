"""Create agency-owned provider records from saved agency configuration."""
from fastapi import HTTPException
from sqlalchemy import text


def provision_agency_provider(db, agency_id: int):
    """Idempotent; caller owns the transaction. Never adopts another tenant's provider."""
    agency = db.execute(text('''
        SELECT id, name, sandata_provider_id, address1, city, state, zip, phone
        FROM care.agencies WHERE id=:agency_id
    '''), {'agency_id': agency_id}).fetchone()
    if not agency:
        raise HTTPException(404, 'Agency not found.')
    provider_id = (agency.sandata_provider_id or '').strip()
    if not provider_id:
        return None
    existing = db.execute(text('''
        SELECT id, agency_id, is_active FROM care.providers
        WHERE provider_id_sandata=:provider_id
    '''), {'provider_id': provider_id}).fetchone()
    if existing:
        if existing.agency_id != agency_id:
            raise HTTPException(409, 'The Sandata provider ID is already assigned to another agency.')
        if not existing.is_active:
            db.execute(text('UPDATE care.providers SET is_active=1 WHERE id=:id AND agency_id=:agency_id'),
                       {'id': existing.id, 'agency_id': agency_id})
        return existing.id
    row = db.execute(text('''
        INSERT INTO care.providers (agency_id,provider_id_sandata,name,address1,city,state,zip,phone,is_active)
        OUTPUT INSERTED.id
        VALUES (:agency_id,:provider_id,:name,:address1,:city,:state,:zip,:phone,1)
    '''), {'agency_id': agency_id, 'provider_id': provider_id, 'name': agency.name,
          'address1': agency.address1, 'city': agency.city, 'state': agency.state or 'PA',
          'zip': agency.zip, 'phone': agency.phone}).fetchone()
    return row.id


def agency_sandata_provider(db, agency_id):
    return db.execute(text('''
        SELECT TOP 1 p.provider_id_sandata FROM care.providers p
        JOIN care.agencies a ON a.id=p.agency_id AND a.sandata_provider_id=p.provider_id_sandata
        WHERE p.agency_id=:agency_id AND p.is_active=1 AND a.is_active=1
        ORDER BY p.id
    '''), {'agency_id': agency_id}).fetchone()
