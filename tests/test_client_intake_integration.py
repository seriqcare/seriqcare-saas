"""Opt-in intake round trip against SQL Server; all test writes are rolled back."""
import os
import unittest
from types import SimpleNamespace
from uuid import uuid4
from datetime import datetime, timedelta, date
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

os.environ.setdefault('SECRET_KEY', 'test-only-intake-integration-secret')
from backend.auth.dependencies import AgencyScope
from backend.routers import clients, client_records
from backend.schemas import ClientCreateRequest, ClientUpdateRequest
from backend.services.client_intake import intake_options, resolve_intake
from backend.routers import dashboard, caregivers
from backend.services.data_exports import read_export_rows


@unittest.skipUnless(os.getenv('RUN_CLIENT_DB_TESTS') == '1', 'Opt-in SQL Server intake test')
class ClientIntakeIntegrationTests(unittest.TestCase):
    def test_all_steps_round_trip_and_tenant_validation(self):
        from db.database import engine
        with engine.connect() as conn:
            transaction = conn.begin()
            db = Session(bind=conn, join_transaction_mode='create_savepoint')
            try:
                aid = db.execute(text("SELECT id FROM care.agencies WHERE agency_code='AGY-004'")).scalar_one()
                scope = AgencyScope(SimpleNamespace(id=0, username='rollback.intake.test', agency_id=aid, role='agency_admin'))
                # Avoid external EVV registration: this test only checks persistence.
                scope.agency_tier = 'core'
                options = intake_options(db, aid)
                self.assertTrue(options['services'])
                self.assertTrue(options['providers'])
                service = options['services'][0]
                provider = options['providers'][0]
                values = dict(first_name='Intake', middle_name='Roundtrip', last_name='Test',
                    medicaid_id=str(uuid4().int)[:10], date_of_birth='1950-01-01', gender='F',
                    ssn_last4='1234', phone='717-555-0100', email='intake@example.invalid',
                    street_address='123 Test St', city='Harrisburg', state='PA', zip_code='17101',
                    primary_language='Spanish', emergency_contact_name='Test Guardian',
                    emergency_contact_phone='717-555-0101', emergency_contact_relationship='Other',
                    payer_name='Pennsylvania Medicaid (MA)', managed_care_plan='Community HealthChoices (CHC)',
                    waiver_id=options['waivers'][0]['id'], service_code_id=service['id'],
                    procedure_code=service['code'], provider_id=provider['id'], authorized_units=100,
                    authorization_start='2026-11-01', authorization_end='2027-11-01',
                    auth_number='TEST-INTAKE', auth_notes='Authorization from intake', place_of_service='99',
                    care_coordinator='Test Coordinator', physician='Test Physician', level_of_care='Moderate Support',
                    care_plan_start_date='2026-11-01', care_plan_review_date='2027-05-01',
                    care_plan_notes='Care plan from intake')
                body = ClientCreateRequest(**values)
                with patch.object(clients._sandata_svc, 'post_to_simulator') as send:
                    created = clients.create_client(body, db, scope)
                    send.assert_not_called()
                detail = clients.get_client(created.id, db, scope)
                for key in ('first_name', 'middle_name', 'last_name', 'primary_language', 'phone', 'email',
                            'street_address', 'city', 'state', 'zip_code', 'emergency_contact_name',
                            'emergency_contact_phone', 'emergency_contact_relationship', 'place_of_service',
                            'care_coordinator', 'physician', 'level_of_care', 'care_plan_start_date',
                            'care_plan_review_date', 'care_plan_notes'):
                    self.assertEqual(getattr(detail, key), values[key], key)
                insurance = clients.get_client_insurance(created.id, db, scope)[0]
                self.assertEqual(insurance.payer_name, values['payer_name'])
                self.assertEqual(insurance.managed_care_plan, values['managed_care_plan'])
                self.assertEqual(insurance.waiver_id, values['waiver_id'])
                self.assertIsNone(insurance.effective_date)
                auth = clients.get_client_authorizations(created.id, db, scope)[0]
                self.assertEqual(auth.provider_id, provider['id'])
                self.assertEqual(auth.authorized_units, 100)
                self.assertEqual(auth.place_of_service, '99')
                self.assertEqual(auth.notes, values['auth_notes'])
                self.assertEqual(auth.service_start_date, '2026-11-01')
                # Verify the same fields survive subsequent edits in the detail tabs.
                client_records.edit_insurance(created.id, insurance.id,
                    client_records.InsuranceInput(payer_id=insurance.payer_id, program=insurance.program,
                        payer_name='Updated payer', managed_care_plan='Fee-for-Service'), db, scope)
                self.assertEqual(clients.get_client_insurance(created.id, db, scope)[0].payer_name, 'Updated payer')
                client_records.edit_authorization(created.id, auth.id,
                    client_records.AuthorizationInput(service_code_id=service['id'], provider_id=provider['id'],
                        authorized_units=120, service_start_date='2026-11-01', service_end_date='2027-11-01',
                        notes='Updated authorization', place_of_service='12'), db, scope)
                self.assertEqual(clients.get_client_authorizations(created.id, db, scope)[0].notes, 'Updated authorization')
                clients.update_client(created.id, ClientUpdateRequest(care_plan_start_date='2026-11-02',
                    care_plan_review_date='2027-06-01'), db, scope)
                self.assertEqual(clients.get_client(created.id, db, scope).care_plan_start_date, '2026-11-02')
                self.assert_live_usage(db, scope, created.id, auth.id, service['id'])
                directory = clients.get_clients(page=1, per_page=100, status='', search='', db=db, scope=scope)
                row = next(row for row in directory.items if row.id == created.id)
                self.assertTrue(row.created_at)
                ordering = [(row.created_at, row.id) for row in directory.items if row.created_at is not None]
                self.assertEqual(ordering, sorted(ordering, reverse=True))
                foreign_provider = db.execute(text('SELECT TOP 1 id FROM care.providers WHERE agency_id<>:agency AND is_active=1'), {'agency': aid}).scalar()
                self.assertIsNotNone(foreign_provider)
                with self.assertRaises(HTTPException) as error:
                    resolve_intake(body.model_copy(update={'provider_id': foreign_provider}), db, aid)
                self.assertEqual(error.exception.status_code, 422)
                with self.assertRaises(HTTPException):
                    clients.get_client(created.id, db, AgencyScope(SimpleNamespace(id=0, username='foreign', agency_id=aid + 10000, role='agency_admin')))
            finally:
                db.close()
                transaction.rollback()

    def assert_live_usage(self, db, scope, client_id, auth_id, service_id):
        employee_id = db.execute(text('SELECT TOP 1 id FROM care.employees WHERE agency_id=:agency'), {'agency': scope.agency_id}).scalar_one()
        minutes = db.execute(text('SELECT minutes_per_unit FROM care.service_codes WHERE id=:id'), {'id': service_id}).scalar_one()
        self.assertGreater(minutes, 0)
        start = datetime(2026, 11, 3, 9)
        def visit(*, linked=auth_id, cancelled=0, end_units=4, visit_date=date(2026, 11, 3), agency=None):
            vid = db.execute(text('''INSERT INTO care.visits
                (agency_id,client_id,employee_id,service_code_id,service_authorization_id,service_date,
                 place_of_service,visit_cancelled,created_at,updated_at)
                OUTPUT INSERTED.id VALUES (:agency,:client,:employee,:service,:auth,:day,'12',:cancelled,:now,:now)'''),
                {'agency': agency if agency is not None else scope.agency_id, 'client': client_id, 'employee': employee_id,
                 'service': service_id, 'auth': linked, 'day': visit_date, 'cancelled': cancelled, 'now': start}).scalar_one()
            db.execute(text('''INSERT INTO care.visit_evv
                (visit_id,call_in_datetime,call_out_datetime,evv_status,hard_copy_required,created_at,updated_at)
                VALUES (:vid,:start,:end,'Pending',0,:start,:start)'''),
                {'vid': vid, 'start': start, 'end': start + timedelta(minutes=minutes * end_units) if end_units is not None else None})
            return vid
        completed_id = visit()
        visit(end_units=None)  # Active: never reserve or consume units.
        visit(cancelled=1)
        visit(visit_date=date(2025, 11, 3))  # Outside the authorization period.
        foreign_agency = db.execute(text('SELECT TOP 1 id FROM care.agencies WHERE id<>:agency'), {'agency': scope.agency_id}).scalar_one()
        visit(agency=foreign_agency)  # Corrupt cross-tenant link must not count.
        def totals():
            detail = clients.get_client_authorizations(client_id, db, scope)
            row = next(row for row in detail if row.id == auth_id)
            tracked = next(row for row in dashboard.get_dashboard_authorizations(db, scope) if row.auth_id == auth_id)
            self.assertEqual(row.used_units, tracked.used_units)
            self.assertEqual(row.remaining_units, row.authorized_units - row.used_units)
            return row.used_units
        self.assertEqual(totals(), 4)
        self.assertEqual(totals(), 4)  # Repeated reads never deduct again.
        db.execute(text('UPDATE care.visit_evv SET adj_out_datetime=:end WHERE visit_id=:id'),
                   {'id': completed_id, 'end': start + timedelta(minutes=minutes * 2)})
        self.assertEqual(totals(), 2)
        inferred_id = visit(linked=None, end_units=3)
        self.assertEqual(totals(), 5)
        # An overlap must stop automatic assignment, while explicit links stay valid.
        overlap = db.execute(text('''INSERT INTO care.service_authorizations
            (agency_id,client_id,service_code_id,provider_id,authorized_units,used_units,service_start_date,service_end_date,is_active,created_at)
            OUTPUT INSERTED.id SELECT agency_id,client_id,service_code_id,provider_id,100,0,service_start_date,service_end_date,1,created_at
            FROM care.service_authorizations WHERE id=:id'''), {'id': auth_id}).scalar_one()
        self.assertEqual(totals(), 2)
        tracked = next(row for row in dashboard.get_dashboard_authorizations(db, scope) if row.auth_id == auth_id)
        self.assertEqual(tracked.unassigned_visits, 1)
        db.execute(text('UPDATE care.visits SET service_authorization_id=:auth WHERE id=:id'), {'auth': overlap, 'id': inferred_id})
        self.assertEqual(totals(), 2)
        other = next(row for row in clients.get_client_authorizations(client_id, db, scope) if row.id == overlap)
        self.assertEqual(other.used_units, 3)
        exported_rows = read_export_rows(db, scope.agency_id, 'billing', date(2026, 11, 1), date(2026, 11, 30))
        exported_row = next(row for row in exported_rows if row['visit_id'] == completed_id)
        self.assertEqual(exported_row['used_units'], 2)
        db.execute(text('UPDATE care.visits SET visit_cancelled=1 WHERE id=:id'), {'id': completed_id})
        self.assertEqual(totals(), 0)
        caregiver_rows = caregivers.get_caregivers(page=1, per_page=100, status='', search='', db=db, scope=scope)
        self.assertTrue(next(row for row in caregiver_rows.items if row.id == employee_id).created_at)


if __name__ == '__main__':
    unittest.main()
