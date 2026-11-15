import os
import sqlite3
import unittest
from contextlib import closing
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault('SECRET_KEY', 'test-only-active-visits-secret')

from fastapi import HTTPException
from backend.auth.dependencies import AgencyScope
from backend.routers import schedule, timesheets
from backend.schemas import TimesheetAppliedPeriod
from test_client_tenant_access import Result, user


class ScheduleDB:
    def __init__(self):
        self.entry_query = ''

    def execute(self, query, params=None):
        sql = str(query)
        if 'FROM care.schedules s' in sql:
            self.entry_query = sql
            return Result(rows=[])
        if 'pending_clock_out' in sql:
            return Result(SimpleNamespace(pending_clock_out=0))
        raise AssertionError(sql)


class ActiveVisitTests(unittest.TestCase):
    def test_schedule_progress_comes_from_matching_uncancelled_clock_events(self):
        db = ScheduleDB()
        schedule.get_week_schedule('2026-11-14', db, AgencyScope(user(agency_id=1)))
        expression = 'CASE WHEN EXISTS (' + db.entry_query.split('CASE WHEN EXISTS (', 1)[1].split('END AS status', 1)[0] + 'END'
        # Execute the actual status expression against clock-event fixtures.
        with closing(sqlite3.connect(':memory:')) as connection:
            connection.execute("ATTACH DATABASE ':memory:' AS care")
            connection.executescript('''
                CREATE TABLE care.schedules(id INT, agency_id INT, client_id INT, employee_id INT, status TEXT);
                CREATE TABLE care.visits(id INT, schedule_id INT, agency_id INT, client_id INT, employee_id INT, visit_cancelled INT);
                CREATE TABLE care.visit_evv(visit_id INT, call_in_datetime TEXT, call_out_datetime TEXT, adj_in_datetime TEXT, adj_out_datetime TEXT);
            ''')
            for number in range(1, 7):
                connection.execute('INSERT INTO care.schedules VALUES (?,1,10,20,?)', (number, 'Completed' if number == 2 else 'Scheduled'))
            connection.executemany('INSERT INTO care.visits VALUES (?,?,?,?,?,?)', [
                (1,1,1,10,20,0), (2,2,1,10,20,0), (3,3,1,10,20,1),
                (4,4,2,10,20,0), (5,5,1,10,20,0),
            ])
            connection.executemany('INSERT INTO care.visit_evv VALUES (?,?,?,?,?)', [
                (1,'09:00',None,None,None), (2,'09:00','11:00',None,None),
                (3,'09:00',None,None,None), (4,'09:00',None,None,None),
                (5,None,None,'09:00',None),
            ])
            rows = connection.execute(f'SELECT s.id, {expression} FROM care.schedules s ORDER BY s.id').fetchall()
        self.assertEqual(rows, [(1,'In Progress'), (2,'Completed'), (3,'Scheduled'), (4,'Scheduled'), (5,'In Progress'), (6,'Scheduled')])

    def test_timesheets_always_use_live_visits_instead_of_mirror_counts(self):
        with patch.object(timesheets, 'ensure_default_pay_group'), \
             patch.object(timesheets, '_query_visits_fallback', return_value='live') as live, \
             patch.object(timesheets, '_timesheet_table_exists', return_value=True) as mirror:
            result = timesheets.get_timesheets(1, 20, 'current', '', '', object(), AgencyScope(user(agency_id=1)))
        self.assertEqual(result, 'live')
        live.assert_called_once()
        mirror.assert_not_called()

    def test_live_timesheet_query_includes_active_pending_visits_in_the_agency(self):
        row = SimpleNamespace(visit_id=1, employee_code='EMP1', first_name='Sarah', last_name='Mills', department_code='DSP',
            client_name='Test Client', client_id='10', service_date='2026-11-14', service_type='W7076',
            scheduled_start='09:00 AM', scheduled_end='11:00 AM', clock_in='09:05 AM', clock_out=None,
            total_hours=0, regular_hours=0, ot_hours=0, has_gps_in=1, has_gps_out=0,
            clock_in_lat=40, clock_in_lon=-75, clock_out_lat=None, clock_out_lon=None,
            evv_status='Pending', approval_status='Pending', place_of_service='12', notes='', pay_rate=25, gross_pay=0)
        queries = []
        class LiveDB:
            def execute(self, query, params):
                sql = str(query)
                queries.append(sql)
                assert params['_agy_id'] == 1
                assert 'e.agency_id = v.agency_id' in sql and 'c.agency_id = v.agency_id' in sql
                assert "ISNULL(vb.approval_status, 'Pending') = :status" in sql
                if 'AS total_records' in sql:
                    return Result(SimpleNamespace(total_records=1, total_hours=0, pending=1, approved=0, exceptions=0))
                if 'COUNT(*) AS total' in sql:
                    return Result(SimpleNamespace(total=1))
                return Result(rows=[row])
        period = TimesheetAppliedPeriod(selection='current', label='This Week', start_date='2026-11-09', end_date='2026-11-15')
        with patch.object(timesheets, '_resolved_bounds', return_value=(date(2026,11,9), date(2026,11,15), period)):
            response = timesheets._query_visits_fallback(1,20,'current','','Pending',LiveDB(),AgencyScope(user(agency_id=1)))
        self.assertEqual(response.total, 1)
        self.assertEqual(response.stats.pending, 1)
        self.assertIsNone(response.items[0].clock_out)
        self.assertEqual(response.items[0].approval_status, 'Pending')
        self.assertFalse(any('call_out_datetime IS NOT NULL\n        WHERE' in sql for sql in queries))

    def test_in_progress_timesheets_cannot_be_approved(self):
        class ApprovalDB:
            def execute(self, query, params):
                assert 'v.agency_id = :_agy_id' in str(query)
                return Result(SimpleNamespace(id=1, approval_status='Pending', clock_in=datetime(2026,11,14,9), clock_out=None))
        with self.assertRaises(HTTPException) as error:
            timesheets.approve_timesheet(1, ApprovalDB(), AgencyScope(user(agency_id=1)))
        self.assertEqual(error.exception.status_code, 422)
        self.assertIn('clock-out', error.exception.detail)


if __name__ == '__main__':
    unittest.main()
