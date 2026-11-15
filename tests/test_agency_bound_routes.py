import os
import unittest
from datetime import date
from types import SimpleNamespace

os.environ.setdefault('SECRET_KEY', 'test-only-agency-route-secret')

from fastapi import HTTPException
from backend.auth.dependencies import AgencyScope
from backend.routers import mobile_schedules, profile, tasks, timesheets, visits
from backend.schemas import TimesheetUpdateRequest, VisitFixRequest
from test_client_tenant_access import Result, user


class RecordingDB:
    def __init__(self, row=None):
        self.row = row
        self.queries = []

    def execute(self, query, params=None):
        self.queries.append((str(query), dict(params or {})))
        return Result(self.row)

    def rollback(self):
        pass


class AgencyRouteTests(unittest.TestCase):
    def test_mobile_schedule_reads_bind_employee_and_agency(self):
        db = RecordingDB()
        mobile_schedules._fetch_schedules(5, 1, date(2026,11,14), date(2026,11,14), db)
        sql, params = db.queries[0]
        self.assertEqual(params['emp_id'], 5)
        self.assertEqual(params['agency_id'], 1)
        self.assertIn('s.agency_id = :agency_id', sql)
        self.assertIn('c.agency_id = s.agency_id', sql)
        self.assertIn('e.agency_id = s.agency_id', sql)

    def test_matching_employee_id_does_not_grant_cross_agency_task_access(self):
        db = RecordingDB(SimpleNamespace(id=10, employee_id=5, agency_id=2, client_id=20))
        with self.assertRaises(HTTPException) as error:
            tasks._get_schedule_with_access_check(10, user('caregiver',1,5), db)
        self.assertEqual(error.exception.status_code,403)

    def test_profile_schedule_count_is_tenant_scoped(self):
        db = RecordingDB(SimpleNamespace(cnt=0))
        current = user('caregiver',1,5)
        current.is_active = True
        profile.get_my_profile(current, db)
        sql, params = db.queries[0]
        self.assertIn('agency_id = :agency_id',sql)
        self.assertEqual(params['agency_id'],1)

    def test_timesheet_and_visit_corrections_scope_ownership_before_writing(self):
        for operation in (
            lambda db, scope: timesheets.update_timesheet(999, TimesheetUpdateRequest(notes='Correction'),db,scope),
            lambda db, scope: visits.fix_visit(999,VisitFixRequest(reason='Correction'),db,scope),
        ):
            db = RecordingDB()
            with self.assertRaises(HTTPException) as error:
                operation(db,AgencyScope(user(agency_id=1)))
            self.assertEqual(error.exception.status_code,404)
            sql, params = db.queries[0]
            self.assertIn('v.agency_id = :_agy_id',sql)
            self.assertEqual(params['_agy_id'],1)
            self.assertFalse(any('UPDATE ' in sql for sql, _ in db.queries))


if __name__ == '__main__':
    unittest.main()
