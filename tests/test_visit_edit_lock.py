import os
import unittest
from types import SimpleNamespace

os.environ.setdefault('SECRET_KEY', 'test-visit-edit-lock')
from fastapi import HTTPException
from backend.auth.dependencies import AgencyScope
from backend.routers import visits
from backend.schemas import VisitFixRequest
from test_client_tenant_access import Result, user


class VisitEditLockTests(unittest.TestCase):
    def test_submitted_visit_cannot_be_corrected_through_direct_api_call(self):
        class DB:
            def __init__(self): self.queries = []
            def execute(self, sql, params):
                self.queries.append(str(sql))
                return Result(SimpleNamespace(id=10, evv_status='Pending', service_date='2026-11-17', edit_locked=True))
            def rollback(self): pass
        db = DB()
        with self.assertRaises(HTTPException) as caught:
            visits.fix_visit(10, VisitFixRequest(reason='Correction'), db, AgencyScope(user()))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertFalse(any('UPDATE ' in sql for sql in db.queries))


if __name__ == '__main__': unittest.main()
