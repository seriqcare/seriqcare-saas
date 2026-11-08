import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-only-care-plan-secret")

from backend.auth.dependencies import AgencyScope
from backend.routers.clients import get_clients
from test_client_tenant_access import Result, user


class ClientListDB:
    def __init__(self):
        self.queries = []

    def execute(self, query, params=None):
        sql = str(query)
        self.queries.append((sql, params or {}))
        if "AS assigned_caregivers" in sql:
            return Result(SimpleNamespace(total_clients=2, new_this_month=0, active_care_plans=1,
                                          due_for_review=0, assigned_caregivers=0, multi_staff_cases=0,
                                          doc_flags=1, urgent_followup=0))
        if "AS care_plan_review_date" in sql:
            def client(client_id, review_date, status):
                return SimpleNamespace(
                    id=client_id, client_code=str(client_id), name="Client", age=None,
                    city=None, state=None, status="Active", service_type=None,
                    primary_caregiver=None, next_visit=None, care_plan_status=status,
                    care_plan_review_date=review_date,
                )
            return Result(rows=[client(1, None, "No Plan"), client(2, "2026-12-01", "Up to date")])
        raise AssertionError(f"Unexpected query: {sql}")


class CarePlanReviewDateTests(unittest.TestCase):
    def test_client_list_returns_saved_date_or_null(self):
        db = ClientListDB()
        response = get_clients(page=1, per_page=20, status="", search="", db=db, scope=AgencyScope(user()))
        self.assertEqual([(item.care_plan_status, item.care_plan_review_date) for item in response.items],
                         [("No Plan", None), ("Up to date", "2026-12-01")])
        sql, params = db.queries[1]
        self.assertIn("c.agency_id = :_agy_id", sql)
        self.assertEqual(params["_agy_id"], 1)


if __name__ == "__main__":
    unittest.main()
