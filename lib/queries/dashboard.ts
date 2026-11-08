import { getAuthHeaders } from './server-auth';

const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 4000);
const READ_REVALIDATE_SECONDS = 30;

const FALLBACK: DashboardMetrics = {
  activeClients: 0,
  carePlansExpiringSoon: 0,
  scheduledVisitsThisWeek: 0,
  openShifts: 0,
  totalHoursThisWeek: 0,
  pendingApproval: 0,
  evvExceptions: 0,
  urgentExceptions: 0,
  evvProcessed: 0,
  evvVerified: 0,
  evvIncomplete: 0,
  evvOmit: 0,
  pendingSubmissions: 0,
  rejectedSubmissions: 0,
  visitsByDay: [],
  priorityQueue: [],
};

export interface VisitByDay {
  date: string;
  count: number;
  hours: number;
}

export interface PriorityItem {
  title: string;
  sub: string;
  type: 'urgent' | 'warning' | 'open';
}

export interface DashboardMetrics {
  activeClients: number;
  carePlansExpiringSoon: number;
  scheduledVisitsThisWeek: number;
  openShifts: number;
  totalHoursThisWeek: number;
  pendingApproval: number;
  evvExceptions: number;
  urgentExceptions: number;
  evvProcessed: number;
  evvVerified: number;
  evvIncomplete: number;
  evvOmit: number;
  pendingSubmissions: number;
  rejectedSubmissions: number;
  visitsByDay: VisitByDay[];
  priorityQueue: PriorityItem[];
}

export interface CaregiverUtilization {
  employee_id: number;
  name: string;
  scheduled_hours: number;
  utilization_pct: number;
}

export async function getCaregiverUtilization(): Promise<CaregiverUtilization[]> {
  const headers = await getAuthHeaders();
  for (const base of buildApiBases()) {
    let response: Response;
    try {
      response = await fetch(`${base}/api/dashboard/caregiver-utilization`, {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch {
      continue;
    }
    if (!response.ok) throw new Error(`Caregiver utilization request failed (HTTP ${response.status})`);
    return response.json();
  }
  throw new Error('Caregiver utilization service is unavailable');
}

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

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildApiBases(): string[] {
  const preferred = [
    process.env.API_BASE_URL,
    process.env.NEXT_PUBLIC_API_BASE_URL,
    'http://127.0.0.1:8000',
    'http://localhost:8000',
  ].filter((v): v is string => Boolean(v));

  const expanded = preferred.flatMap((base) => {
    const normalized = trimSlash(base);
    return normalized.includes('localhost')
      ? [normalized, normalized.replace('localhost', '127.0.0.1')]
      : [normalized];
  });

  return [...new Set(expanded)];
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const authHeaders = await getAuthHeaders();
  const urls = buildApiBases().map((base) => `${base}/api/dashboard/metrics`);
  let lastFailure = 'unknown error';

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, API_TIMEOUT_MS, authHeaders);
      if (res.ok) return res.json();
      lastFailure = `HTTP ${res.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'request failed';
    }
  }
  console.warn(
    `[dashboard] API unreachable (${lastFailure}) — rendering with fallback zeros`,
  );
  return FALLBACK;
}
