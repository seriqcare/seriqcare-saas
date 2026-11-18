import asyncio
import os
import unittest
from datetime import date
from types import SimpleNamespace

os.environ.setdefault('SECRET_KEY', 'test-client-record-editors')

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from backend.auth.dependencies import AgencyScope, get_current_user
from backend.routers import client_records as records
from db.database import get_db
from test_client_tenant_access import Result, request, user


class ScalarResult(Result):
    def scalar_one(self):
        return 1


class EditorDB:
    def __init__(self):
        self.queries = []
        self.commits = 0
        self.rollbacks = 0
        self.provider_allowed = True
        self.record_exists = True

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        self.queries.append((sql, params))
        if 'SELECT tier FROM care.agencies' in sql:
            return Result(SimpleNamespace(tier='core'))
        if 'SELECT c.id FROM care.clients' in sql:
            allowed = params['client_id'] == 10 and params.get('_agy_id') == 1
            return Result(SimpleNamespace(id=10) if allowed else None)
        if 'SELECT agency_id FROM care.clients' in sql:
            return ScalarResult()
        if 'SELECT id FROM care.providers' in sql:
            return Result(SimpleNamespace(id=1) if self.provider_allowed else None)
        if 'SELECT id FROM care.service_codes' in sql or 'SELECT id FROM care.waivers' in sql:
            return Result(SimpleNamespace(id=1))
        if 'OUTPUT INSERTED.id' in sql:
            return Result(SimpleNamespace(id=17) if self.record_exists else None)
        return Result()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class ClientRecordEditorTests(unittest.TestCase):
    def setUp(self):
        self.db = EditorDB()
        self.scope = AgencyScope(user())
        self.auth = records.AuthorizationInput(service_code_id=1, provider_id=1,
            authorized_units=100, service_start_date='2026-01-01', service_end_date='2026-12-31')

    def test_authorization_edit_keeps_usage_and_scopes_record(self):
        result = records.edit_authorization(10, 17, self.auth, self.db, self.scope)
        self.assertTrue(result['success'])
        sql, params = self.db.queries[-1]
        self.assertIn('client_id=:client_id AND agency_id=:agency_id', sql)
        self.assertNotIn('used_units=', sql)
        self.assertEqual(params['agency_id'], 1)
        self.assertEqual(self.db.commits, 1)

    def test_authorization_create_sets_zero_usage_and_own_agency(self):
        records.add_authorization(10, self.auth, self.db, self.scope)
        sql, params = self.db.queries[-1]
        self.assertIn(':authorized_units,0,', sql)
        self.assertEqual(params['agency_id'], 1)

    def test_other_agency_provider_is_rejected_before_write(self):
        self.db.provider_allowed = False
        with self.assertRaises(HTTPException) as caught:
            records.add_authorization(10, self.auth, self.db, self.scope)
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.db.commits, 0)

    def test_unknown_or_other_clients_record_cannot_be_updated(self):
        self.db.record_exists = False
        with self.assertRaises(HTTPException) as caught:
            records.edit_authorization(10, 999, self.auth, self.db, self.scope)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.db.rollbacks, 1)

    def test_goal_completion_sets_progress_and_can_clear_notes(self):
        body = records.GoalInput(title='Daily walk', status='Completed', progress=20, notes='')
        records.edit_goal(10, 17, body, self.db, self.scope)
        sql, params = self.db.queries[-1]
        self.assertEqual(params['progress'], 100)
        self.assertEqual(params['notes'], '')
        self.assertIn('client_id=:client_id', sql)

    def test_insurance_update_can_remove_end_date_and_waiver(self):
        body = records.InsuranceInput(payer_id='PAYER', program='ODP', effective_date=date(2026, 1, 1))
        records.edit_insurance(10, 17, body, self.db, self.scope)
        sql, params = self.db.queries[-1]
        self.assertIsNone(params['end_date'])
        self.assertIsNone(params['waiver_id'])
        self.assertIn('client_id=:client_id', sql)

    def test_invalid_dates_units_and_progress(self):
        for model, values in (
            (records.AuthorizationInput, {**self.auth.model_dump(), 'service_end_date': '2025-01-01'}),
            (records.AuthorizationInput, {**self.auth.model_dump(), 'authorized_units': 0}),
            (records.AuthorizationInput, {**self.auth.model_dump(), 'authorized_units': float('nan')}),
            (records.GoalInput, {'title': 'Test', 'progress': 101}),
            (records.InsuranceInput, {'payer_id': 'P', 'program': 'P', 'effective_date': '2026-12-01', 'end_date': '2026-01-01'}),
        ):
            with self.subTest(model=model, values=values), self.assertRaises(ValidationError):
                model(**values)

    def test_routes_require_staff_and_reject_foreign_client(self):
        app = FastAPI()
        app.include_router(records.router, prefix='/api/clients')
        app.dependency_overrides[get_db] = lambda: self.db
        paths = [('goals', {'title': 'Goal'}), ('insurance', {'payer_id': 'P', 'program': 'P', 'effective_date': '2026-01-01'}),
                 ('authorizations', {**self.auth.model_dump(mode='json')})]
        for kind, payload in paths:
            with self.subTest(kind=kind):
                app.dependency_overrides.pop(get_current_user, None)
                self.assertIn(asyncio.run(request(app, 'POST', f'/api/clients/10/{kind}', payload)), (401, 403))
                app.dependency_overrides[get_current_user] = lambda: user('caregiver', 1, 5)
                self.assertEqual(asyncio.run(request(app, 'POST', f'/api/clients/10/{kind}', payload)), 403)
                app.dependency_overrides[get_current_user] = lambda: user()
                self.assertEqual(asyncio.run(request(app, 'POST', f'/api/clients/20/{kind}', payload)), 404)
        self.assertEqual(self.db.commits, 0)


if __name__ == '__main__':
    unittest.main()
