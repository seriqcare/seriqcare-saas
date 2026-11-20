import os
import asyncio
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

os.environ.setdefault('SECRET_KEY', 'test-only-export-route-secret')
from fastapi import HTTPException
from fastapi import FastAPI
from backend.auth.dependencies import get_current_user
from backend.auth.dependencies import AgencyScope
from backend.routers import exports
from test_export_rules import good_row
from test_client_tenant_access import request, user


def scope(aid=4):
    return AgencyScope(SimpleNamespace(id=8, username='agency.admin', agency_id=aid, role='agency_admin'))


class ExportRouteTests(unittest.TestCase):
    def body(self, **changes):
        return exports.ExportCreate(**(dict(kind='billing', period='this_month', request_id=uuid4()) | changes))

    def header(self, body):
        return dict(id=22, kind=body.kind, provider=body.provider, period_start=date(2026, 11, 1), period_end=date(2026, 11, 30), visit_count=1)

    def setup_db(self, existing=None):
        db = MagicMock()
        lock = MagicMock(); lock.fetchone.return_value = SimpleNamespace(id=4)
        lookup = MagicMock(); lookup.mappings.return_value.first.return_value = existing
        db.execute.side_effect = [lock, lookup]
        return db

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_no_eligible_visits_never_creates_empty_batch(self, _):
        db = self.setup_db()
        with patch.object(exports, 'read_export_rows', return_value=[good_row(approval_status='Pending', evv_status='Pending', sandata_status='Draft', clock_out=None)]), self.assertRaises(HTTPException) as error:
            exports.create_export(self.body(), db, scope())
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(db.execute.call_count, 2)
        db.commit.assert_not_called(); db.rollback.assert_called_once()

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_foreign_or_blocked_selected_visits_are_rejected(self, _):
        for rows, status in [([], 404), ([good_row(approval_status='Pending', evv_status='Pending', sandata_status='Draft', clock_out=None)], 409), ([good_row(export_id=7)], 409)]:
            db = self.setup_db()
            with patch.object(exports, 'read_export_rows', return_value=rows) as read, self.assertRaises(HTTPException) as error:
                exports.create_export(self.body(visit_ids=[10]), db, scope())
            self.assertEqual(error.exception.status_code, status)
            self.assertEqual(read.call_args.args[1], 4)
            db.commit.assert_not_called()

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_repeating_request_returns_existing_batch_without_reexporting(self, _):
        body = self.body()
        db = self.setup_db(self.header(body))
        with patch.object(exports, 'read_export_rows') as read:
            result = exports.create_export(body, db, scope())
        self.assertEqual(result['id'], 22)
        read.assert_not_called()
        db.commit.assert_called_once()

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_request_cannot_be_reused_for_another_export_kind(self, _):
        db = self.setup_db(self.header(self.body()))
        with self.assertRaises(HTTPException) as error:
            exports.create_export(self.body(kind='payroll', period='current'), db, scope())
        self.assertEqual(error.exception.status_code, 409)

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_request_cannot_be_reused_for_different_selected_visits(self, _):
        body = self.body(visit_ids=[11])
        db = self.setup_db(self.header(body))
        saved = MagicMock(); saved.scalars.return_value.all.return_value = [10]
        db.execute.side_effect = list(db.execute.side_effect) + [saved]
        with self.assertRaises(HTTPException) as error:
            exports.create_export(body, db, scope())
        self.assertEqual(error.exception.status_code, 409)
        db.commit.assert_not_called()

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_batch_snapshots_only_eligible_records_with_actual_agency(self, _):
        body = self.body()
        db = self.setup_db()
        calls = list(db.execute.side_effect)
        inserted = MagicMock(); inserted.fetchone.return_value = SimpleNamespace(id=22)
        result = MagicMock(); result.mappings.return_value.first.return_value = self.header(body)
        db.execute.side_effect = calls + [inserted, MagicMock(), result]
        with patch.object(exports, 'read_export_rows', return_value=[good_row(), good_row(visit_id=11, approval_status='Pending', evv_status='Pending', sandata_status='Draft', clock_out=None), good_row(visit_id=12, export_id=9, exported_snapshot_json='{"Estimated Amount": "35.00"}')]):
            batch = exports.create_export(body, db, scope())
        self.assertEqual(batch['id'], 22)
        insert_params = db.execute.call_args_list[2].args[1]
        self.assertEqual(insert_params['count'], 1)
        self.assertEqual(insert_params['amount'], 120)
        self.assertEqual(insert_params['agency_id'], 4)
        item_params = db.execute.call_args_list[3].args[1]
        self.assertEqual(item_params['visit_id'], 10)
        self.assertIn('"Agency ID": 4', item_params['snapshot'])
        self.assertFalse(any('INSERT INTO care.billing_claims' in str(c.args[0]) for c in db.execute.call_args_list))
        db.commit.assert_called_once()

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_readiness_counts_are_independent_of_historical_claims(self, _):
        db = MagicMock()
        with patch.object(exports, 'read_export_rows', return_value=[good_row(), good_row(visit_id=11, approval_status='Pending', evv_status='Pending', sandata_status='Draft', clock_out=None), good_row(visit_id=12, export_id=9, exported_snapshot_json='{"Estimated Amount": "35.00"}')]):
            result = exports.get_readiness('billing', 'this_month', db, scope())
        self.assertEqual(result['stats']['ready'], 1)
        self.assertEqual(result['stats']['blocked'], 1)
        self.assertEqual(result['stats']['exported'], 1)
        self.assertEqual(result['stats']['ready_amount'], 120)
        self.assertEqual(result['stats']['period_amount'], 155)

    @patch.object(exports, 'period_bounds', return_value=(date(2026, 11, 1), date(2026, 11, 30)))
    def test_period_amount_stays_constant_after_export_and_ignores_later_rate_changes(self, _):
        db = MagicMock()
        ready = good_row()
        with patch.object(exports, 'read_export_rows', return_value=[ready]):
            before = exports.get_readiness('billing', 'this_month', db, scope())
        exported = good_row(export_id=22, billing_rate=None, authorization_id=None, exported_snapshot_json='{"Estimated Amount": "120.00"}')
        with patch.object(exports, 'read_export_rows', return_value=[exported]):
            after = exports.get_readiness('billing', 'this_month', db, scope())
        self.assertEqual(before['stats']['period_amount'], after['stats']['period_amount'])
        self.assertEqual(after['stats']['ready_amount'], 0)
        self.assertEqual(after['stats']['period_amount'], 120)

    def test_download_is_scoped_and_reads_the_saved_file_without_recalculation(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(kind='billing', provider='universal', csv_data='Old rate,120\r\n')
        response = exports.download_export(22, db, scope())
        self.assertEqual(response.body.decode('utf-8-sig'), 'Old rate,120\r\n')
        sql, params = db.execute.call_args.args
        self.assertIn('agency_id = :agency_id', str(sql)); self.assertEqual(params['agency_id'], 4)
        db.commit.assert_not_called()
        db.execute.return_value.fetchone.return_value = None
        with self.assertRaises(HTTPException) as error:
            exports.download_export(22, db, scope(5))
        self.assertEqual(error.exception.status_code, 404)

    def test_global_admin_must_enter_an_agency_context(self):
        global_scope = AgencyScope(SimpleNamespace(id=1, username='super', agency_id=None, role='super_admin'))
        db = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exports.get_readiness('billing', 'this_month', db, global_scope)
        self.assertEqual(error.exception.status_code, 403)
        db.execute.assert_not_called()

    def test_export_apis_require_auth_and_do_not_allow_caregiver_access(self):
        app = FastAPI()
        app.include_router(exports.router, prefix='/exports')
        for path in ('/exports/1', '/exports/1/download'):
            result = asyncio.run(request(app, 'GET', path))
            self.assertIn(result, (401, 403))
        app.dependency_overrides[get_current_user] = lambda: user('caregiver', 4, 3)
        for path in ('/exports/1', '/exports/1/download'):
            self.assertEqual(asyncio.run(request(app, 'GET', path)), 403)

    def test_assigning_foreign_or_nonmatching_authorization_is_rejected(self):
        db = MagicMock()
        with patch.object(exports, 'authorization_options', return_value=[{'id': 6}]), self.assertRaises(HTTPException) as error:
            exports.assign_authorization(10, exports.AuthorizationLink(authorization_id=99), db, scope())
        self.assertEqual(error.exception.status_code, 422)
        db.commit.assert_not_called()
        self.assertFalse(any('UPDATE care.visits' in str(c.args[0]) for c in db.execute.call_args_list))

    def test_cannot_change_authorization_of_exported_billing_visit(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(id=22)
        with patch.object(exports, 'authorization_options', return_value=[{'id': 6}]), self.assertRaises(HTTPException) as error:
            exports.assign_authorization(10, exports.AuthorizationLink(authorization_id=6), db, scope())
        self.assertEqual(error.exception.status_code, 409)
        db.commit.assert_not_called()

    def test_assigning_valid_authorization_is_scoped_to_the_visit_agency(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = None
        with patch.object(exports, 'authorization_options', return_value=[{'id': 6}]):
            result = exports.assign_authorization(10, exports.AuthorizationLink(authorization_id=6), db, scope())
        self.assertEqual(result, {'visit_id': 10, 'authorization_id': 6})
        sql, params = db.execute.call_args.args
        self.assertIn('agency_id = :agency_id', str(sql))
        self.assertEqual(params['agency_id'], 4)
        db.commit.assert_called_once()


if __name__ == '__main__':
    unittest.main()
