import csv
import io
import os
import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal

os.environ.setdefault('SECRET_KEY', 'test-only-export-rule-secret')
from backend.services.data_exports import export_reasons, amount, payroll_record, payroll_columns, billing_record, csv_text, readiness_item


def good_row(**changes):
    return dict(visit_id=10, agency_id=4, agency_code='AGY-004', agency_name='Test Agency', client_id=2, employee_id=3,
                employee_code='EMP3', first_name='Test', last_name='Caregiver', client_name='Test Client', medicaid_id='M123',
                service_date=date(2026, 11, 18), approval_status='Approved', clock_in=datetime(2026, 11, 18, 9), clock_out=datetime(2026, 11, 18, 10),
                hcpcs_code='S5130', modifier='UC', units=Decimal('4'), billing_rate=Decimal('30'),
                pay_rate_id=7, pay_rate=Decimal('25'), pay_type='Hourly', pay_effective_date=date(2026, 1, 1),
                service_authorization_id=6, authorization_id=6, authorization_active=True, auth_number='AUTH1', service_start_date=date(2026, 1, 1), service_end_date=date(2026, 12, 31),
                authorized_units=100, used_units=4, provider_id=8, provider_name='Agency Provider', provider_npi='1234567890',
                is_evv_required=True, evv_status='Verified', aggregator='sandata', sandata_status='Accepted', hhax_status=None,
                provider_id_sandata='PROVIDER4', agency_provider_id='PROVIDER4', export_id=None, notes='') | changes


class ExportRuleTests(unittest.TestCase):
    def test_approved_and_configured_visit_qualifies_for_both(self):
        for kind in ('billing', 'payroll'):
            self.assertEqual(export_reasons(good_row(), kind), [])
            self.assertEqual(readiness_item(good_row(), kind)['status'], 'Ready for Export')

    def test_timesheet_approval_is_not_a_billing_prerequisite(self):
        row = good_row(approval_status='Pending')
        self.assertTrue(export_reasons(row, 'payroll'))
        self.assertEqual(export_reasons(row, 'billing'), [])
        self.assertEqual(readiness_item(row, 'billing')['status'], 'Ready for Export')

    def test_active_visits_are_not_exportable(self):
        for kind in ('billing', 'payroll'):
            self.assertTrue(export_reasons(good_row(clock_out=None), kind))
            self.assertTrue(export_reasons(good_row(clock_out=datetime(2026, 11, 18, 8)), kind))

    def test_payroll_does_not_depend_on_evv_or_billing_configuration(self):
        row = good_row(evv_status='Failed', sandata_status='Rejected', billing_rate=None, authorization_id=None, provider_id=None, units=None, medicaid_id=None)
        self.assertEqual(export_reasons(row, 'payroll'), [])
        self.assertTrue(export_reasons(row, 'billing'))

    def test_billing_does_not_depend_on_caregiver_pay_configuration(self):
        row = good_row(pay_rate_id=None, pay_rate=None, pay_effective_date=None)
        self.assertEqual(export_reasons(row, 'billing'), [])
        self.assertTrue(export_reasons(row, 'payroll'))

    def test_payroll_rejects_unconfigured_zero_or_future_pay_rates(self):
        for changes in [dict(pay_rate_id=None), dict(pay_rate=0), dict(pay_effective_date=date(2027, 1, 1)), dict(pay_type='Unknown'), dict(employee_code='')]:
            with self.subTest(changes=changes):
                self.assertTrue(export_reasons(good_row(**changes), 'payroll'))

    def test_billing_requires_rate_units_authorization_provider_and_medicaid(self):
        for changes in [dict(billing_rate=None), dict(units=0), dict(authorization_id=None), dict(auth_number=''), dict(authorization_active=False),
                        dict(service_end_date=date(2026, 11, 17)), dict(authorized_units=1), dict(used_units=101), dict(provider_id=None),
                        dict(provider_id_sandata='OTHER'), dict(medicaid_id=''), dict(hcpcs_code='')]:
            with self.subTest(changes=changes):
                self.assertTrue(export_reasons(good_row(**changes), 'billing'))

    def test_missing_authorization_does_not_emit_cascading_provider_errors(self):
        reasons = export_reasons(good_row(authorization_id=None, provider_id=None, provider_id_sandata=None), 'billing')
        self.assertEqual(reasons, ['No matching active service authorization for the visit date'])
        reasons = export_reasons(good_row(authorization_id=None, authorization_candidates=2, provider_id=None), 'billing')
        self.assertEqual(reasons, ['Select a service authorization for this visit'])

    def test_verified_is_not_the_same_as_accepted_by_aggregator(self):
        self.assertTrue(export_reasons(good_row(sandata_status='Rejected'), 'billing'))
        self.assertTrue(export_reasons(good_row(evv_status='Failed'), 'billing'))
        self.assertEqual(export_reasons(good_row(aggregator='hhax', hhax_status='Accepted', sandata_status='Rejected'), 'billing'), [])
        self.assertEqual(export_reasons(good_row(is_evv_required=False, evv_status='Exempt', sandata_status=None), 'billing'), [])

    def test_exported_state_remains_exported_even_when_setup_changes(self):
        result = readiness_item(good_row(export_id=20, billing_rate=None), 'billing')
        self.assertEqual(result['status'], 'Exported')
        self.assertEqual(result['export_id'], 20)

    def test_amounts_use_different_rates_and_per_visit_pay(self):
        self.assertEqual(amount(good_row(), 'billing'), Decimal('120.00'))
        self.assertEqual(amount(good_row(), 'payroll'), Decimal('25.00'))
        self.assertEqual(amount(good_row(pay_type='Per Visit', clock_out=datetime(2026, 11, 18, 12)), 'payroll'), Decimal('25.00'))

    def test_payroll_gross_matches_existing_timesheet_minute_boundaries(self):
        row = good_row(clock_in=datetime(2026, 11, 18, 9, 0, 59), clock_out=datetime(2026, 11, 18, 10, 0, 0))
        self.assertEqual(amount(row, 'payroll'), Decimal('25.00'))

    def test_csv_snapshots_use_actual_agency_and_full_timestamps(self):
        row = good_row()
        record = payroll_record(row, date(2026, 11, 16), date(2026, 11, 22))
        self.assertEqual(record['AgencyID'], '4')
        self.assertEqual(record['AgencyName'], 'Test Agency')
        self.assertEqual(record['EmployeeID'], 3)
        self.assertEqual(record['ClockIn'], '2026-11-18T09:00:00')
        self.assertEqual(record['PayPeriodStart'], '2026-11-16')
        for provider in ('universal', 'adp', 'paychex', 'quickbooks', 'gusto'):
            exported = list(csv.DictReader(io.StringIO(csv_text([payroll_columns(record, provider)]))))
            self.assertEqual(len(exported), 1)
        self.assertEqual(billing_record(row)['Estimated Amount'], Decimal('120.00'))

    def test_untrusted_csv_fields_cannot_be_spreadsheet_formulas(self):
        record = billing_record(good_row(client_name='=DANGEROUS()', notes='+formula'))
        exported = list(csv.DictReader(io.StringIO(csv_text([record]))))[0]
        self.assertEqual(exported['Client'], "'=DANGEROUS()")


if __name__ == '__main__':
    unittest.main()
