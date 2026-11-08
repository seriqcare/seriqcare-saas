import { getAuthHeaders } from './server-auth';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';

export interface BillingEntry {
  visit_id: number;
  service_date: string;
  client_name: string;
  employee_name: string;
  service_code: string | null;
  billed_units: number | null;
  approved_units: number | null;
  evv_status: string | null;
  approval_status: string | null;
  sandata_status: string | null;
  hhax_status: string | null;
  default_rate: number | null;
  estimated_amount: number | null;
  claim_id: number | null;
  billing_status: string;
}

export interface BillingStats {
  total_visits: number;
  total_units: number;
  total_estimated_amount: number;
  ready_to_bill: number;
  pending_claims: number;
  approved: number;
  denied: number;
}

export interface BillingResponse {
  total: number;
  page: number;
  per_page: number;
  stats: BillingStats;
  items: BillingEntry[];
}

export interface BillingClaimResponse {
  id: number;
  claim_date: string;
  payer: string;
  status: string;
  total_units: number;
  total_amount: number;
  visit_count: number;
}

export interface BillingClaimListItem {
  id: number;
  claim_date: string;
  payer: string;
  status: string;
  total_units: number;
  total_amount: number;
  visit_count: number;
  created_at: string;
}

export interface BillingClaimListResponse {
  total: number;
  page: number;
  per_page: number;
  items: BillingClaimListItem[];
}

export interface BillingClaimLineItem {
  line_id: number;
  visit_id: number;
  service_date: string;
  client_name: string;
  employee_name: string;
  service_code: string | null;
  units: number;
  amount: number;
}

export interface BillingClaimDetail {
  id: number;
  claim_date: string;
  payer: string;
  status: string;
  total_units: number;
  total_amount: number;
  created_at: string;
  line_items: BillingClaimLineItem[];
}

export interface ClaimGroup {
  client_id: number;
  client_name: string;
  payer: string;
  service_authorization_id: number | null;
  period_start_date: string;
  period_end_date: string;
  visit_ids: number[];
  visit_count: number;
  total_units: number;
  total_amount: number;
}

export interface ClaimGroupPreview {
  groups: ClaimGroup[];
  total_groups: number;
  total_visits: number;
  total_units: number;
  total_amount: number;
}

export interface BulkGenerateResponse {
  claims_created: number;
  total_visits: number;
  total_units: number;
  total_amount: number;
  claim_ids: number[];
}

export interface AuthUtilizationItem {
  auth_id: number;
  client_id: number;
  client_name: string;
  service_code: string | null;
  auth_number: string | null;
  authorized_units: number;
  used_units: number;
  remaining_units: number;
  utilization_pct: number;
  service_start_date: string;
  service_end_date: string;
  days_until_expiry: number;
  is_active: boolean;
}

const FALLBACK_STATS: BillingStats = {
  total_visits: 0,
  total_units: 0,
  total_estimated_amount: 0,
  ready_to_bill: 0,
  pending_claims: 0,
  approved: 0,
  denied: 0,
};

const FALLBACK: BillingResponse = {
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
    return await fetch(url, { cache: 'no-store', signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

function apiUrls(path: string): string[] {
  return [...new Set([
    `${API}${path}`,
    `${API.replace('localhost', '127.0.0.1')}${path}`,
  ])];
}

export async function getBillingEntries(
  page = 1,
  perPage = 20,
  period = 'this_month',
  status = '',
  search = '',
): Promise<BillingResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage), period });
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const qs = params.toString();
  const authHeaders = await getAuthHeaders();
  for (const url of apiUrls(`/api/billing?${qs}`)) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[billing] /api/billing unreachable — rendering with fallback');
  return FALLBACK;
}

