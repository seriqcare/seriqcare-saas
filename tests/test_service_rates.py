import os
import asyncio
import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

os.environ.setdefault('SECRET_KEY', 'test-only-service-rates-secret')
from backend.auth.dependencies import get_agency_scope, get_current_user
from backend.routers.service_rates import router, ServiceRateInput, _save_rate
from backend.routers.billing import _build_groups, generate_claim
from backend.schemas import BillingClaimCreate
from db.database import get_db


class ServiceRateTests(unittest.TestCase):
    def body(self, **changes):
        return ServiceRateInput(**(dict(service_code_id=5, rate_per_unit='12.50',
                                       effective_from='2026-11-01') | changes))

    def scope(self):
        return SimpleNamespace(agency_id=4, user_id=12, sql_filter=lambda alias: f'{alias}.agency_id = :_agy_id',
                               bind=lambda params: params | {'_agy_id': 4})

    def test_invalid_dates_negative_and_excess_precision_rejected(self):
        for changes in [dict(effective_to='2026-10-31'), dict(rate_per_unit='-1'),
                        dict(rate_per_unit='1.234'), dict(rate_per_unit='100000000')]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.body(**changes)
        self.assertEqual(self.body(rate_per_unit='0').rate_per_unit, 0)

    def test_cannot_edit_another_agencys_rate(self):
        db = MagicMock()
        db.execute.return_value.fetchone.side_effect = [SimpleNamespace(id=4), None]
        with self.assertRaises(HTTPException) as error:
            _save_rate(self.body(), 99, db, self.scope())
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.execute.call_args.args[1]['agency_id'], 4)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_overlap_rejected_without_writing(self):
        db = MagicMock()
        db.execute.return_value.fetchone.side_effect = [SimpleNamespace(id=4), SimpleNamespace(id=5), SimpleNamespace(id=1)]
        with self.assertRaises(HTTPException) as error:
            _save_rate(self.body(), None, db, self.scope())
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(db.execute.call_count, 3)
        db.commit.assert_not_called()

    def test_coordinator_cannot_create_or_edit_rates(self):
        app = FastAPI()
        app.include_router(router)
        db = MagicMock()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role='coordinator')
        app.dependency_overrides[get_agency_scope] = self.scope
        app.dependency_overrides[get_db] = lambda: db
        async def request(method, path):
            messages = []
            async def receive():
                return {'type': 'http.request', 'body': json.dumps(self.body().model_dump(mode='json')).encode(), 'more_body': False}
            async def send(message):
                messages.append(message)
            await app({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                       'method': method, 'scheme': 'http', 'path': path, 'raw_path': path.encode(),
                       'query_string': b'', 'root_path': '', 'headers': [(b'content-type', b'application/json')],
                       'client': ('127.0.0.1', 1), 'server': ('test', 80)}, receive, send)
            return next(m['status'] for m in messages if m['type'] == 'http.response.start')
        for method, path in [('POST', '/service-rates'), ('PUT', '/service-rates/1')]:
            self.assertEqual(asyncio.run(request(method, path)), 403)
        db.execute.assert_not_called()

    def test_missing_rates_block_bulk_before_any_write(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [SimpleNamespace(amount=None)]
        with self.assertRaises(HTTPException) as error:
            _build_groups(db, date(2026, 11, 1), date(2026, 11, 30), self.scope())
        self.assertEqual(error.exception.status_code, 422)
        db.commit.assert_not_called()

    def test_missing_rates_block_individual_claim_before_any_write(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [SimpleNamespace(id=10, amount=None)]
        with self.assertRaises(HTTPException) as error:
            generate_claim(BillingClaimCreate(visit_ids=[10], payer='sandata'), db, self.scope())
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(db.execute.call_count, 1)
        db.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
