import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault('SECRET_KEY', 'test-only-client-intake-secret')
from backend.schemas import ClientCreateRequest
from backend.services.client_intake import resolve_intake, persist_intake


class ClientIntakeTests(unittest.TestCase):
    def body(self, **values):
        return ClientCreateRequest(first_name='Test', last_name='Client', medicaid_id='9876543210',
                                   date_of_birth='1950-01-01', **values)

    def test_service_only_can_be_saved_without_inventing_authorization(self):
        db = Mock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(id=10, hcpcs_code='S5130')
        resolved = resolve_intake(self.body(service_code_id=10), db, 4)
        self.assertFalse(resolved['authorization'])
        persist_intake(100, self.body(service_code_id=10), resolved, db, 4, '2026-11-19')
        writes = [str(call.args[0]) for call in db.execute.call_args_list if str(call.args[0]).startswith(('UPDATE', 'INSERT'))]
        self.assertEqual(len(writes), 1)
        self.assertIn('agency_id=:agency_id', writes[0])

    def test_partial_authorization_is_rejected_before_writes(self):
        db = Mock()
        with self.assertRaises(HTTPException) as error:
            resolve_intake(self.body(authorized_units=100), db, 4)
        self.assertEqual(error.exception.status_code, 422)
        db.execute.assert_not_called()

    def test_foreign_provider_is_rejected(self):
        db = Mock()
        db.execute.return_value.fetchone.side_effect = [SimpleNamespace(id=10, hcpcs_code='S5130'), None]
        with self.assertRaises(HTTPException) as error:
            resolve_intake(self.body(service_code_id=10, authorized_units=100, provider_id=99,
                authorization_start='2026-11-01', authorization_end='2027-11-01'), db, 4)
        self.assertEqual(error.exception.status_code, 422)
        call = db.execute.call_args_list[-1]
        self.assertIn('agency_id=:agency', str(call.args[0]))
        self.assertEqual(call.args[1]['agency'], 4)

    def test_invalid_dates_and_units_are_rejected(self):
        db = Mock()
        with self.assertRaises(HTTPException):
            resolve_intake(self.body(care_plan_start_date='2027-01-01', care_plan_review_date='2026-01-01'), db, 4)
        with self.assertRaises(HTTPException):
            resolve_intake(self.body(insurance_effective_date='2027-01-01', insurance_end_date='2026-01-01'), db, 4)
        for units in (0, -1, float('nan')):
            with self.assertRaises(ValidationError):
                self.body(authorized_units=units)


if __name__ == '__main__':
    unittest.main()
