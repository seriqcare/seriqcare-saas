"""Independent payroll and billing export eligibility and immutable CSV snapshots."""
import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from sqlalchemy import text
from backend.services.billing_rates import RATE_JOIN
from backend.services.authorization_usage import authorization_usage_join


def ensure_export_tables(engine):
    with engine.begin() as conn:
        conn.execute(text((Path(__file__).resolve().parents[2] / 'sql' / 'data_exports.sql').read_text()))


EXPORT_ROWS_SQL = """
    SELECT v.id AS visit_id, v.agency_id, v.client_id, v.employee_id,
        v.service_date, v.service_code_id, v.service_authorization_id,
        v.place_of_service, CAST(v.notes AS NVARCHAR(MAX)) AS notes,
        a.name AS agency_name, a.agency_code, a.aggregator,
        a.sandata_provider_id AS agency_provider_id,
        e.employee_code, e.first_name, e.last_name,
        c.first_name + ' ' + c.last_name AS client_name, c.medicaid_id,
        sc.hcpcs_code, sc.modifier, sc.unit_type, sc.is_evv_required,
        vb.approval_status, COALESCE(vb.approved_units, vb.billed_units) AS units,
        ev.evv_status, COALESCE(ev.adj_in_datetime, ev.call_in_datetime) AS clock_in,
        COALESCE(ev.adj_out_datetime, ev.call_out_datetime) AS clock_out,
        ev.call_in_latitude, ev.call_in_longitude, ev.call_out_latitude, ev.call_out_longitude,
        vi.sandata_status, vi.hhax_status,
        rate.rate_per_unit AS billing_rate,
        pgr.id AS pay_rate_id, pgr.rate AS pay_rate, pgr.pay_type, pgr.effective_date AS pay_effective_date,
        sa.id AS authorization_id, sa.auth_number, sa.is_active AS authorization_active,
        inferred.authorization_candidates,
        sa.service_start_date, sa.service_end_date, sa.authorized_units, auth_usage.used_units,
        p.id AS provider_id, p.name AS provider_name, p.npi AS provider_npi,
        p.provider_id_sandata,
        exported.export_id, exported.snapshot_json AS exported_snapshot_json
    FROM care.visits v
    JOIN care.agencies a ON a.id = v.agency_id AND a.is_active = 1
    JOIN care.employees e ON e.id = v.employee_id AND e.agency_id = v.agency_id
    JOIN care.clients c ON c.id = v.client_id AND c.agency_id = v.agency_id
    JOIN care.service_codes sc ON sc.id = v.service_code_id
    LEFT JOIN care.visit_billing vb ON vb.visit_id = v.id
    LEFT JOIN care.visit_evv ev ON ev.visit_id = v.id
    LEFT JOIN care.visit_integration_status vi ON vi.visit_id = v.id
    LEFT JOIN care.employee_payroll_settings eps ON eps.employee_id = e.id
    LEFT JOIN care.pay_group_rates pgr ON pgr.id = eps.pay_group_rate_id AND pgr.pay_group_id = eps.pay_group_id
    OUTER APPLY (
        SELECT COUNT(*) AS authorization_candidates,
            CASE WHEN COUNT(*) = 1 THEN MAX(candidate.id) END AS authorization_id
        FROM care.service_authorizations candidate
        WHERE v.service_authorization_id IS NULL AND candidate.agency_id = v.agency_id
          AND candidate.client_id = v.client_id AND candidate.service_code_id = v.service_code_id
          AND candidate.is_active = 1 AND candidate.service_start_date <= v.service_date
          AND candidate.service_end_date >= v.service_date
    ) inferred
    LEFT JOIN care.service_authorizations sa ON sa.id = COALESCE(v.service_authorization_id, inferred.authorization_id)
        AND sa.agency_id = v.agency_id AND sa.client_id = v.client_id AND sa.service_code_id = v.service_code_id
    {authorization_usage}
    LEFT JOIN care.providers p ON p.id = sa.provider_id AND p.agency_id = v.agency_id AND p.is_active = 1
    LEFT JOIN care.data_export_items exported ON exported.visit_id = v.id
        AND exported.agency_id = v.agency_id AND exported.kind = :kind
    {rate_join}
    WHERE v.visit_cancelled = 0 AND v.agency_id = :agency_id
      AND v.service_date >= :period_start AND v.service_date <= :period_end
    ORDER BY v.service_date DESC, v.id DESC
""".replace('{rate_join}', RATE_JOIN).replace('{authorization_usage}', authorization_usage_join())


