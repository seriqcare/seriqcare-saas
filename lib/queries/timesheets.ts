import { getAuthHeaders } from './server-auth';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';

export interface VisitStats {
  total_hours: number;
  pending_approval: number;
  approved: number;
  evv_exceptions: number;
}

export interface VisitEntry {
  id: number;
  employee_name: string;
  employee_code: string;
  client_name: string;
  service_date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number;
  evv_status: string;
  approval_status: string;
  clock_in_lat: number | null;
  clock_in_lon: number | null;
  clock_out_lat: number | null;
  clock_out_lon: number | null;
  sandata_status: string | null;
  hhax_status: string | null;
}

export interface VisitSubmitResult {
  success: boolean;
  visit_id: number;
  transaction_id: string;
  status: string;
  message: string;
  payload?: object;
}

export interface VisitsResponse {
  total: number;
  page: number;
  per_page: number;
  stats: VisitStats;
  items: VisitEntry[];
}

const FALLBACK: VisitsResponse = {
  total: 0,
  page: 1,
  per_page: 20,
  stats: { total_hours: 0, pending_approval: 0, approved: 0, evv_exceptions: 0 },
  items: [],
};

async function fetchWithTimeout(url: string, ms = 8000, headers?: HeadersInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getVisits(
  page = 1,
  perPage = 20,
  week = 'current',
  search = '',
  status = '',
  aggregator = '',
): Promise<VisitsResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), week });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (aggregator) params.set('aggregator', aggregator);
  const authHeaders = await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/visits?${params}`,
    `${API.replace('localhost', '127.0.0.1')}/api/visits?${params}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[visits] API unreachable — rendering with fallback');
  return FALLBACK;
}

export async function fixVisit(
  id: number,
  reason: string,
  notes = '',
  clockIn = '',
  clockOut = '',
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API}/api/visits/${id}/fix`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason,
        notes: notes || undefined,
        clock_in:  clockIn  || undefined,
        clock_out: clockOut || undefined,
      }),
    });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    return { success: false, message: err.detail ?? `HTTP ${res.status}` };
  } catch {
    return { success: false, message: 'API unreachable' };
  }
}

// ─── Universal timesheet dataset (richer than VisitEntry) ─────────────────────
export interface TimesheetEntry {
  visit_id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  department_code: string;
  client_name: string;
  client_id: string;
  service_date: string;
  service_type: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number;
  regular_hours: number;
  ot_hours: number;
  has_gps_in: boolean;
  has_gps_out: boolean;
  clock_in_lat: number | null;
  clock_in_lon: number | null;
  clock_out_lat: number | null;
  clock_out_lon: number | null;
  evv_status: string;
  approval_status: string;
  place_of_service: string;
  notes: string;
  pay_rate: number;
  gross_pay: number;
}

export interface TimesheetStats {
  total_records: number;
  total_hours: number;
  pending: number;
  approved: number;
  exceptions: number;
}

export interface TimesheetAppliedPeriod {
  selection: string;
  label: string;
  frequency?: string | null;
  start_date: string;
  end_date: string;
}

export interface TimesheetsResponse {
  total: number;
  page: number;
  per_page: number;
  stats: TimesheetStats;
  applied_period: TimesheetAppliedPeriod;
  items: TimesheetEntry[];
}

export interface TimesheetUpdateRequest {
  scheduled_start?: string;
  scheduled_end?: string;
  clock_in?: string;
  clock_out?: string;
  notes?: string;
}

const TIMESHEET_FALLBACK: TimesheetsResponse = {
  total: 0, page: 1, per_page: 20,
  stats: { total_records: 0, total_hours: 0, pending: 0, approved: 0, exceptions: 0 },
  applied_period: {
    selection: 'pay_current',
    label: 'Current Pay Period',
    frequency: 'weekly',
    start_date: '',
    end_date: '',
  },
  items: [],
};

export async function getTimesheetEntries(
  page = 1,
  perPage = 20,
  week = 'current',
  search = '',
  status = '',
): Promise<TimesheetsResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), week });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const authHeaders = await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/timesheets?${params}`,
    `${API.replace('localhost', '127.0.0.1')}/api/timesheets?${params}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[timesheets] /api/timesheets unreachable — falling back');
  return TIMESHEET_FALLBACK;
}

export async function submitVisit(id: number): Promise<VisitSubmitResult> {
  const authHeaders = await getAuthHeaders();
  try {
    const res = await fetch(`${API}/api/visits/${id}/submit`, {
      method: 'POST',
      cache: 'no-store',
      headers: authHeaders,
    });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    return { success: false, visit_id: id, transaction_id: '', status: 'Error', message: err.detail ?? `HTTP ${res.status}` };
  } catch {
    return { success: false, visit_id: id, transaction_id: '', status: 'Error', message: 'API unreachable' };
  }
}

export async function updateTimesheet(
  visitId: number,
  payload: TimesheetUpdateRequest,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API}/api/timesheets/${visitId}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    return { success: false, message: err.detail ?? `HTTP ${res.status}` };
  } catch {
    return { success: false, message: 'API unreachable' };
  }
}
