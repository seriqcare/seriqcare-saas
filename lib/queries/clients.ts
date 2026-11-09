import { getAuthHeaders } from './server-auth';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';
const READ_REVALIDATE_SECONDS = 30;

export interface ClientStats {
  total_clients: number;
  new_this_month: number;
  active_care_plans: number;
  due_for_review: number;
  assigned_caregivers: number;
  multi_staff_cases: number;
  doc_flags: number;
  urgent_followup: number;
}

export interface ClientSummary {
  id: number;
  client_code: string;
  name: string;
  age: number | null;
  city: string | null;
  state: string | null;
  status: string;
  service_type: string | null;
  primary_caregiver: string | null;
  next_visit: string | null;
  care_plan_status: string;
  care_plan_review_date: string | null;
}

export interface ClientDetail {
  id: number;
  client_code: string;
  first_name: string;
  last_name: string;
  medicaid_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  ssn_last4: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  primary_language: string | null;
  secondary_language: string | null;
  race_ethnicity: string | null;
  marital_status: string | null;
  communication_needs: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  county: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  legal_guardian: string | null;
  guardian_phone: string | null;
  power_of_attorney: string | null;
  representative_payee: string | null;
  care_coordinator: string | null;
  physician: string | null;
  level_of_care: string | null;
  care_plan_review_date: string | null;
  care_plan_notes: string | null;
}

export interface ClientPayerItem {
  id: number;
  payer_id: string;
  program: string;
  waiver_code: string | null;
  waiver_name: string | null;
  effective_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface ClientAuthItem {
  id: number;
  service_code: string;
  service_description: string;
  auth_number: string | null;
  authorized_units: number;
  used_units: number;
  remaining_units: number;
  utilization_pct: number;
  service_start_date: string | null;
  service_end_date: string | null;
  is_active: boolean;
}

export interface ClientVisitItem {
  id: number;
  service_date: string;
  service_code: string | null;
  service_description: string | null;
  caregiver: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number;
  evv_status: string | null;
  approval_status: string | null;
}

export interface ClientNote {
  title: string;
  sub: string;
  text: string;
}

export interface ClientsResponse {
  total: number;
  page: number;
  per_page: number;
  stats: ClientStats;
  items: ClientSummary[];
}

export interface ClientCareTask {
  id: number;
  title: string;
  description: string | null;
  specific_time: string | null;
  recurrence_text: string | null;
  sort_order: number;
  completed_today: boolean;
  completed_on: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_notes: string | null;
}

export interface ClientCareTasksResponse {
  client_id: number;
  date: string;
  items: ClientCareTask[];
}

export interface ClientCareTaskCompletionRequest {
  completed: boolean;
  completed_on?: string;
  completion_notes?: string;
}

export interface ClientCareTaskCompletionResponse {
  client_id: number;
  task_id: number;
  completed: boolean;
  completed_on: string;
  completed_at: string | null;
  completed_by: string | null;
  completion_notes: string | null;
}

export interface ClientCareTaskInput {
  id?: number;
  title: string;
  description?: string;
  specific_time?: string;
  recurrence_text?: string;
  sort_order?: number;
}

const FALLBACK_STATS: ClientStats = {
  total_clients: 0,
  new_this_month: 0,
  active_care_plans: 0,
  due_for_review: 0,
  assigned_caregivers: 0,
  multi_staff_cases: 0,
  doc_flags: 0,
  urgent_followup: 0,
};

const FALLBACK: ClientsResponse = {
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

export async function getClients(
  page = 1,
  perPage = 20,
  status = '',
  search = '',
): Promise<ClientsResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const authHeaders = await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/clients?${params}`,
    `${API.replace('localhost', '127.0.0.1')}/api/clients?${params}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[clients] API unreachable — rendering with fallback');
  return FALLBACK;
}

export async function getClientDetail(
  clientId: number,
  token?: string,
): Promise<ClientDetail | null> {
  const headers: HeadersInit = token
    ? { Authorization: `Bearer ${token}` }
    : await getAuthHeaders();

  const urls = [...new Set([
    `${API}/api/clients/${clientId}`,
    `${API.replace('localhost', '127.0.0.1')}/api/clients/${clientId}`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  return null;
}

export async function getClientInsurance(
  clientId: number,
  token?: string,
): Promise<ClientPayerItem[]> {
  const headers: HeadersInit = token
    ? { Authorization: `Bearer ${token}` }
    : await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/clients/${clientId}/insurance`,
    `${API.replace('localhost', '127.0.0.1')}/api/clients/${clientId}/insurance`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  return [];
}

export async function getClientAuthorizations(
  clientId: number,
  token?: string,
): Promise<ClientAuthItem[]> {
  const headers: HeadersInit = token
    ? { Authorization: `Bearer ${token}` }
    : await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/clients/${clientId}/authorizations`,
    `${API.replace('localhost', '127.0.0.1')}/api/clients/${clientId}/authorizations`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  return [];
}

export async function getClientVisits(
  clientId: number,
  token?: string,
): Promise<ClientVisitItem[]> {
  const headers: HeadersInit = token
    ? { Authorization: `Bearer ${token}` }
    : await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/clients/${clientId}/visits`,
    `${API.replace('localhost', '127.0.0.1')}/api/clients/${clientId}/visits`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  return [];
}

export async function updateClient(
  id: number,
  payload: Record<string, string>,
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch(`/api/clients/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `Client update failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function getClientCareTasks(clientId: number): Promise<ClientCareTasksResponse> {
  const headers = await getAuthHeaders();
  const urls = [...new Set([
    `${API}/api/clients/${clientId}/care-tasks`,
    `${API.replace('localhost', '127.0.0.1')}/api/clients/${clientId}/care-tasks`,
  ])];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return res.json();
      throw new Error(`Failed to load care tasks (HTTP ${res.status})`);
    } catch (error) {
      if (url === urls[urls.length - 1]) throw error;
    }
  }
  throw new Error('Unable to load care tasks.');
}

export async function saveClientCareTasks(
  clientId: number,
  items: ClientCareTaskInput[],
): Promise<ClientCareTasksResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API}/api/clients/${clientId}/care-tasks`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
    cache: 'no-store',
  });
  if (res.ok) return res.json();
  const err = await res.json().catch(() => ({}));
  throw new Error(err.detail ?? `HTTP ${res.status}`);
}

export async function setClientCareTaskCompletion(
  clientId: number,
  taskId: number,
  payload: ClientCareTaskCompletionRequest,
  token: string,
): Promise<ClientCareTaskCompletionResponse> {
  const res = await fetch(`${API}/api/clients/${clientId}/care-tasks/${taskId}/completion`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (res.ok) return res.json();
  const err = await res.json().catch(() => ({}));
  throw new Error(err.detail ?? `HTTP ${res.status}`);
}
