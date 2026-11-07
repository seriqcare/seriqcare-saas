// ─── Universal master record — single source of truth for all payroll exports ──
export interface UniversalRecord {
  EmployeeID:          string | number;
  ExternalEmployeeCode: string;
  FirstName:           string;
  LastName:            string;
  AgencyID:            string;
  AgencyName:          string;
  DepartmentCode:      string;
  LocationCode:        string;
  TimesheetID:         string | number;
  VisitID:             string | number;
  ClientID:            string;
  ServiceType:         string;
  ClockIn:             string;
  ClockOut:            string;
  TotalHours:          number;
  PayrollHours:        number;
  PayRateUsed:         number;
  GrossPay:            number;
  PayPeriodStart:      string;
  PayPeriodEnd:        string;
  PayDate:             string;
  ClockInGPS:          string;
  ClockOutGPS:         string;
  Verified:            string;
  CorrectionReason:    string;
  OT_Hours:            number;
  HolidayHours:        number;
  DifferentialType:    string;
  DifferentialAmount:  number;
  TravelTimeHours:     number;
  Notes:               string;
}

// ─── Provider registry ─────────────────────────────────────────────────────────
export type ProviderId = 'universal' | 'adp' | 'paychex' | 'quickbooks' | 'gusto';

export interface ProviderConfig {
  id:             ProviderId;
  name:           string;
  description:    string;
  fileExtension:  'csv';
  requiredFields?: (keyof UniversalRecord)[];
  /** Maps one UniversalRecord to a provider-specific flat row object. */
  mapRow:         (r: UniversalRecord) => Record<string, string | number>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function dateOnly(dt: string): string {
  return dt ? dt.split('T')[0] : '';
}

// ─── Provider definitions ──────────────────────────────────────────────────────
const PROVIDERS: Record<ProviderId, ProviderConfig> = {

  // Default — every field, no transformation
  universal: {
    id:          'universal',
    name:        'Universal Export',
    description: 'Full dataset — all 30 fields, no provider-specific transformations.',
    fileExtension: 'csv',
    mapRow: (r) => ({ ...r } as unknown as Record<string, string | number>),
  },

  // ── Paychex Flex ──────────────────────────────────────────────────────────────
  paychex: {
    id:          'paychex',
    name:        'Paychex',
    description: 'Paychex Flex payroll import format.',
    fileExtension: 'csv',
    requiredFields: ['ExternalEmployeeCode', 'ClockIn', 'PayrollHours'],
    mapRow: (r) => ({
      EmployeeID:    r.ExternalEmployeeCode,
      LastName:      r.LastName,
      FirstName:     r.FirstName,
      Department:    r.DepartmentCode,
      JobCode:       r.ServiceType,
      Date:          dateOnly(r.ClockIn),
      Hours:         r.PayrollHours,
      Overtime:      r.OT_Hours,
      Holiday:       r.HolidayHours,
      Rate:          r.PayRateUsed,
      Earnings:      r.GrossPay,
      PayPeriodStart: r.PayPeriodStart,
      PayPeriodEnd:  r.PayPeriodEnd,
      Notes:         r.Notes,
    }),
  },

  // ── ADP Workforce Now ─────────────────────────────────────────────────────────
  adp: {
    id:          'adp',
    name:        'ADP Workforce Now',
    description: 'ADP WFN payroll import batch format.',
    fileExtension: 'csv',
    requiredFields: ['ExternalEmployeeCode', 'PayrollHours'],
    mapRow: (r) => ({
      FileNumber:    r.ExternalEmployeeCode,
      EmployeeName:  `${r.FirstName} ${r.LastName}`.trim(),
      DeptCode:      r.DepartmentCode,
      Location:      r.LocationCode,
      PayCode:       r.DifferentialType || r.ServiceType,
      HoursWorked:   r.PayrollHours,
      OvertimeHours: r.OT_Hours,
      HolidayHours:  r.HolidayHours,
      Rate:          r.PayRateUsed,
      Amount:        r.GrossPay,
      CheckDate:     r.PayDate,
      BatchID:       r.TimesheetID,
      Notes:         r.Notes,
    }),
  },

  // ── QuickBooks Time ───────────────────────────────────────────────────────────
  quickbooks: {
    id:          'quickbooks',
    name:        'QuickBooks',
    description: 'QuickBooks Time (formerly TSheets) import format.',
    fileExtension: 'csv',
    requiredFields: ['ExternalEmployeeCode', 'ClockIn', 'ClockOut'],
    mapRow: (r) => ({
      Employee:         `${r.FirstName} ${r.LastName}`.trim(),
      ExternalID:       r.ExternalEmployeeCode,
      'Customer/Client': r.ClientID,
      ServiceItem:      r.ServiceType,
      StartTime:        r.ClockIn,
      EndTime:          r.ClockOut,
      Duration:         r.TotalHours,
      Billable:         r.Verified === 'Yes' ? 'Yes' : 'No',
      PayrollItem:      r.DifferentialType || r.ServiceType,
      PayRate:          r.PayRateUsed,
      Notes:            r.Notes,
    }),
  },

  // ── Gusto ─────────────────────────────────────────────────────────────────────
  gusto: {
    id:          'gusto',
    name:        'Gusto',
    description: 'Gusto payroll import format.',
    fileExtension: 'csv',
    requiredFields: ['ExternalEmployeeCode', 'PayrollHours'],
    mapRow: (r) => ({
      employee_id:       r.ExternalEmployeeCode,
      first_name:        r.FirstName,
      last_name:         r.LastName,
      department:        r.DepartmentCode,
      work_date:         dateOnly(r.ClockIn),
      hours_worked:      r.PayrollHours,
      overtime_hours:    r.OT_Hours,
      hourly_rate:       r.PayRateUsed,
      gross_pay:         r.GrossPay,
      pay_period_start:  r.PayPeriodStart,
      pay_period_end:    r.PayPeriodEnd,
      notes:             r.Notes,
    }),
  },
};

// ─── Registry accessors ────────────────────────────────────────────────────────
export function getProvider(id: ProviderId): ProviderConfig {
  return PROVIDERS[id] ?? PROVIDERS.universal;
}

export function getAllProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS);
}

export const PAYROLL_PROVIDER_KEY = 'seriqcare_payroll_provider';
