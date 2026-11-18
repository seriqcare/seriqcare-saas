"""Execute the dashboard count query against real submission histories."""
import os
import sqlite3
import unittest

os.environ.setdefault('SECRET_KEY', 'test-only-dashboard-submission-secret')
from backend.routers.dashboard import _AGGREGATOR_COUNTS_SQL


class DashboardSubmissionCountsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS care")
        self.db.execute('CREATE TABLE care.visits (id INTEGER PRIMARY KEY, agency_id INTEGER, visit_cancelled INTEGER)')
        self.db.execute('CREATE TABLE care.aggregator_submissions (id INTEGER PRIMARY KEY, visit_id INTEGER, aggregator TEXT, status TEXT)')
        self.db.executemany('INSERT INTO care.visits VALUES (?, ?, ?)', [(1, 4, 0), (2, 4, 0), (3, 2, 0), (4, 4, 1)])

    def attempts(self, rows):
        self.db.executemany('INSERT INTO care.aggregator_submissions (visit_id, aggregator, status) VALUES (?, ?, ?)', rows)

    def counts(self, agency=4):
        return self.db.execute(_AGGREGATOR_COUNTS_SQL.format(agency_filter='v.agency_id = :agency_id'), {'agency_id': agency}).fetchone()

    def test_accepted_retry_clears_rejection_but_retains_history(self):
        self.attempts([(1, 'sandata', 'Rejected'), (1, 'sandata', 'Accepted')])
        self.assertEqual(self.counts(), (0, 0))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM care.aggregator_submissions WHERE status = 'Rejected'").fetchone()[0], 1)

    def test_repeated_failures_count_once_and_other_agencies_are_excluded(self):
        self.attempts([(1, 'sandata', 'Rejected'), (1, 'sandata', 'Rejected'), (3, 'sandata', 'Rejected')])
        self.assertEqual(self.counts(), (0, 1))
        self.assertEqual(self.counts(2), (0, 1))

    def test_aggregators_are_independent(self):
        self.attempts([(1, 'hhax', 'Rejected'), (1, 'sandata', 'Accepted')])
        self.assertEqual(self.counts(), (0, 1))

    def test_new_pending_attempt_replaces_old_rejection(self):
        self.attempts([(1, 'sandata', 'Rejected'), (1, 'sandata', 'Pending')])
        self.assertEqual(self.counts(), (1, 0))
        self.attempts([(1, 'sandata', 'Accepted')])
        self.assertEqual(self.counts(), (0, 0))

    def test_unresolved_rejections_remain_visible_and_cancelled_visits_are_excluded(self):
        self.attempts([(1, 'sandata', 'Rejected'), (2, 'sandata', 'Rejected'), (4, 'sandata', 'Rejected')])
        self.assertEqual(self.counts(), (0, 2))


if __name__ == '__main__':
    unittest.main()
