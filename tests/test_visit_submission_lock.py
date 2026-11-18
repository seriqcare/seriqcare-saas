import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault('SECRET_KEY', 'test-visit-lock-secret')
from fastapi import HTTPException
from backend.routers import aggregator
from backend.auth.dependencies import AgencyScope
from test_client_tenant_access import user, Result


class DB:
    def __init__(self, prior=1, locked=0, status='Ready'):
        self.row = SimpleNamespace(id=10, sandata_status=status, prior_submissions=prior,
            locked_submissions=locked, provider_id_sandata='TEST-PROVIDER')
    def execute(self, *args): return Result(self.row)
    def commit(self): pass


class SubmissionLockTests(unittest.TestCase):
    def test_prior_attempt_cannot_use_first_submit_endpoint(self):
        with patch.object(aggregator.svc, 'post_to_simulator') as send:
            with self.assertRaises(HTTPException) as caught:
                aggregator._do_submit(10, DB(), AgencyScope(user()))
            self.assertEqual(caught.exception.status_code, 409)
            send.assert_not_called()

    def test_retry_cannot_bypass_an_accepted_or_pending_attempt(self):
        for status in ('Ready', 'Rejected', 'Accepted', 'Submitted', 'Pending'):
            with self.subTest(status=status), patch.object(aggregator.svc, 'post_to_simulator') as send:
                with self.assertRaises(HTTPException) as caught:
                    aggregator._do_submit(10, DB(locked=1, status=status), AgencyScope(user()), allow_retry=True)
                self.assertEqual(caught.exception.status_code, 409)
                send.assert_not_called()

    def test_explicit_retry_is_allowed_for_a_failed_attempt_without_an_acceptance(self):
        with patch.object(aggregator.svc, 'is_live', return_value=False), \
             patch.object(aggregator.svc, 'build_visit_payload', return_value={}), \
             patch.object(aggregator.svc, 'build_visit_simulator_payload', return_value=[]), \
             patch.object(aggregator.svc, 'post_to_simulator', return_value=('Success','200','ok')), \
             patch.object(aggregator, '_record_submission'), patch.object(aggregator, '_update_sandata_status'):
            response = aggregator._do_submit(10, DB(status='Rejected'), AgencyScope(user()), allow_retry=True)
        self.assertTrue(response.success)


if __name__ == '__main__': unittest.main()