export async function getBillingStats(period = 'this_month'): Promise<BillingStats> {
  const qs = new URLSearchParams({ period }).toString();
  const authHeaders = await getAuthHeaders();
  for (const url of apiUrls(`/api/billing/stats?${qs}`)) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[billing] /api/billing/stats unreachable — rendering with fallback');
  return FALLBACK_STATS;
}

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function getClaimGroups(period: string, apiFetch: ApiFetch): Promise<ClaimGroupPreview> {
  const qs = new URLSearchParams({ period }).toString();
  const res = await apiFetch(`/api/billing/group-visits?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Claim preview failed (HTTP ${res.status})`);
  return res.json();
}

export async function generateBulkClaims(
  period: string,
  apiFetch: ApiFetch,
): Promise<{ success: boolean; result?: BulkGenerateResponse; message: string }> {
    try {
      const res = await apiFetch('/api/billing/generate-bulk', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      });
      if (res.ok) {
        const result: BulkGenerateResponse = await res.json();
        return { success: true, result, message: `${result.claims_created} claim(s) created` };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: (err as { detail?: string }).detail ?? `HTTP ${res.status}` };
    } catch { return { success: false, message: 'API unreachable' }; }
}

export async function updateClaimStatus(
  claimId: number,
  status: string,
  apiFetch: ApiFetch,
): Promise<{ success: boolean; updated?: BillingClaimListItem; message: string }> {
    try {
      const res = await apiFetch(`/api/billing/claims/${claimId}/status`, {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated: BillingClaimListItem = await res.json();
        return { success: true, updated, message: `Status updated to ${status}` };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: (err as { detail?: string }).detail ?? `HTTP ${res.status}` };
    } catch { return { success: false, message: 'API unreachable' }; }
}

export async function getClaimsList(
  page = 1,
  perPage = 20,
  status = '',
): Promise<BillingClaimListResponse> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) params.set('status', status);
  const authHeaders = await getAuthHeaders();
  for (const url of apiUrls(`/api/billing/claims?${params}`)) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  return { total: 0, page, per_page: perPage, items: [] };
}

export async function getClaimDetail(claimId: number): Promise<BillingClaimDetail | null> {
  const authHeaders = await getAuthHeaders();
  for (const url of apiUrls(`/api/billing/claims/${claimId}`)) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
      if (res.status === 404) return null;
    } catch { /* try next */ }
  }
  return null;
}

export function claimExportUrl(claimId: number, format: 'csv' | '837p' = 'csv'): string {
  return `${API}/api/billing/claims/${claimId}/export?format=${format}`;
}

export function billingExportUrl(period: string): string {
  return `${API}/api/billing/export?period=${period}`;
}

export async function getIntegrationMode(): Promise<'SANDATA' | 'HHAX'> {
  const authHeaders = await getAuthHeaders();
  for (const url of apiUrls('/api/settings/agency')) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) {
        const data = await res.json();
        if (data.integration_mode === 'HHAX') return 'HHAX';
        return 'SANDATA';
      }
    } catch { /* try next */ }
  }
  return 'SANDATA';
}

export async function getAuthUtilization(
  limit = 10,
  expiringDays = 0,
): Promise<AuthUtilizationItem[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (expiringDays > 0) params.set('expiring_days', String(expiringDays));
  const qs = params.toString();
  const authHeaders = await getAuthHeaders();
  for (const url of apiUrls(`/api/billing/auth-utilization?${qs}`)) {
    try {
      const res = await fetchWithTimeout(url, 8000, authHeaders);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  console.warn('[billing] /api/billing/auth-utilization unreachable — rendering with fallback');
  return [];
}

export async function generateClaim(
  visitIds: number[],
  payer: string,
): Promise<{ success: boolean; claim?: BillingClaimResponse; message: string }> {
  for (const url of apiUrls('/api/billing/generate')) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_ids: visitIds, payer }),
      });
      if (res.ok) {
        const claim: BillingClaimResponse = await res.json();
        return { success: true, claim, message: `Claim #${claim.id} created` };
      }
      const err = await res.json().catch(() => ({}));
      return { success: false, message: (err as { detail?: string }).detail ?? `HTTP ${res.status}` };
    } catch { /* try next */ }
  }
  return { success: false, message: 'API unreachable' };
}
