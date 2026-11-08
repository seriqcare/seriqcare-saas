import { getAuthHeaders } from './server-auth';

const API = process.env.API_BASE_URL ?? 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AggregatorQueueItem {
  visit_id: number;
  service_date: string;
  client_name: string;
  employee_name: string;
  service_code: string;
  evv_status: string;
  approval_status: string;
  sandata_status: string | null;
  hhax_status: string | null;
  prior_attempts: number;
  last_attempt_at: string | null;
}

export interface AggregatorQueueResponse {
  total: number;
  mode: 'simulate' | 'live';
  items: AggregatorQueueItem[];
}

export interface SubmissionRecord {
  id: number;
  visit_id: number;
  aggregator: string | null;
  service_date: string | null;
  client_name: string | null;
  employee_name: string | null;
  submission_type: string;
  status: string;
  response_code: string | null;
  response_message: string | null;
  submitted_at: string | null;
  transaction_id: string | null;
}

export interface SubmissionsResponse {
  total: number;
  page: number;
  per_page: number;
  items: SubmissionRecord[];
}

export interface BatchSubmitResult {
  total_queued: number;
  submitted: number;
  accepted: number;
  rejected: number;
  errors: number;
  results: VisitSubmitResult[];
}

export interface VisitSubmitResult {
  success: boolean;
  visit_id: number;
  transaction_id: string;
  status: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function urls(path: string): string[] {
  return [...new Set([
    `${API}${path}`,
    `${API.replace('localhost', '127.0.0.1')}${path}`,
  ])];
}

async function fetchWithTimeout(url: string, headers: HeadersInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { cache: 'no-store', signal: ctrl.signal, headers });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Server-side query functions
// ---------------------------------------------------------------------------

export async function getAggregatorQueue(aggregator = ''): Promise<AggregatorQueueResponse> {
  const params = aggregator ? `?aggregator=${encodeURIComponent(aggregator)}` : '';
  const headers = await getAuthHeaders();
  for (const url of urls(`/api/aggregator/queue${params}`)) {
    let res: Response | undefined;
    try {
      res = await fetchWithTimeout(url, headers);
    } catch { /* try next */ }
    if (res) {
      if (!res.ok) throw new Error(`Aggregator queue request failed (HTTP ${res.status})`);
      return res.json();
    }
  }
  throw new Error('Aggregator queue API unreachable');
}

export async function getAggregatorSubmissions(
  page = 1,
  perPage = 20,
  status = '',
  aggregator = '',
): Promise<SubmissionsResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) params.set('status', status);
  if (aggregator) params.set('aggregator', aggregator);
  const headers = await getAuthHeaders();
  for (const url of urls(`/api/aggregator/submissions?${params}`)) {
    let res: Response | undefined;
    try {
      res = await fetchWithTimeout(url, headers);
    } catch { /* try next */ }
    if (res) {
      if (!res.ok) throw new Error(`Aggregator history request failed (HTTP ${res.status})`);
      return res.json();
    }
  }
  throw new Error('Aggregator history API unreachable');
}

// ---------------------------------------------------------------------------
// Client-side mutation functions (called from Client Components)
// ---------------------------------------------------------------------------

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function submitSingleVisit(visitId: number, apiFetch: ApiFetch): Promise<VisitSubmitResult> {
  const endpoint = `/api/aggregator/submit/${visitId}`;
  try {
    const res = await apiFetch(endpoint, { method: 'POST', cache: 'no-store' });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    return { success: false, visit_id: visitId, transaction_id: '', status: 'Error', message: err.detail ?? `HTTP ${res.status}` };
  } catch {
    return { success: false, visit_id: visitId, transaction_id: '', status: 'Error', message: 'API unreachable' };
  }
}

export async function batchSubmit(limit: number, apiFetch: ApiFetch): Promise<BatchSubmitResult> {
  const endpoint = `/api/aggregator/batch?limit=${limit}`;
  try {
    const res = await apiFetch(endpoint, { method: 'POST', cache: 'no-store' });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  } catch (e) {
    throw e;
  }
}

export async function retrySubmission(submissionId: number, apiFetch: ApiFetch): Promise<VisitSubmitResult> {
  const endpoint = `/api/aggregator/submissions/${submissionId}/retry`;
  try {
    const res = await apiFetch(endpoint, { method: 'POST', cache: 'no-store' });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    return { success: false, visit_id: 0, transaction_id: '', status: 'Error', message: err.detail ?? `HTTP ${res.status}` };
  } catch {
    return { success: false, visit_id: 0, transaction_id: '', status: 'Error', message: 'API unreachable' };
  }
}
