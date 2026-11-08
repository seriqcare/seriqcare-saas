import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-only-tenant-secret")

from fastapi import FastAPI, HTTPException

from backend.auth.dependencies import AgencyScope, get_current_user
from backend.routers import billing, caregivers, clients, schedule
from db.database import get_db
from test_client_tenant_access import Result, request, user


class FakeDB:
    def __init__(self):
        self.queries = []
        self.commits = 0

    def execute(self, query, params=None):
        sql, params = str(query), dict(params or {})
        self.queries.append((sql, params))
        if "SELECT tier FROM care.agencies" in sql:
            return Result(SimpleNamespace(tier="standard"))
        if "SELECT e.id FROM care.employees e" in sql:
            agency = {5: 1, 6: 2}.get(params["id"])
            return Result(SimpleNamespace(id=params["id"]) if agency and params.get("_agy_id", agency) == agency else None)
        if "SELECT c.id, c.agency_id FROM care.clients" in sql:
            agency = {10: 1, 20: 2}.get(params["client_id"])
            return Result(SimpleNamespace(id=params["client_id"], agency_id=agency)
                          if agency and params.get("_agy_id", agency) == agency else None)
        if "SELECT id, agency_id" in sql and "FROM care.schedules" in sql:
            agency = {100: 1, 200: 2}.get(params["schedule_id"])
            return Result(SimpleNamespace(id=params["schedule_id"], agency_id=agency)
                          if agency and params.get("_agy_id", agency) == agency else None)
        if "FROM care.employees" in sql and ":employee_id" in sql:
            agency = {5: 1, 6: 2}.get(params["employee_id"])
            return Result(SimpleNamespace(id=params["employee_id"]) if agency == params["agency_id"] else None)
        if "FROM care.service_codes" in sql and "SELECT TOP 1 id" in sql:
            return Result(SimpleNamespace(id=1))
        if "INSERT INTO care.schedules" in sql:
            return Result(SimpleNamespace(id=101))
        if "FROM care.employees e" in sql and "employee_payroll_settings" in sql:
            return Result(SimpleNamespace(pay_group_id=None, pay_group_rate_id=None, pay_group_name=None,
                                          pay_rate_name=None, pay_type=None, pay_rate=None))
        if "FROM care.employee_payroll_settings WHERE" in sql:
            return Result()
        if "FROM care.visits v" in sql and "AS week_start" in sql:
            assert "v.agency_id = :_agy_id" in sql or params.get("_agy_id") is None
            assert "c.agency_id = v.agency_id" in sql and "e.agency_id = v.agency_id" in sql
            records = [
                SimpleNamespace(visit_id=10, agency_id=1, client_id=10, client_name="A", payer="private",
                                service_authorization_id=None, week_start="2026-01-05", units=2, amount=20),
                SimpleNamespace(visit_id=20, agency_id=2, client_id=20, client_name="B", payer="private",
                                service_authorization_id=None, week_start="2026-01-05", units=3, amount=30),
            ]
            return Result(rows=[r for r in records if params.get("_agy_id", r.agency_id) == r.agency_id])
        if "WHERE v.id IN (" in sql:
            assert "c.agency_id = v.agency_id" in sql and "e.agency_id = v.agency_id" in sql
            ids = sql.split("WHERE v.id IN (", 1)[1].split(")", 1)[0].split(",")
            records = [SimpleNamespace(id=vid, agency_id=agency, units=1, amount=10)
                       for vid, agency in ((10, 1), (20, 2)) if str(vid) in ids]
            return Result(rows=[r for r in records if params.get("_agy_id", r.agency_id) == r.agency_id])
        if "INSERT INTO care.billing_claims" in sql:
            return Result(SimpleNamespace(id=1000 + params["agency_id"]))
        if "FROM care.billing_claims bcl" in sql and "bcl.id = :claim_id" in sql:
            agency = {10: 1, 20: 2}.get(params["claim_id"])
            if agency and params.get("_agy_id", agency) == agency:
                return Result(SimpleNamespace(id=params["claim_id"], status="Draft", total_units=1,
                                              total_amount=10, claim_date="2026-01-01", payer="private",
                                              created_at="2026-01-01", visit_count=1))
            return Result()
        if "AS assigned_caregivers" in sql:
            return Result(SimpleNamespace(total_clients=0, new_this_month=0, active_care_plans=0,
                                          due_for_review=0, assigned_caregivers=0, multi_staff_cases=0,
                                          doc_flags=0, urgent_followup=0))
        return Result()

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


class RemainingTenantTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.app = FastAPI()
        for router, prefix in [(billing.router, "/billing"), (caregivers.router, "/caregivers"),
                               (clients.router, "/clients"), (schedule.router, "/schedule")]:
            self.app.include_router(router, prefix=prefix)
        self.app.dependency_overrides[get_db] = lambda: self.db

    def auth(self, role="coordinator", agency=1, employee=None):
        self.app.dependency_overrides[get_current_user] = lambda: user(role, agency, employee)

    def call(self, method, path, body=None):
        return asyncio.run(request(self.app, method, path, body))

    def test_scope_fails_closed_for_all_non_super_roles(self):
        for role in ("coordinator", "agency_admin", "caregiver"):
            with self.assertRaises(HTTPException) as exc:
                AgencyScope(user(role, None))
            self.assertEqual(exc.exception.status_code, 403)
        self.assertTrue(AgencyScope(user("super_admin", None)).is_global)
        self.auth(agency=None)
        self.assertEqual(self.call("GET", "/clients"), 403)

    def test_bulk_and_status_require_auth_and_restrict_agency(self):
        endpoints = [("GET", "/billing/group-visits", None),
                     ("POST", "/billing/generate-bulk", {"period": "this_month"}),
                     ("PATCH", "/billing/claims/20/status", {"status": "Ready"})]
        for method, path, body in endpoints:
            self.assertIn(self.call(method, path, body), (401, 403))
        self.auth(agency=None)
        for method, path, body in endpoints:
            self.assertEqual(self.call(method, path, body), 403)
        self.auth()
        self.assertEqual(self.call("GET", "/billing/group-visits"), 200)
        self.assertEqual(self.call("POST", "/billing/generate-bulk", {"period": "this_month"}), 200)
        inserts = [p for sql, p in self.db.queries if "INSERT INTO care.billing_claims" in sql]
        self.assertEqual([p["agency_id"] for p in inserts], [1])
        self.assertEqual(self.call("PATCH", "/billing/claims/20/status", {"status": "Ready"}), 404)
        self.assertEqual(self.call("PATCH", "/billing/claims/10/status", {"status": "Ready"}), 200)
        update = next(p for sql, p in self.db.queries if "UPDATE care.billing_claims" in sql)
        self.assertEqual(update["_agy_id"], 1)
        self.auth("super_admin", None)
        self.assertEqual(self.call("PATCH", "/billing/claims/20/status", {"status": "Ready"}), 200)
        self.assertEqual(self.call("POST", "/billing/generate-bulk", {"period": "this_month"}), 200)
        inserts = [p for sql, p in self.db.queries if "INSERT INTO care.billing_claims" in sql]
        self.assertEqual([p["agency_id"] for p in inserts], [1, 1, 2])

    def test_single_claim_rejects_mixed_or_foreign_visits(self):
        self.auth()
        self.assertEqual(self.call("POST", "/billing/generate", {"visit_ids": [10, 20], "payer": "private"}), 404)
        self.assertEqual(self.call("POST", "/billing/generate", {"visit_ids": [10], "payer": "private"}), 200)
        self.auth("super_admin", None)
        self.assertEqual(self.call("POST", "/billing/generate", {"visit_ids": [10, 20], "payer": "private"}), 400)
        self.assertEqual(self.call("POST", "/billing/generate", {"visit_ids": [20], "payer": "private"}), 200)
        inserts = [p for sql, p in self.db.queries if "INSERT INTO care.billing_claims" in sql]
        self.assertEqual([p["agency_id"] for p in inserts], [1, 2])

    def test_caregiver_payroll_requires_owned_employee(self):
        for method in ("GET", "PATCH"):
            body = {} if method == "PATCH" else None
            self.assertIn(self.call(method, "/caregivers/5/payroll", body), (401, 403))
        self.auth()
        with patch.object(caregivers, "ensure_default_pay_group") as ensure, \
             patch.object(caregivers, "sync_timesheet_payroll_for_employee"):
            self.assertEqual(self.call("GET", "/caregivers/6/payroll"), 404)
            self.assertEqual(self.call("PATCH", "/caregivers/6/payroll", {}), 404)
            ensure.assert_not_called()
            self.assertEqual(self.call("GET", "/caregivers/5/payroll"), 200)
            self.assertEqual(self.call("PATCH", "/caregivers/5/payroll", {}), 200)
            self.auth("super_admin", None)
            self.assertEqual(self.call("GET", "/caregivers/6/payroll"), 200)

    def test_schedule_links_and_super_admin_agency(self):
        self.auth()
        body = {"client_id": 10, "employee_id": 5, "service_code": "X",
                "scheduled_start": "2026-01-05T10:00:00", "scheduled_end": "2026-01-05T11:00:00"}
        self.assertEqual(self.call("POST", "/schedule", body), 200)
        self.assertEqual(self.call("PATCH", "/schedule/100", body), 200)
        for changes in ({"client_id": 20}, {"employee_id": 6}):
            foreign = dict(body, **changes)
            self.assertEqual(self.call("POST", "/schedule", foreign), 404)
            self.assertEqual(self.call("PATCH", "/schedule/100", foreign), 404)
        self.auth("super_admin", None)
        self.assertEqual(self.call("POST", "/schedule", dict(body, client_id=20, employee_id=6)), 200)
        self.assertEqual(self.call("PATCH", "/schedule/100", dict(body, client_id=20, employee_id=6)), 404)
        inserts = [p for sql, p in self.db.queries if "INSERT INTO care.schedules" in sql]
        self.assertEqual([p["agency_id"] for p in inserts], [1, 2])

    def test_client_stats_scope_all_related_queries(self):
        self.auth()
        self.assertEqual(self.call("GET", "/clients"), 200)
        sql, params = next((sql, p) for sql, p in self.db.queries if "AS assigned_caregivers" in sql)
        self.assertEqual(params["_agy_id"], 1)
        self.assertEqual(sql.count("s.agency_id = :_agy_id"), 2)
        self.assertIn("v.agency_id = :_agy_id", sql)
        self.assertEqual(sql.count("sc_client.agency_id ="), 6)


if __name__ == "__main__":
    unittest.main()
