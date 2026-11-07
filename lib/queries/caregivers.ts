import { getAuthHeaders } from './server-auth';

const API = process.env.API_BASE_URL ?? 'http://localhost:8000';
const READ_REVALIDATE_SECONDS = 30;

export interface CaregiverStats {
  total_caregivers: number;
  active: number;
  on_leave: number;
  inactive: number;
  assigned_this_week: number;
  total_hours_this_week: number;
}

export interface CaregiverSummary {
  id: number;
  employee_code: string;
  name: string;
  role: string;
  status: string;
  hire_date: string | null;
  clients_assigned: number;
  visits_this_week: number;
  hours_this_week: number;
}

export interface CaregiversResponse {
  total: number;
  page: number;
  per_page: number;
  stats: CaregiverStats;
  items: CaregiverSummary[];
}

const FALLBACK_STATS: CaregiverStats = {
  total_caregivers: 0,
  active: 0,
  on_leave: 0,
  inactive: 0,
  assigned_this_week: 0,
  total_hours_this_week: 0,
};

const FALLBACK: CaregiversResponse = {
  total: 0,
  page: 1,
  per_page: 20,
  stats: FALLBACK_STATS,
  items: [],
};

async function fetchWithTimeout(url: string, ms = 8000, headers?: HeadersInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      next: { revalidate: READ_REVALIDATE_SECONDS },
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getCaregivers(
  page = 1,
  perPage = 20,
  status = '',
  search = '',
): Promise<CaregiversResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const authHeaders = await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/caregivers?${params}`,
    `${API.replace('localhost', '127.0.0.1')}/api/caregivers?${params}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[caregivers] API unreachable — rendering with fallback');
  return FALLBACK;
}
