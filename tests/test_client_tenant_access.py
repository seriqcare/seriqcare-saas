import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-only-client-tenant-secret")

from fastapi import FastAPI

from backend.auth.dependencies import get_current_user
from backend.routers import clients
from db.database import get_db


class Result:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeDB:
    def __init__(self):
        self.queries = []

    def execute(self, query, params=None):
        sql = str(query)
        params = params or {}
        self.queries.append((sql, params))
        if "SELECT tier FROM care.agencies" in sql:
            return Result(SimpleNamespace(tier="core"))
        if "SELECT c.id FROM care.clients c" in sql:
            client_agency = {10: 1, 20: 2}.get(params["client_id"])
            owned = client_agency is not None and (
                "_agy_id" not in params or params["_agy_id"] == client_agency
            )
            return Result(SimpleNamespace(id=params["client_id"]) if owned else None)
        if "JOIN care.schedules s ON s.client_id = c.id" in sql:
            assigned = params == {"client_id": 10, "agency_id": 1, "employee_id": 5}
            return Result(SimpleNamespace(id=10) if assigned else None)
        return Result()

    def commit(self):
        pass

    def rollback(self):
        pass


def user(role="coordinator", agency_id=1, employee_id=None):
    return SimpleNamespace(
        id=1, role=role, agency_id=agency_id, employee_id=employee_id,
        username="test", display_name="Test",
    )


async def request(app, method, path, body=None):
    payload = json.dumps(body).encode() if body is not None else b""
    messages = []
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": payload, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    await app(
        {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
            "query_string": b"", "root_path": "", "headers": [(b"content-type", b"application/json")],
            "client": ("127.0.0.1", 1), "server": ("test", 80),
        },
        receive,
        send,
    )
    return next(message["status"] for message in messages if message["type"] == "http.response.start")


class ClientTenantAccessTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.app = FastAPI()
        self.app.include_router(clients.router, prefix="/api/clients")
        self.app.dependency_overrides[get_db] = lambda: self.db

    def call(self, method, path, body=None):
        return asyncio.run(request(self.app, method, path, body))

    def authenticate(self, current_user):
        self.app.dependency_overrides[get_current_user] = lambda: current_user

    def endpoints(self, client_id):
        base = f"/api/clients/{client_id}"
        return [
            ("GET", f"{base}/insurance", None),
            ("GET", f"{base}/authorizations", None),
            ("GET", f"{base}/visits", None),
            ("GET", f"{base}/care-tasks", None),
            ("PATCH", f"{base}/care-tasks", {"items": []}),
            ("PUT", f"{base}/care-tasks/12/completion", {"completed": True}),
            ("PUT", base, {"first_name": "Changed"}),
        ]

    def test_anonymous_requests_are_rejected(self):
        for method, path, body in self.endpoints(10):
            with self.subTest(path=path, method=method):
                self.assertIn(self.call(method, path, body), (401, 403))
        self.assertEqual(self.db.queries, [])

    def test_foreign_clients_are_rejected_before_access_or_writes(self):
        self.authenticate(user())
        for method, path, body in self.endpoints(20):
            with self.subTest(path=path, method=method):
                self.assertEqual(self.call(method, path, body), 404)
        self.assertFalse(any("UPDATE " in sql or "INSERT " in sql for sql, _ in self.db.queries))

    def test_unassigned_staff_cannot_gain_global_scope(self):
        self.authenticate(user(agency_id=None))
        for method, path, body in self.endpoints(10):
            with self.subTest(path=path, method=method):
                self.assertEqual(self.call(method, path, body), 403)

    def test_own_agency_can_read_and_update_client(self):
        self.authenticate(user())
        for endpoint in ("insurance", "authorizations", "visits"):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.call("GET", f"/api/clients/10/{endpoint}"), 200)
        self.assertEqual(self.call("PUT", "/api/clients/10", {"first_name": "Updated"}), 200)
        self.assertTrue(any("UPDATE care.clients" in sql for sql, _ in self.db.queries))

    def test_staff_can_read_and_edit_own_client_tasks(self):
        self.authenticate(user())
        response = clients.ClientCareTasksResponse(client_id=10, date="2026-01-01", items=[])
        with patch.object(clients, "_client_care_tasks_table_exists", return_value=True), \
             patch.object(clients, "_read_client_care_tasks", return_value=response):
            self.assertEqual(self.call("GET", "/api/clients/10/care-tasks"), 200)
            self.assertEqual(self.call("PATCH", "/api/clients/10/care-tasks", {"items": []}), 200)

    def test_super_admin_can_access_other_agencies(self):
        self.authenticate(user("super_admin", None))
        self.assertEqual(self.call("GET", "/api/clients/20/insurance"), 200)

    def test_caregiver_completion_requires_an_assigned_same_agency_client(self):
        self.authenticate(user("caregiver", 1, 5))
        with patch.object(clients, "_client_care_tasks_table_exists", return_value=False):
            self.assertEqual(self.call("PUT", "/api/clients/10/care-tasks/12/completion", {"completed": True}), 409)
            self.assertEqual(self.call("PUT", "/api/clients/20/care-tasks/12/completion", {"completed": True}), 404)
        self.authenticate(user("caregiver", 1, 6))
        self.assertEqual(self.call("PUT", "/api/clients/10/care-tasks/12/completion", {"completed": True}), 404)


if __name__ == "__main__":
    unittest.main()