def read_export_rows(db, agency_id, kind, start, end):
    return [dict(row) for row in db.execute(text(EXPORT_ROWS_SQL), {
        'agency_id': agency_id, 'kind': kind, 'period_start': start, 'period_end': end,
    }).mappings().all()]


def number(value):
    return Decimal(str(value)) if value is not None else Decimal(0)


def hours(row):
    start, end = row.get('clock_in'), row.get('clock_out')
    if not start or not end or end <= start:
        return Decimal(0)
    # Match the existing Timesheets DATEDIFF(MINUTE) calculation, including
    # minute boundaries, so exporting does not silently change gross pay.
    minutes = Decimal(str((end.replace(second=0, microsecond=0) - start.replace(second=0, microsecond=0)).total_seconds())) / 60
    return minutes / 60


def export_reasons(row, kind):
    reasons = []
    if kind == 'payroll' and row.get('approval_status') != 'Approved':
        reasons.append('Timesheet approval required')
    if hours(row) <= 0:
        reasons.append('Completed visit with positive recorded hours required')
    if kind == 'payroll':
        if not row.get('employee_code'):
            reasons.append('Employee code required')
        if not row.get('pay_rate_id') or number(row.get('pay_rate')) <= 0 or row.get('pay_type') not in ('Hourly', 'Per Visit'):
            reasons.append('Configure a caregiver pay group and positive pay rate')
        if not row.get('pay_effective_date') or row['pay_effective_date'] > row['service_date']:
            reasons.append('Caregiver pay rate must be effective on the visit date')
        # Payroll deliberately does not depend on EVV, authorizations, or billing rates.
        return reasons
    if not row.get('hcpcs_code'):
        reasons.append('Service code required')
    if number(row.get('units')) <= 0:
        reasons.append('Positive billing units required')
    if row.get('billing_rate') is None:
        reasons.append('Service billing rate missing for the visit date')
    if not row.get('medicaid_id'):
        reasons.append('Client Medicaid ID required')
    if not row.get('authorization_id'):
        reasons.append('Select a service authorization for this visit' if row.get('authorization_candidates', 0) > 1 else 'No matching active service authorization for the visit date')
    elif not row.get('authorization_active') or not row.get('auth_number'):
        reasons.append('Active service authorization and authorization number required')
    elif (not row.get('service_start_date') or row['service_start_date'] > row['service_date']
          or not row.get('service_end_date') or row['service_end_date'] < row['service_date']):
        reasons.append('Authorization must cover the visit date')
    elif (number(row.get('authorized_units')) < number(row.get('units'))
          or number(row.get('used_units')) > number(row.get('authorized_units'))):
        reasons.append('Authorization units exceeded')
    if row.get('authorization_id') and not row.get('provider_id'):
        reasons.append('Active agency provider required on the authorization')
    if row.get('is_evv_required'):
        if row.get('evv_status') not in ('Verified', 'Adjusted'):
            reasons.append('EVV verification required')
        aggregator = (row.get('aggregator') or '').lower()
        status = row.get('sandata_status') if aggregator == 'sandata' else row.get('hhax_status') if aggregator == 'hhax' else None
        if status not in ('Accepted', 'Success', 'Processed'):
            reasons.append('EVV must be accepted by the agency aggregator')
        if aggregator == 'sandata' and row.get('provider_id') and (not row.get('provider_id_sandata') or row['provider_id_sandata'] != row.get('agency_provider_id')):
            reasons.append('Authorization provider must match the agency Sandata Provider ID')
    return reasons


