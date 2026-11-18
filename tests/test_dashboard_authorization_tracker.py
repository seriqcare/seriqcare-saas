import asyncio
import os
import unittest
from types import SimpleNamespace

os.environ.setdefault('SECRET_KEY', 'test-only-dashboard-secret')

from fastapi import FastAPI
from backend.auth.dependencies import AgencyScope, get_current_user
from backend.routers import dashboard
from db.database import get_db
from test_client_tenant_access import Result, request, user


class AuthorizationDB:
    def __init__(self):
        self.queries = []

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        self.queries.append((sql, params))
        if 'SELECT tier FROM care.agencies' in sql:
            return Result(SimpleNamespace(tier='core'))
        records = [
            (1, SimpleNamespace(auth_id=1, client_id=10, client_name='Own Client',
                service_code='T2013', auth_number='A1', authorized_units=100,
                used_units=120, days_until_expiry=-2)),
            (1, SimpleNamespace(auth_id=2, client_id=10, client_name='Own Client',
                service_code='T2014', auth_number=None, authorized_units=0,
                used_units=None, days_until_expiry=None)),
            (2, SimpleNamespace(auth_id=3, client_id=20, client_name='Other Agency',
                service_code=None, auth_number=None, authorized_units=100,
                used_units=25.5, days_until_expiry=20)),
        ]
        return Result(rows=[r for agency, r in records if params.get('_agy_id', agency) == agency])


class AuthorizationTrackerTests(unittest.TestCase):
    def test_tenant_scope_and_separate_service_authorizations(self):
        db = AuthorizationDB()
        rows = dashboard.get_dashboard_authorizations(db, AgencyScope(user()))
        self.assertEqual([r.auth_id for r in rows], [1, 2])
        self.assertEqual(rows[0].used_units, 120)  # Preserve over-use instead of hiding it.
        self.assertEqual(rows[0].days_until_expiry, -2)
        self.assertEqual(rows[1].used_units, 0)
        self.assertIsNone(rows[1].days_until_expiry)
        sql, params = db.queries[-1]
        self.assertIn('sa.agency_id = :_agy_id', sql)
        self.assertIn('c.agency_id = sa.agency_id', sql)
        self.assertIn('sa.is_active = 1 AND c.is_active = 1', sql)
        self.assertEqual(params['_agy_id'], 1)

    def test_super_admin_scope(self):
        rows = dashboard.get_dashboard_authorizations(AuthorizationDB(), AgencyScope(user('super_admin', None)))
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[-1].used_units, 25.5)

    def test_authentication_and_missing_agency(self):
        db = AuthorizationDB()
        app = FastAPI()
        app.include_router(dashboard.router, prefix='/api/dashboard')
        app.dependency_overrides[get_db] = lambda: db
        self.assertIn(asyncio.run(request(app, 'GET', '/api/dashboard/authorizations')), (401, 403))
        self.assertEqual(db.queries, [])
        app.dependency_overrides[get_current_user] = lambda: user(agency_id=None)
        self.assertEqual(asyncio.run(request(app, 'GET', '/api/dashboard/authorizations')), 403)

    def test_new_client_count_has_both_month_boundaries_and_tenant_scope(self):
        class MetricsDB:
            def __init__(self):
                self.client_query = None

            def execute(self, query, params=None):
                sql = str(query)
                if 'AS active_clients' in sql:
                    self.client_query = (sql, params)
                    return Result(SimpleNamespace(active_clients=8, expiring_soon=0, new_this_month=3))
                return Result(SimpleNamespace(scheduled_this_week=0, open_shifts=0,
                    total_hours=0, pending_approval=0, evv_processed=0, evv_verified=0,
                    evv_incomplete=0, evv_omit=0, pending_submissions=0,
                    rejected_submissions=0, evv_exceptions=0, urgent_exceptions=0))

        db = MetricsDB()
        metrics = dashboard.get_dashboard_metrics(db, AgencyScope(user()))
        self.assertEqual(metrics.newClientsThisMonth, 3)
        sql, params = db.client_query
        self.assertIn('created_at >= DATEFROMPARTS(', sql)
        self.assertIn('created_at < DATEADD(MONTH, 1, DATEFROMPARTS(', sql)
        self.assertIn('agency_id = :_agy_id', sql)
        self.assertEqual(params['_agy_id'], 1)


if __name__ == '__main__':
    unittest.main()
