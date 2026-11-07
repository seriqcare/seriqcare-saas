import { getAuthHeaders } from './server-auth';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';

export interface ScheduleStats {
  scheduled_visits: number;
  open_shifts: number;
  assigned_caregivers: number;
  completed_this_week: number;
  pending_clock_out: number;
  coverage_rate: number;
  at_risk_visits: number;
}

export interface ScheduleEntry {
  id: number;
  client_id: number;
  client_name: string;
  employee_id: number | null;
  employee_name: string | null;
  service_code: string | null;
  service_type: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  notes?: string | null;
  day_of_week: number;
}

export interface ScheduleAlert {
  title: string;
  sub: string;
  text: string;
  pill: string;
  cls: string;
}

export interface ScheduleResponse {
  week_start: string;
  week_end: string;
  stats: ScheduleStats;
  entries: ScheduleEntry[];
  alerts: ScheduleAlert[];
}

export interface ScheduleCreateRequest {
  client_id: number;
  employee_id?: number;
  service_code?: string;
  scheduled_start: string;
  scheduled_end: string;
  status?: string;
  notes?: string;
}

export interface ScheduleCreateResponse {
  success: boolean;
  id: number;
  message: string;
}

export interface ScheduleUpdateRequest {
  client_id: number;
  employee_id?: number;
  service_code?: string;
  scheduled_start: string;
  scheduled_end: string;
  status?: string;
  notes?: string;
}

export interface ScheduleUpdateResponse {
  success: boolean;
  id: number;
  message: string;
}

const FALLBACK: ScheduleResponse = {
  week_start: '',
  week_end: '',
  stats: {
    scheduled_visits: 0,
    open_shifts: 0,
    assigned_caregivers: 0,
    completed_this_week: 0,
    pending_clock_out: 0,
    coverage_rate: 0,
    at_risk_visits: 0,
  },
  entries: [],
  alerts: [],
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

export interface ServiceCode {
  id: number;
  code: string;
  description: string;
}

const FALLBACK_SERVICE_CODES: ServiceCode[] = [
  { id: 0, code: 'W7076', description: 'Companion Care' },
  { id: 0, code: 'W7060', description: 'In-Home and Community Habilitation' },
  { id: 0, code: 'W9494', description: 'Respite - Unlicensed' },
  { id: 0, code: 'W9495', description: 'Respite Day (eff 7/1/2025)' },
  { id: 0, code: 'S5130', description: 'Homemaker Services' },
  { id: 0, code: 'W9783', description: 'Community Support AAW' },
];

export async function getServiceCodes(): Promise<ServiceCode[]> {
  const authHeaders = await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/schedule/service-codes`,
    `${API.replace('localhost', '127.0.0.1')}/api/schedule/service-codes`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) {
        const data: ServiceCode[] = await res.json();
        return data.length > 0 ? data : FALLBACK_SERVICE_CODES;
      }
    } catch { /* try next */ }
  }
  return FALLBACK_SERVICE_CODES;
}

export async function getScheduleWeek(date?: string): Promise<ScheduleResponse> {
  const authHeaders = await getAuthHeaders();
  const params = date ? `?date=${date}` : '';
  const urls = [...new Set([
    `${API}/api/schedule/week${params}`,
    `${API.replace('localhost', '127.0.0.1')}/api/schedule/week${params}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[schedule] API unreachable — rendering with fallback');
  return FALLBACK;
}

export async function createSchedule(
  payload: ScheduleCreateRequest,
  token?: string,
): Promise<ScheduleCreateResponse> {
  const urls = [...new Set([
    `${API}/api/schedule`,
    `${API.replace('localhost', '127.0.0.1')}/api/schedule`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      if (res.ok) return res.json();
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `HTTP ${res.status}`);
    } catch (error) {
      if (url === urls[urls.length - 1]) {
        throw error;
      }
    }
  }
  throw new Error('Unable to save schedule.');
}

export async function updateSchedule(
  scheduleId: number,
  payload: ScheduleUpdateRequest,
  token?: string,
): Promise<ScheduleUpdateResponse> {
  const urls = [...new Set([
    `${API}/api/schedule/${scheduleId}`,
    `${API.replace('localhost', '127.0.0.1')}/api/schedule/${scheduleId}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      if (res.ok) return res.json();
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `HTTP ${res.status}`);
    } catch (error) {
      if (url === urls[urls.length - 1]) {
        throw error;
      }
    }
  }
  throw new Error('Unable to update schedule.');
}
