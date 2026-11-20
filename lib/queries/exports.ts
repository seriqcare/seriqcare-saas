export type ExportKind = 'billing' | 'payroll';
export interface ExportVisit {
  visit_id: number; service_date: string; client_name: string; caregiver_name: string;
  service_code: string | null; units: number; hours: number; amount: number; rate: number | null;
  status: 'Pending Approval' | 'Approved' | 'Ready for Export' | 'Exported';
  reasons: string[]; export_id: number | null; evv_status: string | null; approval_status: string;
  authorization_id?: number | null; visit_approved?: boolean;
}
export interface ExportReadiness {
  items: ExportVisit[]; period_start: string; period_end: string;
  stats: { total: number; ready: number; blocked: number; exported: number; ready_amount: number; period_amount?: number; ready_hours: number; ready_units: number };
}
export interface ExportBatch {
  id: number; kind: ExportKind; provider: string; visit_count: number;
  period_start: string; period_end: string; created_at: string; created_by_name: string;
  total_hours: number; total_units: number; total_amount: number;
}
export interface ExportDetail extends ExportBatch { items: { visit_id: number; data: Record<string, string | number> }[] }
export type ExportFetch = (url: string, init?: RequestInit) => Promise<Response>;
export async function exportJson<T>(apiFetch: ExportFetch, url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : `Export request failed (HTTP ${response.status}).`), { status: response.status });
  return data;
}
