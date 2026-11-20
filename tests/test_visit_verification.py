import os
import re
import sqlite3
import unittest
from datetime import datetime, timedelta

os.environ.setdefault('SECRET_KEY', 'test-only-verification-secret')
from backend.services.visit_verification import summary_query


class VisitVerificationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS care")
        self.db.executescript('''
            CREATE TABLE care.visits(id INT, agency_id INT, client_id INT, employee_id INT, service_code_id INT, schedule_id INT, service_date TEXT, visit_cancelled INT);
            CREATE TABLE care.employees(id INT, agency_id INT);
            CREATE TABLE care.clients(id INT, agency_id INT);
            CREATE TABLE care.service_codes(id INT, is_evv_required INT);
            CREATE TABLE care.visit_evv(visit_id INT, evv_status TEXT, call_in_datetime TEXT, call_out_datetime TEXT, adj_in_datetime TEXT, adj_out_datetime TEXT);
            CREATE TABLE care.visit_billing(visit_id INT, approval_status TEXT);
            CREATE TABLE care.schedules(id INT, agency_id INT, client_id INT, employee_id INT, status TEXT, scheduled_end TEXT);
            INSERT INTO care.employees VALUES (1,4), (2,5);
            INSERT INTO care.clients VALUES (1,4), (2,5);
            INSERT INTO care.service_codes VALUES (1,1), (2,0);
        ''')
        def dateadd(unit, count, value):
            value = datetime.fromisoformat(value)
            return (value + (timedelta(minutes=count) if unit == 'MINUTE' else timedelta(hours=count))).isoformat(sep=' ')
        self.db.create_function('DATEADD', 3, dateadd)

    def visit(self, vid, status='Verified', clock_in='2026-11-18 09:00:00', clock_out='2026-11-18 10:00:00', end='2026-11-18 17:00:00', agency=4, required=True):
        owner = 1 if agency == 4 else 2
        self.db.execute('INSERT INTO care.visits VALUES (?,?,?,?,?,?,?,0)', (vid, agency, owner, owner, 1 if required else 2, vid, '2026-11-18'))
        self.db.execute('INSERT INTO care.visit_evv VALUES (?,?,?,?,NULL,NULL)', (vid, status, clock_in, clock_out))
        self.db.execute('INSERT INTO care.visit_billing VALUES (?,?)', (vid, 'Pending'))
        if end:
            self.db.execute('INSERT INTO care.schedules VALUES (?,?,?,?,?,?)', (vid, agency, owner, owner, 'Scheduled', end))

    def summary(self):
        sql = summary_query('v.agency_id = :agency', ':now')
        # SQLite functions emulate SQL Server date syntax; query classification is unchanged.
        sql = re.sub(r'DATEADD\((MINUTE|HOUR),', r"DATEADD('\1',", sql).replace('ISNULL(', 'IFNULL(').replace('CAST(v.service_date AS DATETIME2)', 'datetime(v.service_date)')
        return dict(self.db.execute(sql, dict(agency=4, now='2026-11-18 14:00:00', clock_grace=30, week_start='2026-11-16', week_end='2026-11-22')).fetchone())

    def test_two_verified_and_one_active_is_one_hundred_percent(self):
        self.visit(1); self.visit(2); self.visit(3, status='Pending', clock_out=None)
        result = self.summary()
        self.assertEqual((result['verified_due'], result['due'], result['in_progress']), (2, 2, 1))
        self.assertEqual((result['exceptions'], result['missing_clock']), (0, 0))

    def test_overdue_missing_clock_out_counts_against_verification(self):
        self.visit(1); self.visit(2); self.visit(3, status='Pending', clock_out=None, end='2026-11-18 12:00:00')
        result = self.summary()
        self.assertEqual((result['verified_due'], result['due'], result['in_progress']), (2, 3, 0))
        self.assertEqual((result['exceptions'], result['missing_clock']), (1, 1))

    def test_exempt_foreign_and_cancelled_visits_do_not_lower_rate(self):
        self.visit(1); self.visit(2, status='Exempt', required=False); self.visit(3, status='Failed', agency=5); self.visit(4, status='Failed')
        self.db.execute('UPDATE care.visits SET visit_cancelled=1 WHERE id=4')
        result = self.summary()
        self.assertEqual((result['total'], result['due'], result['verified_due'], result['exempt']), (2, 1, 1, 1))

    def test_full_period_counts_exceed_one_table_page(self):
        for i in range(25):
            self.visit(i + 1)
        self.assertEqual(self.summary()['verified_due'], 25)

    def test_unscheduled_stale_clock_in_is_not_excluded_forever(self):
        self.visit(1, status='Pending', clock_in='2026-11-16 08:00:00', clock_out=None, end=None)
        self.assertEqual((self.summary()['overdue'], self.summary()['due']), (1, 1))

    def test_empty_period_has_no_fabricated_compliance_score(self):
        self.assertEqual((self.summary()['due'], self.summary()['verified_due']), (0, 0))


if __name__ == '__main__':
    unittest.main()
