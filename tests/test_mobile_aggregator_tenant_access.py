import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-only-tenant-secret")

from fastapi import FastAPI

from backend.auth.dependencies import AgencyScope, get_current_user
from backend.routers import aggregator, mobile_visits, visits
from db.database import get_db
from test_client_tenant_access import Result, request, user


class FakeDB:
    def __init__(self):
        self.queries = []
        self.schedule = (1, 5, 1, 1)  # agency, employee, client agency, employee agency
        self.visits = {10: (1, 1, 1), 20: (2, 2, 2), 30: (1, 2, 1)}
        self.open_visit = True
        self.visit_status = "Draft"
        self.provider = "PROVIDER-1"

    def execute(self, query, params=None):
        sql = str(query)
        params = dict(params or {})
        self.queries.append((sql, params))
        if "SELECT tier FROM care.agencies" in sql:
            return Result(SimpleNamespace(tier="standard"))
        if "FROM care.schedules s" in sql:
            agency, employee, client_agency, employee_agency = self.schedule
            assert "c.agency_id = s.agency_id" in sql and "e.agency_id = s.agency_id" in sql
            if (params["sid"] == 10 and params["agency_id"] == agency
                    and params["employee_id"] == employee and agency == client_agency == employee_agency):
                return Result(SimpleNamespace(id=10, client_id=1, agency_id=agency,
                                              service_code_id=1, auth_id=None))
            return Result()
        if "ev.call_out_datetime  IS NULL" in sql:
            if "v.schedule_id" in sql:
                return Result(SimpleNamespace(id=99) if self.open_visit else None)
            if params.get("vid") == 99 and params.get("employee_id") == 5 and params.get("agency_id") == 1:
                return Result(SimpleNamespace(id=99, call_in_datetime=None))
            return Result()
        if "FROM care.aggregator_submissions s" in sql and "s.id = :id" in sql:
            record = {10: (10, 1), 20: (20, 2), 30: (30, 1)}.get(params["id"])
            if record and self.allowed(record[0], params):
                return Result(SimpleNamespace(visit_id=record[0], status="Rejected", aggregator="sandata"))
            return Result()
        if "WHERE v.id = :visit_id AND v.visit_cancelled" in sql:
            assert "e.agency_id = v.agency_id" in sql and "c.agency_id = v.agency_id" in sql
            assert "p.provider_id_sandata = a.sandata_provider_id" in sql
            assert "p.agency_id = v.agency_id" in sql
            if self.allowed(params["visit_id"], params):
                return Result(SimpleNamespace(sandata_status=self.visit_status,
                                              provider_id_sandata=self.provider))
            return Result()
        if "INSERT INTO care.visits" in sql:
            return Result((100,))
        if "FROM care.visits v" in sql or "FROM care.aggregator_submissions s" in sql:
            if "_agy_id" in params:
                assert "v.agency_id = :_agy_id" in sql
            if "COUNT(*) AS cnt" in sql:
                return Result(SimpleNamespace(cnt=sum(self.allowed(v, params) for v in self.visits)))
            if "SELECT v.id" in sql:
                return Result(rows=[SimpleNamespace(id=v) for v in self.visits if self.allowed(v, params)])
            return Result(rows=[])
        return Result()

    def allowed(self, visit_id, params):
        agency, client_agency, employee_agency = self.visits[visit_id]
        return agency == client_agency == employee_agency and (
            "_agy_id" not in params or params["_agy_id"] == agency
        )

    def commit(self):
        pass

    def rollback(self):
        pass


class TenantAccessTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.app = FastAPI()
        self.app.include_router(aggregator.router, prefix="/api/aggregator")
        self.app.include_router(mobile_visits.router, prefix="/api/visits")
        self.app.include_router(visits.router, prefix="/api/portal-visits")
        self.app.dependency_overrides[get_db] = lambda: self.db

    def call(self, method, path, body=None):
        return asyncio.run(request(self.app, method, path, body))

    def auth(self, role="coordinator", agency=1, employee=None):
        self.app.dependency_overrides[get_current_user] = lambda: user(role, agency, employee)

    def test_mobile_clock_in_checks_assignment_and_linked_agencies(self):
        body = {"schedule_id": 10, "latitude": 1, "longitude": 2, "timestamp": "2026-01-01T12:00:00Z"}
        self.assertIn(self.call("POST", "/api/visits/clock-in", body), (401, 403))
        self.auth("caregiver", 1, 5)
        self.assertEqual(self.call("POST", "/api/visits/clock-in", body), 200)
        for schedule in [(2, 5, 2, 2), (1, 6, 1, 1), (1, 5, 2, 1), (1, 5, 1, 2)]:
            self.db.schedule = schedule
            self.assertEqual(self.call("POST", "/api/visits/clock-in", body), 404)
        self.auth("caregiver", None, 5)
        self.assertEqual(self.call("POST", "/api/visits/clock-in", body), 403)
        self.auth("caregiver", 1, None)
        self.assertEqual(self.call("POST", "/api/visits/clock-in", body), 403)

    def test_clock_out_rejects_foreign_visit_before_writes(self):
        body = {"latitude": 1, "longitude": 2, "timestamp": "2026-01-01T12:00:00Z"}
        self.auth("caregiver", 2, 5)
        self.assertEqual(self.call("PUT", "/api/visits/99/clock-out", body), 404)
        self.assertFalse(any("UPDATE " in sql for sql, _ in self.db.queries))

    def test_clock_in_creates_visit_for_matching_assignment(self):
        self.auth("caregiver", 1, 5)
        self.db.open_visit = False
        body = {"schedule_id": 10, "latitude": 1, "longitude": 2, "timestamp": "2026-01-01T12:00:00Z"}
        with patch.object(mobile_visits, "write_audit"):
            self.assertEqual(self.call("POST", "/api/visits/clock-in", body), 200)
        insert = next(params for sql, params in self.db.queries if "INSERT INTO care.visits" in sql)
        self.assertEqual((insert["emp_id"], insert["agy_id"], insert["client_id"]), (5, 1, 1))

    def test_all_aggregator_routes_require_authentication_and_agency(self):
        endpoints = [("GET", "/mode"), ("GET", "/queue"), ("GET", "/submissions"),
                     ("POST", "/submit/10"), ("POST", "/batch"), ("POST", "/submissions/10/retry")]
        for method, path in endpoints:
            self.assertIn(self.call(method, "/api/aggregator" + path), (401, 403))
        self.auth(agency=None)
        for method, path in endpoints:
            self.assertEqual(self.call(method, "/api/aggregator" + path), 403)
        self.auth("caregiver", 1, 5)
        self.assertEqual(self.call("GET", "/api/aggregator/queue"), 403)

    def test_submit_and_retry_reject_foreign_and_cross_linked_visits(self):
        self.auth()
        with patch.object(aggregator.svc, "post_to_sandata") as send, \
             patch.object(aggregator.svc, "post_to_simulator") as simulate:
            for visit_id in (20, 30):
                self.assertEqual(self.call("POST", f"/api/aggregator/submit/{visit_id}"), 404)
                self.assertEqual(self.call("POST", f"/api/aggregator/submissions/{visit_id}/retry"), 404)
            self.assertEqual(self.call("POST", "/api/aggregator/submit/10"), 422)
            self.assertEqual(self.call("POST", "/api/aggregator/submissions/10/retry"), 422)
            self.assertEqual(self.call("POST", "/api/portal-visits/20/submit"), 404)
            send.assert_not_called()
            simulate.assert_not_called()

    def test_queue_history_counts_batch_and_super_admin_scope(self):
        self.auth()
        scope = AgencyScope(user(), self.db)
        history = aggregator.get_submissions(page=1, per_page=20, status="", aggregator="", db=self.db, scope=scope)
        self.assertEqual(history.total, 1)
        self.assertEqual(self.call("GET", "/api/aggregator/queue"), 200)
        self.assertEqual(self.call("GET", "/api/aggregator/submissions"), 200)
        with patch.object(aggregator, "_do_submit", side_effect=lambda vid, db, scope: aggregator.VisitSubmitResponse(
            success=True, visit_id=vid, transaction_id="test", status="Accepted", message="ok"
        )) as submit:
            self.assertEqual(self.call("POST", "/api/aggregator/batch"), 200)
            self.assertEqual([call.args[0] for call in submit.call_args_list], [10])
            submit.reset_mock()
            self.auth("super_admin", None)
            self.assertEqual(self.call("POST", "/api/aggregator/batch"), 200)
            self.assertEqual([call.args[0] for call in submit.call_args_list], [10, 20])
        self.auth(agency=None)
        self.assertEqual(self.call("POST", "/api/portal-visits/10/submit"), 403)

    def test_authorized_submission_and_missing_provider(self):
        self.auth()
        self.db.visit_status = "Ready"
        with patch.object(aggregator.svc, "is_live", return_value=False), \
             patch.object(aggregator.svc, "build_visit_payload", return_value={"provider": "ok"}), \
             patch.object(aggregator.svc, "build_visit_simulator_payload", return_value={}), \
             patch.object(aggregator.svc, "post_to_simulator", return_value=("Success", "200", "ok")) as send, \
             patch.object(aggregator, "_record_submission"), \
             patch.object(aggregator, "_update_sandata_status"):
            self.assertEqual(self.call("POST", "/api/aggregator/submit/10"), 200)
            send.assert_called_once()
            self.db.provider = None
            self.assertEqual(self.call("POST", "/api/aggregator/submit/10"), 422)
            send.assert_called_once()

    def test_live_submission_requires_matching_provider_credentials(self):
        self.auth()
        self.db.visit_status = "Ready"
        with patch.object(aggregator.svc, "is_live", return_value=True), \
             patch.object(aggregator.svc, "live_provider_matches", return_value=False), \
             patch.object(aggregator.svc, "post_to_sandata") as send:
            self.assertEqual(self.call("POST", "/api/aggregator/submit/10"), 422)
            send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
