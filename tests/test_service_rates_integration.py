"""Opt-in SQL Server verification; all test writes are rolled back."""
import os
import unittest
from datetime import date
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

os.environ.setdefault('SECRET_KEY', 'test-only-service-rates-secret')
from db.database import engine
from backend.auth.dependencies import AgencyScope
from backend.routers.service_rates import ServiceRateInput, _save_rate, get_service_rates
from backend.routers.billing import get_billing, _build_groups, get_claim_detail
from backend.services.billing_rates import RATE_JOIN


@unittest.skipUnless(os.getenv('RUN_SERVICE_RATE_DB_TESTS') == '1', 'Opt-in SQL Server test')
class ServiceRateDatabaseTests(unittest.TestCase):
    def test_effective_dates_tenant_isolation_overlap_and_billing_queries(self):
        with engine.connect() as conn:
            transaction = conn.begin()
            db = Session(bind=conn, join_transaction_mode='create_savepoint')
            try:
                agencies = conn.execute(text('SELECT TOP 2 id FROM care.agencies WHERE is_active = 1 ORDER BY id DESC')).scalars().all()
                self.assertEqual(len(agencies), 2)
                service_id = conn.execute(text('SELECT TOP 1 id FROM care.service_codes WHERE is_active = 1 ORDER BY id DESC')).scalar_one()

                def scope(agency_id):
                    return AgencyScope(SimpleNamespace(id=0, agency_id=agency_id, role='agency_admin'))

                def save(agency_id, amount, start, end=None, rate_id=None):
                    return _save_rate(ServiceRateInput(service_code_id=service_id, rate_per_unit=amount,
                                                      effective_from=start, effective_to=end), rate_id, db, scope(agency_id))['id']

                first = save(agencies[0], '12.50', '2080-01-01', '2080-01-31')
                save(agencies[0], '15.00', '2080-02-01')
                save(agencies[1], '99.00', '2080-01-01')

                def estimate(agency_id, visit_date):
                    return db.execute(text(f'''
                        SELECT rate.rate_per_unit * 4 AS amount
                        FROM (SELECT CAST(:agency_id AS INT) AS agency_id,
                                     CAST(:service_id AS INT) AS service_code_id,
                                     CAST(:visit_date AS DATE) AS service_date) v
                        {RATE_JOIN}
                    '''), dict(agency_id=agency_id, service_id=service_id, visit_date=visit_date)).scalar_one()

                self.assertEqual(float(estimate(agencies[0], '2080-01-01')), 50)
                self.assertEqual(float(estimate(agencies[0], '2080-01-31')), 50)
                self.assertEqual(float(estimate(agencies[0], '2080-02-01')), 60)
                self.assertEqual(float(estimate(agencies[1], '2080-01-01')), 396)
                self.assertIsNone(estimate(agencies[0], '2079-12-31'))

                with self.assertRaises(HTTPException) as error:
                    save(agencies[0], '1', '2080-01-31', '2080-01-31')
                self.assertEqual(error.exception.status_code, 409)
                with self.assertRaises(HTTPException) as error:
                    save(agencies[1], '1', '2080-01-01', '2080-01-31', first)
                self.assertEqual(error.exception.status_code, 404)

                save(agencies[0], '10', '2080-01-01', '2080-01-31', first)
                self.assertEqual(float(estimate(agencies[0], '2080-01-20')), 40)
                listed = get_service_rates(db, scope(agencies[0]))
                self.assertEqual(next(r for r in listed['rates'] if r['id'] == first)['rate_per_unit'], 10)
                self.assertFalse(any(r['rate_per_unit'] == 99 for r in listed['rates']))

                # Execute the actual billing SQL, including aggregate and grouping paths.
                result = get_billing(page=1, per_page=20, period='this_month', status='', search='', db=db, scope=scope(agencies[0]))
                self.assertGreaterEqual(result.total, 0)
                self.assertEqual(_build_groups(db, date(2080, 1, 1), date(2080, 1, 31), scope(agencies[0])), [])
                claim = db.execute(text('SELECT TOP 1 id FROM care.billing_claims WHERE agency_id = :aid'), {'aid': agencies[0]}).fetchone()
                if claim:
                    detail = get_claim_detail(claim.id, db, scope(agencies[0]))
                    self.assertEqual(detail.id, claim.id)
            finally:
                db.close()
                transaction.rollback()


if __name__ == '__main__':
    unittest.main()
