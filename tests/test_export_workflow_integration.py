"""Opt-in SQL Server checks. Batch/file writes stay inside an outer rollback."""
import os
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

os.environ.setdefault('SECRET_KEY', 'test-only-export-integration-secret')
from backend.auth.dependencies import AgencyScope
from backend.routers import exports
from backend.services.data_exports import read_export_rows
from backend.routers.visits import get_visits
from test_export_rules import good_row


@unittest.skipUnless(os.getenv('RUN_EXPORT_DB_TESTS') == '1', 'Opt-in SQL Server export test')
class ExportWorkflowIntegrationTests(unittest.TestCase):
    def test_sql_scope_idempotence_independent_exports_and_immutable_downloads(self):
        with exports_engine().connect() as conn:
            transaction = conn.begin()
            db = Session(bind=conn, join_transaction_mode='create_savepoint')
            try:
                sample = db.execute(text('''SELECT TOP 1 v.id, v.agency_id, v.service_date, v.employee_id, v.client_id
                    FROM care.visits v JOIN care.agencies a ON a.id = v.agency_id
                    WHERE a.is_active = 1 AND v.visit_cancelled = 0 AND v.service_date IS NOT NULL ORDER BY v.id DESC''')).fetchone()
                self.assertIsNotNone(sample)
                aid = sample.agency_id
                scope = AgencyScope(SimpleNamespace(id=0, username='rollback.integration.test', agency_id=aid, role='agency_admin'))
                start = sample.service_date.replace(day=1)
                from calendar import monthrange
                end = sample.service_date.replace(day=monthrange(sample.service_date.year, sample.service_date.month)[1])
                # Execute both actual readiness SQL paths to verify all live column and tenant joins.
                original = read_export_rows(db, aid, 'billing', start, end)
                self.assertTrue(all(r['agency_id'] == aid for r in original))
                read_export_rows(db, aid, 'payroll', start, end)
                all_visits = get_visits(page=1, per_page=1, week=sample.service_date.isoformat(), search='', status='', aggregator='', db=db, scope=scope)
                filtered = get_visits(page=2, per_page=1, week=sample.service_date.isoformat(), search='no-such-visit', status='Verified', aggregator='', db=db, scope=scope)
                self.assertEqual(all_visits.summary, filtered.summary)
                self.assertGreaterEqual(all_visits.summary.total, len(all_visits.items))

                # Synthetic eligible snapshots use real FK IDs only. No visits, approvals,
                # caregiver pay settings, or aggregator records are changed by this test.
                row = good_row(visit_id=sample.id, agency_id=aid, employee_id=sample.employee_id, client_id=sample.client_id, service_date=sample.service_date)
                def synthetic_rows(session, agency, kind, period_start, period_end):
                    existing = session.execute(text('SELECT export_id, snapshot_json FROM care.data_export_items WHERE agency_id=:agency AND kind=:kind AND visit_id=:visit'),
                                               {'agency': agency, 'kind': kind, 'visit': sample.id}).fetchone()
                    return [row | {'export_id': existing.export_id if existing else None, 'exported_snapshot_json': existing.snapshot_json if existing else None}]

                with patch.object(exports, 'period_bounds', return_value=(start, end)), patch.object(exports, 'read_export_rows', side_effect=synthetic_rows):
                    billing = exports.ExportCreate(kind='billing', period='this_month', request_id=uuid4())
                    first = exports.create_export(billing, db, scope)
                    repeated = exports.create_export(billing, db, scope)
                    self.assertEqual(first['id'], repeated['id'])
                    downloaded = exports.download_export(first['id'], db, scope).body
                    payroll = exports.create_export(exports.ExportCreate(kind='payroll', period='pay_current', request_id=uuid4()), db, scope)
                    self.assertNotEqual(first['id'], payroll['id'])
                    self.assertEqual(exports.get_readiness('billing', 'this_month', db, scope)['stats']['exported'], 1)
                    self.assertEqual(exports.get_readiness('payroll', 'pay_current', db, scope)['stats']['exported'], 1)
                    row['billing_rate'] = 999
                    self.assertEqual(exports.download_export(first['id'], db, scope).body, downloaded)
                    detail = exports.get_export(first['id'], db, scope)
                    self.assertEqual(detail['items'][0]['visit_id'], sample.id)
                    self.assertEqual(detail['items'][0]['data']['Estimated Amount'], '120.00')
                    foreign = AgencyScope(SimpleNamespace(id=0, username='other', agency_id=aid + 100000, role='agency_admin'))
                    from fastapi import HTTPException
                    with self.assertRaises(HTTPException) as error:
                        exports.download_export(first['id'], db, foreign)
                    self.assertEqual(error.exception.status_code, 404)
                    history = exports.list_exports('billing', page=1, per_page=20, db=db, scope=scope)
                    self.assertTrue(any(b['id'] == first['id'] for b in history['items']))
                    with self.assertRaises(HTTPException) as error:
                        exports.create_export(exports.ExportCreate(kind='billing', period='this_month', request_id=uuid4(), visit_ids=[sample.id]), db, scope)
                    self.assertEqual(error.exception.status_code, 409)
            finally:
                db.close()
                transaction.rollback()


def exports_engine():
    from db.database import engine
    return engine


if __name__ == '__main__':
    unittest.main()
