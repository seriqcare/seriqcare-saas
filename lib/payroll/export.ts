import { getProvider, ProviderId, UniversalRecord } from './providers';
import type { TimesheetEntry } from '@/lib/queries/timesheets';

// ─── Map TimesheetEntry (universal API) → UniversalRecord ─────────────────────
export function toUniversalRecord(
  v: TimesheetEntry,
  agencyName = 'SeriqCare Home Health',
): UniversalRecord {
  const gpsIn  = v.clock_in_lat  && v.clock_in_lon  ? `${v.clock_in_lat},${v.clock_in_lon}`   : '';
  const gpsOut = v.clock_out_lat && v.clock_out_lon ? `${v.clock_out_lat},${v.clock_out_lon}` : '';
  const verified = v.evv_status === 'Processed' || v.evv_status === 'Verified' ? 'Yes' : 'No';

  return {
    EmployeeID:           v.visit_id,
    ExternalEmployeeCode: v.employee_code,
    FirstName:            v.first_name,
    LastName:             v.last_name,
    AgencyID:             '1',
    AgencyName:           agencyName,
    DepartmentCode:       v.department_code,
    LocationCode:         v.place_of_service || '12',
    TimesheetID:          v.visit_id,
    VisitID:              v.visit_id,
    ClientID:             v.client_id,
    ServiceType:          v.service_type,
    ClockIn:              v.clock_in  ?? '',
    ClockOut:             v.clock_out ?? '',
    TotalHours:           v.total_hours,
    PayrollHours:         v.regular_hours,
    PayRateUsed:          v.pay_rate,
    GrossPay:             v.gross_pay,
    PayPeriodStart:       v.service_date,
    PayPeriodEnd:         v.service_date,
    PayDate:              v.service_date,
    ClockInGPS:           gpsIn,
    ClockOutGPS:          gpsOut,
    Verified:             verified,
    CorrectionReason:     '',
    OT_Hours:             v.ot_hours,
    HolidayHours:         0,
    DifferentialType:     '',
    DifferentialAmount:   0,
    TravelTimeHours:      0,
    Notes:                v.notes,
  };
}

// ─── Validate required fields ──────────────────────────────────────────────────
export function validateExport(
  records: UniversalRecord[],
  providerId: ProviderId,
): string[] {
  const provider = getProvider(providerId);
  if (!provider.requiredFields || records.length === 0) return [];

  return provider.requiredFields.flatMap((field) => {
    const missing = records.filter((r) => !r[field] && r[field] !== 0).length;
    return missing > 0 ? [`${missing} record(s) missing required field: ${String(field)}`] : [];
  });
}

// ─── Generate CSV string ───────────────────────────────────────────────────────
function escapeCsv(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateCsv(records: UniversalRecord[], providerId: ProviderId): string {
  if (records.length === 0) return '';

  const provider = getProvider(providerId);
  const rows     = records.map((r) => provider.mapRow(r));
  const headers  = Object.keys(rows[0]);

  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')),
  ];

  return lines.join('\r\n');
}

// ─── Trigger browser download ──────────────────────────────────────────────────
export function triggerDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