def amount(row, kind):
    if kind == 'billing':
        value = number(row.get('units')) * number(row.get('billing_rate'))
    else:
        value = number(row.get('pay_rate')) * (1 if row.get('pay_type') == 'Per Visit' else hours(row))
    return value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


def saved_export_amount(row, kind):
    """Period totals retain the amount actually exported, even after rates change."""
    snapshot = json.loads(row.get('exported_snapshot_json') or '{}')
    key = 'Estimated Amount' if kind == 'billing' else 'GrossPay'
    if key not in snapshot:
        raise ValueError('Saved export amount is unavailable; cannot calculate an accurate period total.')
    return number(snapshot[key])


def readiness_item(row, kind):
    reasons = export_reasons(row, kind)
    visit_approved = hours(row) > 0 and (not row.get('is_evv_required') or (
        row.get('evv_status') in ('Verified', 'Adjusted') and
        (row.get('sandata_status') if (row.get('aggregator') or '').lower() == 'sandata' else row.get('hhax_status')) in ('Accepted', 'Success', 'Processed')))
    approved = row.get('approval_status') == 'Approved' if kind == 'payroll' else visit_approved
    status = ('Exported' if row.get('export_id') else 'Pending Approval' if not approved
              else 'Approved' if reasons else 'Ready for Export')
    return {
        'visit_id': row['visit_id'], 'service_date': row['service_date'].isoformat(),
        'client_name': row['client_name'], 'caregiver_name': f"{row['first_name']} {row['last_name']}",
        'service_code': row.get('hcpcs_code'), 'units': float(number(row.get('units'))),
        'hours': float(hours(row)), 'amount': float(amount(row, kind)),
        'rate': row.get('billing_rate') if kind == 'billing' else row.get('pay_rate'),
        'status': status, 'reasons': reasons, 'export_id': row.get('export_id'),
        'evv_status': row.get('evv_status'), 'approval_status': row.get('approval_status') or 'Pending',
        'visit_approved': visit_approved, 'authorization_id': row.get('authorization_id'),
    }


def billing_record(row):
    return {
        'Visit ID': row['visit_id'], 'Agency ID': row['agency_id'], 'Agency Code': row['agency_code'],
        'Agency': row['agency_name'], 'Service Date': row['service_date'].isoformat(),
        'Client ID': row['client_id'], 'Client': row['client_name'], 'Medicaid ID': row.get('medicaid_id') or '',
        'Caregiver': f"{row['first_name']} {row['last_name']}", 'Employee Code': row['employee_code'],
        'Service Code': row['hcpcs_code'], 'Modifier': row.get('modifier') or '',
        'Authorization ID': row.get('authorization_id'), 'Authorization': row.get('auth_number') or '', 'Provider': row.get('provider_name') or '',
        'Provider NPI': row.get('provider_npi') or '', 'Sandata Provider ID': row.get('provider_id_sandata') or '',
        'Clock In': row['clock_in'].isoformat(), 'Clock Out': row['clock_out'].isoformat(),
        'Billing Units': number(row['units']), 'Rate Per Unit': number(row['billing_rate']),
        'Estimated Amount': amount(row, 'billing'), 'EVV Status': row.get('evv_status') or '',
        'Aggregator': row.get('aggregator') or '', 'Export Type': 'Supporting billing data',
    }


