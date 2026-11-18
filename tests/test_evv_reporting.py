import os
import sqlite3
import unittest
from unittest.mock import patch

from backend.services.evv_reporting import SCHEDULE_JOIN_SQL, clock_out_grace_minutes, exception_predicate


class EvvReportingTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS care")
        self.db.execute('CREATE TABLE care.visits (id, schedule_id, agency_id, client_id, employee_id, visit_cancelled)')
        self.db.execute('CREATE TABLE care.schedules (id, agency_id, client_id, employee_id, status, scheduled_end)')
        self.db.execute('CREATE TABLE care.visit_evv (visit_id, evv_status, call_in_datetime, call_out_datetime, adj_in_datetime, adj_out_datetime)')
        self.db.execute('INSERT INTO care.visits VALUES (1, 10, 1, 20, 30, 0)')
        self.db.execute("INSERT INTO care.schedules VALUES (10, 1, 20, 30, 'Scheduled', '2026-11-15 12:00:00')")
        self.db.execute("INSERT INTO care.visit_evv VALUES (1, 'Pending', '2026-11-15 10:00:00', NULL, NULL, NULL)")

    def count(self, now='2026-11-15 12:15:00', grace=30):
        # Run the production predicate and tenant-safe schedule join. Only the
        # engine-specific date arithmetic differs from SQL Server.
        predicate = exception_predicate(now_sql=':now', deadline_sql="datetime(s.scheduled_end, '+' || :grace || ' minutes')")
        return self.db.execute(f'''
            SELECT COUNT(CASE WHEN {predicate} THEN 1 END)
            FROM care.visits v LEFT JOIN care.visit_evv ev ON ev.visit_id=v.id
            {SCHEDULE_JOIN_SQL}
            WHERE v.agency_id=1 AND v.visit_cancelled=0
        ''', {'now': now, 'grace': grace}).fetchone()[0]

    def test_normal_active_shift_and_grace_period_are_not_exceptions(self):
        self.assertEqual(self.count('2026-11-15 11:00:00'), 0)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.count('2026-11-15 12:30:00'), 0)
        self.assertEqual(self.count('2026-11-15 12:30:01'), 1)

    def test_grace_is_configurable(self):
        self.assertEqual(self.count(grace=0), 1)
        self.assertEqual(self.count(grace=60), 0)
        for raw, expected in [('15', 15), ('0', 0), ('-5', 0), ('invalid', 30)]:
            with patch.dict(os.environ, {'EVV_CLOCK_OUT_GRACE_MINUTES': raw}):
                self.assertEqual(clock_out_grace_minutes(), expected)

    def test_completed_pending_verification_is_not_an_exception(self):
        self.db.execute("UPDATE care.visit_evv SET call_out_datetime='2026-11-15 12:00:00'")
        self.assertEqual(self.count('2026-11-16 12:00:00'), 0)

    def test_adjusted_clock_out_resolves_overdue_exception(self):
        self.assertEqual(self.count('2026-11-16 12:00:00'), 1)
        self.db.execute("UPDATE care.visit_evv SET adj_out_datetime='2026-11-15 12:00:00'")
        self.assertEqual(self.count('2026-11-16 12:00:00'), 0)

    def test_failed_validation_is_an_exception_even_before_scheduled_end(self):
        self.db.execute("UPDATE care.visit_evv SET evv_status='Failed'")
        self.assertEqual(self.count('2026-11-15 11:00:00'), 1)

    def test_verified_adjusted_and_exempt_are_not_overdue_exceptions(self):
        for status in ('Verified', 'Adjusted', 'Exempt'):
            self.db.execute('UPDATE care.visit_evv SET evv_status=?', (status,))
            self.assertEqual(self.count('2026-11-16 12:00:00'), 0)

    def test_unmatched_or_cancelled_schedule_does_not_infer_overdue(self):
        for column, value in [('agency_id', 2), ('client_id', 99), ('employee_id', 99), ('status', 'Cancelled')]:
            with self.subTest(column=column):
                self.db.execute('SAVEPOINT test_schedule')
                self.db.execute(f'UPDATE care.schedules SET {column}=?', (value,))
                self.assertEqual(self.count('2026-11-16 12:00:00'), 0)
                self.db.execute('ROLLBACK TO test_schedule')
        self.db.execute('DELETE FROM care.schedules')
        self.assertEqual(self.count('2026-11-16 12:00:00'), 0)

    def test_cancelled_and_other_agency_visits_are_excluded(self):
        self.db.execute("UPDATE care.visit_evv SET evv_status='Failed'")
        self.db.execute('UPDATE care.visits SET visit_cancelled=1')
        self.assertEqual(self.count(), 0)
        self.db.execute('UPDATE care.visits SET visit_cancelled=0, agency_id=2')
        self.assertEqual(self.count(), 0)


if __name__ == '__main__':
    unittest.main()
