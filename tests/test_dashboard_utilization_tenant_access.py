import asyncio
import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-only-dashboard-secret")

from fastapi import FastAPI

from backend.auth.dependencies import AgencyScope, get_current_user
from backend.routers import dashboard
from db.database import get_db
from test_client_tenant_access import Result, request, user


class FakeDB:
    def __init__(self):
        self.queries = []

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        self.queries.append((sql, params))
        if "SELECT tier FROM care.agencies" in sql:
            return Result(SimpleNamespace(tier="core"))
        self.assert_sql(sql)
        records = [
            (1, SimpleNamespace(id=5, name="Agency One", scheduled_hours=20)),
            (1, SimpleNamespace(id=6, name="Unscheduled", scheduled_hours=0)),
            (2, SimpleNamespace(id=7, name="Agency Two", scheduled_hours=50)),
        ]
        return Result(rows=[row for agency, row in records if params.get("_agy_id", agency) == agency])

    @staticmethod
    def assert_sql(sql):
        assert "s.agency_id = e.agency_id" in sql
        assert "c.agency_id = s.agency_id" in sql
        assert "s.status <> 'Cancelled'" in sql
        assert "s.scheduled_start < DATEADD(DAY, 7," in sql
        assert "e.is_active = 1" in sql


class DashboardUtilizationTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.app = FastAPI()
        self.app.include_router(dashboard.router, prefix="/api/dashboard")
        self.app.dependency_overrides[get_db] = lambda: self.db

    def call(self):
        return asyncio.run(request(self.app, "GET", "/api/dashboard/caregiver-utilization"))

    def test_authentication_and_missing_agency_are_rejected(self):
        self.assertIn(self.call(), (401, 403))
        self.assertEqual(self.db.queries, [])
        self.app.dependency_overrides[get_current_user] = lambda: user(agency_id=None)
        self.assertEqual(self.call(), 403)

    def test_only_own_agency_is_returned_and_percent_is_scheduled_hours(self):
        scope = AgencyScope(user(), self.db)
        rows = dashboard.get_caregiver_utilization(self.db, scope)
        self.assertEqual([(r.employee_id, r.scheduled_hours, r.utilization_pct) for r in rows],
                         [(5, 20.0, 50.0), (6, 0.0, 0.0)])
        self.assertIn("e.agency_id = :_agy_id", self.db.queries[-1][0])
        self.assertEqual(self.db.queries[-1][1]["_agy_id"], 1)

    def test_super_admin_can_see_multiple_agencies_and_over_capacity(self):
        scope = AgencyScope(user("super_admin", None), self.db)
        rows = dashboard.get_caregiver_utilization(self.db, scope)
        self.assertEqual([r.employee_id for r in rows], [5, 6, 7])
        self.assertEqual(rows[-1].utilization_pct, 125)
        self.assertNotIn("_agy_id", self.db.queries[-1][1])


if __name__ == "__main__":
    unittest.main()
