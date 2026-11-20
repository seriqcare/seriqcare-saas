import os
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

os.environ.setdefault('SECRET_KEY', 'test-only-settings-identity-secret')
from backend.auth.dependencies import AgencyScope
from backend.routers import settings
from backend.schemas import AgencySettings, PayrollGroup, BillingIdentity


class SettingsIdentityTests(unittest.TestCase):
    def scope(self):
        return AgencyScope(SimpleNamespace(id=8, role='agency_admin', agency_id=4))

    def test_email_comes_from_registration_instead_of_stale_settings(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(name='Registered Agency', aggregator='sandata', primary_contact_email='registered@example.com')
        with patch.object(settings, '_read', return_value={'email': 'old@example.com'}):
            result = settings.get_agency(db, self.scope())
        self.assertEqual(result.email, 'registered@example.com')
        self.assertEqual(db.execute.call_args.args[1]['id'], 4)

    def test_save_cannot_replace_registered_login_email(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(primary_contact_email='registered@example.com')
        with patch.object(settings, '_read', return_value={'email': 'old@example.com'}), patch.object(settings, '_write') as write:
            result = settings.update_agency(AgencySettings(email='injected@example.com', phone='717-555-0100'), db, self.scope())
        self.assertTrue(result.success)
        saved, agency_id, _ = write.call_args.args
        self.assertEqual(saved['email'], 'registered@example.com')
        self.assertEqual(saved['phone'], '717-555-0100')
        self.assertEqual(agency_id, 4)
        self.assertFalse(any('UPDATE care.users' in str(c.args[0]) for c in db.execute.call_args_list))
        db.commit.assert_called_once()

    def test_payroll_summary_uses_scoped_counts_and_actual_pay_period(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [SimpleNamespace(pay_group_id=7, caregiver_count=12)]
        with patch.object(settings, '_load_payroll_groups', return_value=[PayrollGroup(id=7, name='Own group'), PayrollGroup(id=8, name='Empty group')]), patch('backend.services.timezone.now_eastern', return_value=datetime(2026, 11, 18)):
            result = settings._payroll_response(db, self.scope(), {'frequency': 'weekly', 'week_starts_on': 'monday'})
        self.assertEqual([g.caregiver_count for g in result.groups], [12, 0])
        self.assertEqual((result.current_period_start, result.current_period_end), ('2026-11-16', '2026-11-22'))
        sql, params = db.execute.call_args.args
        self.assertIn('e.agency_id = :_agy_id', str(sql))
        self.assertEqual(params['_agy_id'], 4)

    def test_billing_identity_saves_to_agency_without_overwriting_other_settings(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = SimpleNamespace(primary_contact_email='registered@example.com')
        identity = BillingIdentity(npi='1234567890', taxonomy='251E00000X', ein='12-3456789', medicaid='PA123')
        with patch.object(settings, '_read', return_value={'phone': '717-555-0100'}), patch.object(settings, '_write') as write:
            settings.update_agency(AgencySettings(billing_identity=identity), db, self.scope())
        saved, agency_id, _ = write.call_args.args
        self.assertEqual(saved['billing_identity'], identity.model_dump())
        self.assertEqual(saved['phone'], '717-555-0100')
        self.assertEqual(agency_id, 4)

    def test_billing_identity_is_retained_by_settings_serialization(self):
        saved = settings._merge_settings({'billing_identity': {'npi': '1234567890', 'taxonomy': '', 'ein': '', 'medicaid': ''}})
        self.assertEqual(AgencySettings(**saved).billing_identity.npi, '1234567890')
        self.assertEqual(settings._merge_settings({})['billing_identity']['npi'], '')


if __name__ == '__main__':
    unittest.main()
