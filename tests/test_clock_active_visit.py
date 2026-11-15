import asyncio
import os
import unittest
from datetime import datetime
from types import SimpleNamespace

os.environ.setdefault('SECRET_KEY', 'test-only-clock-active-secret')

from fastapi import FastAPI, HTTPException
from backend.auth.dependencies import get_current_user
from backend.routers import mobile_visits
from db.database import get_db
from test_client_tenant_access import Result, request, user


class ActiveVisitDB:
    def __init__(self):
        self.queries = []

    def execute(self, query, params):
        sql = str(query)
        self.queries.append((sql, params))
        assert 'v.employee_id = :employee_id AND v.agency_id = :agency_id' in sql
        assert 'v.visit_cancelled = 0' in sql
        assert 'COALESCE(ev.adj_out_datetime, ev.call_out_datetime) IS NULL' in sql
        assert 'COALESCE(ev.adj_in_datetime, ev.call_in_datetime) IS NOT NULL' in sql
        assert 'c.agency_id = v.agency_id' in sql and 'e.agency_id = v.agency_id' in sql
        if params == {'employee_id': 5, 'agency_id': 1}:
            return Result(SimpleNamespace(visit_id=100, schedule_id=10, client_name='Test Client', clocked_in=datetime(2026,11,14,9,15)))
        return Result()


class ActiveClockTests(unittest.TestCase):
    def test_no_clock_in_returns_null_instead_of_an_active_visit(self):
        db = ActiveVisitDB()
        self.assertIsNone(mobile_visits.get_active_visit(user('caregiver', 2, 15), db))

    def test_active_visit_is_returned_for_its_actual_caregiver(self):
        response = mobile_visits.get_active_visit(user('caregiver', 1, 5), ActiveVisitDB())
        self.assertEqual(response.visit_id, 100)
        self.assertEqual(response.schedule_id, 10)
        self.assertEqual(response.client_name, 'Test Client')
        self.assertEqual(datetime.fromisoformat(response.clocked_in).hour, 9)
        self.assertIsNotNone(datetime.fromisoformat(response.clocked_in).tzinfo)

    def test_other_employee_or_agency_cannot_restore_that_visit(self):
        for agency, employee in ((2,5), (1,15)):
            self.assertIsNone(mobile_visits.get_active_visit(user('caregiver', agency, employee), ActiveVisitDB()))

    def test_unlinked_account_cannot_query_active_visits(self):
        for agency, employee in ((None,5), (1,None)):
            with self.assertRaises(HTTPException) as error:
                mobile_visits.get_active_visit(user('caregiver', agency, employee), ActiveVisitDB())
            self.assertEqual(error.exception.status_code, 403)

    def test_endpoint_requires_authentication(self):
        app = FastAPI()
        app.include_router(mobile_visits.router, prefix='/api/visits')
        app.dependency_overrides[get_db] = lambda: ActiveVisitDB()
        self.assertIn(asyncio.run(request(app, 'GET', '/api/visits/active')), (401,403))
        app.dependency_overrides[get_current_user] = lambda: user('caregiver',1,5)
        self.assertEqual(asyncio.run(request(app, 'GET', '/api/visits/active')), 200)


if __name__ == '__main__':
    unittest.main()