def payroll_record(row, start, end):
    duration = hours(row)
    return {
        'EmployeeID': row['employee_id'], 'ExternalEmployeeCode': row['employee_code'],
        'FirstName': row['first_name'], 'LastName': row['last_name'],
        'AgencyID': str(row['agency_id']), 'AgencyName': row['agency_name'],
        'DepartmentCode': 'DSP', 'LocationCode': row.get('place_of_service') or '',
        'TimesheetID': row['visit_id'], 'VisitID': row['visit_id'], 'ClientID': str(row['client_id']),
        'ServiceType': row.get('hcpcs_code') or '',
        'ClockIn': row['clock_in'].isoformat(), 'ClockOut': row['clock_out'].isoformat(),
        'TotalHours': duration.quantize(Decimal('.01')), 'PayrollHours': min(duration, Decimal(8)).quantize(Decimal('.01')),
        'PayRateUsed': number(row['pay_rate']), 'GrossPay': amount(row, 'payroll'),
        'PayPeriodStart': start.isoformat(), 'PayPeriodEnd': end.isoformat(), 'PayDate': row['service_date'].isoformat(),
        'ClockInGPS': f"{row['call_in_latitude']},{row['call_in_longitude']}" if row.get('call_in_latitude') is not None and row.get('call_in_longitude') is not None else '',
        'ClockOutGPS': f"{row['call_out_latitude']},{row['call_out_longitude']}" if row.get('call_out_latitude') is not None and row.get('call_out_longitude') is not None else '',
        'Verified': 'Yes' if row.get('evv_status') in ('Verified', 'Adjusted', 'Processed') else 'No',
        'CorrectionReason': '', 'OT_Hours': max(Decimal(0), duration - 8).quantize(Decimal('.01')), 'HolidayHours': 0,
        'DifferentialType': '', 'DifferentialAmount': 0, 'TravelTimeHours': 0, 'Notes': row.get('notes') or '',
    }


def payroll_columns(record, provider):
    if provider == 'universal':
        return record
    mapping = {
        'paychex': [('EmployeeID', 'ExternalEmployeeCode'), ('LastName', 'LastName'), ('FirstName', 'FirstName'), ('Department', 'DepartmentCode'), ('JobCode', 'ServiceType'), ('Date', 'PayDate'), ('Hours', 'PayrollHours'), ('Overtime', 'OT_Hours'), ('Holiday', 'HolidayHours'), ('Rate', 'PayRateUsed'), ('Earnings', 'GrossPay'), ('PayPeriodStart', 'PayPeriodStart'), ('PayPeriodEnd', 'PayPeriodEnd'), ('Notes', 'Notes')],
        'adp': [('FileNumber', 'ExternalEmployeeCode'), ('EmployeeName', '_name'), ('DeptCode', 'DepartmentCode'), ('Location', 'LocationCode'), ('PayCode', 'ServiceType'), ('HoursWorked', 'PayrollHours'), ('OvertimeHours', 'OT_Hours'), ('HolidayHours', 'HolidayHours'), ('Rate', 'PayRateUsed'), ('Amount', 'GrossPay'), ('CheckDate', 'PayDate'), ('BatchID', 'TimesheetID'), ('Notes', 'Notes')],
        'quickbooks': [('Employee', '_name'), ('ExternalID', 'ExternalEmployeeCode'), ('Customer/Client', 'ClientID'), ('ServiceItem', 'ServiceType'), ('StartTime', 'ClockIn'), ('EndTime', 'ClockOut'), ('Duration', 'TotalHours'), ('Billable', 'Verified'), ('PayrollItem', 'ServiceType'), ('PayRate', 'PayRateUsed'), ('Notes', 'Notes')],
        'gusto': [('employee_id', 'ExternalEmployeeCode'), ('first_name', 'FirstName'), ('last_name', 'LastName'), ('department', 'DepartmentCode'), ('work_date', 'PayDate'), ('hours_worked', 'PayrollHours'), ('overtime_hours', 'OT_Hours'), ('hourly_rate', 'PayRateUsed'), ('gross_pay', 'GrossPay'), ('pay_period_start', 'PayPeriodStart'), ('pay_period_end', 'PayPeriodEnd'), ('notes', 'Notes')],
    }
    values = record | {'_name': f"{record['FirstName']} {record['LastName']}".strip()}
    return {column: values[key] for column, key in mapping[provider]}


def csv_text(records):
    def cell(value):
        # Prevent spreadsheet formulas in user-entered names, codes, and notes.
        if isinstance(value, str) and (value.startswith(('\t', '\r', '\n')) or value.lstrip().startswith(('=', '+', '-', '@'))):
            return "'" + value
        return value
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(records[0].keys())
    for record in records:
        writer.writerow([cell(value) for value in record.values()])
    return output.getvalue()
