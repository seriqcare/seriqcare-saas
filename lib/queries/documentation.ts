/**
 * Server-side and shared type definitions for the Documentation Template Builder.
 * Server Components call these functions directly (they read the seriqcare-at cookie).
 * Client Components use apiFetch() from useAuth() with the same API paths.
 */
import { getAuthHeaders } from './server-auth';

const API =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://127.0.0.1:8000';

// ---------------------------------------------------------------------------
// Shared types (mirror backend documentation_schemas.py)
// ---------------------------------------------------------------------------

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldSchema {
  key: string;
  type: string;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  required: boolean;
  default_value: unknown;
  options: FieldOption[] | null;
  min_length: number | null;
  max_length: number | null;
  min_value: number | null;
  max_value: number | null;
  sort_order: number;
  width: string | null;
  is_active: boolean;
}

export interface SectionSchema {
  key: string;
  title: string;
  description: string | null;
  sort_order: number;
  fields: FieldSchema[];
}

export interface TemplateSchemaBody {
  sections: SectionSchema[];
}

export interface TemplateSummary {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  status: 'draft' | 'published' | 'archived';
  current_version: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface TemplateDetail extends TemplateSummary {
  template_schema: TemplateSchemaBody | null;
  version_id: number | null;
}

export interface TemplateListResponse {
  total: number;
  items: TemplateSummary[];
}

export interface SubmissionSummary {
  id: number;
  template_id: number;
  template_name: string;
  template_version_number: number;
  patient_id: number | null;
  patient_name: string | null;
  staff_id: number | null;
  staff_name: string | null;
  status: 'draft' | 'submitted' | 'reviewed' | 'approved';
  created_at: string | null;
  submitted_at: string | null;
  updated_at: string | null;
}

export interface SubmissionDetail extends SubmissionSummary {
  template_version_id: number;
  visit_id: number | null;
  values: Record<string, unknown>;
  template_schema: TemplateSchemaBody | null;
}

export interface SubmissionListResponse {
  total: number;
  items: SubmissionSummary[];
}

export const TEMPLATE_CATEGORIES = [
  { value: 'progress_note',    label: 'Progress Note' },
  { value: 'service_note',     label: 'Service Note' },
  { value: 'incident_report',  label: 'Incident Report' },
  { value: 'medication_log',   label: 'Medication Log' },
  { value: 'supervisor_note',  label: 'Supervisor Note' },
  { value: 'care_plan',        label: 'Care Plan' },
  { value: 'assessment',       label: 'Assessment' },
  { value: 'other',            label: 'Other' },
];

export const FIELD_TYPES = [
  { value: 'short_text',             label: 'Short Text' },
  { value: 'long_text',              label: 'Long Text' },
  { value: 'number',                 label: 'Number' },
  { value: 'date',                   label: 'Date' },
  { value: 'time',                   label: 'Time' },
  { value: 'datetime',               label: 'Date & Time' },
  { value: 'dropdown',               label: 'Dropdown' },
  { value: 'radio',                  label: 'Radio Buttons' },
  { value: 'checkbox',               label: 'Checkboxes' },
  { value: 'yes_no',                 label: 'Yes / No' },
  { value: 'signature_placeholder',  label: 'Signature (placeholder)' },
  { value: 'file_upload_placeholder',label: 'File Upload (placeholder)' },
  { value: 'instruction_block',      label: 'Instruction Block (display only)' },
  { value: 'staff_selector',         label: 'Staff Selector' },
  { value: 'patient_selector',       label: 'Patient Selector' },
];

export const DISPLAY_ONLY_TYPES = new Set([
  'instruction_block',
  'signature_placeholder',
  'file_upload_placeholder',
]);

export const OPTIONS_REQUIRED_TYPES = new Set(['dropdown', 'radio', 'checkbox']);

// ---------------------------------------------------------------------------
// Server-side fetch helpers (used by Next.js Server Components)
// Mirrors the resilient pattern from lib/queries/clients.ts:
//   - try localhost then 127.0.0.1 fallback
//   - catch network errors and return safe empty state
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 8000;

function apiUrls(path: string): string[] {
  return [...new Set([
    `${API}${path}`,
    `${API.replace('localhost', '127.0.0.1')}${path}`,
  ])];
}

async function apiFetchServer(path: string, headers: HeadersInit): Promise<Response | null> {
  for (const url of apiUrls(path)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        if (res.ok || res.status < 500) return res; // surface 4xx to caller
      } finally {
        clearTimeout(timer);
      }
    } catch { /* try next URL */ }
  }
  return null;
}

export async function getTemplates(params?: {
  status?: string;
  category?: string;
  skip?: number;
  take?: number;
}): Promise<TemplateListResponse> {
  const headers = await getAuthHeaders();
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.category) q.set('category', params.category);
  if (params?.skip != null) q.set('skip', String(params.skip));
  if (params?.take != null) q.set('take', String(params.take));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetchServer(`/api/documentation/templates${qs}`, headers);
  if (!res || !res.ok) return { total: 0, items: [] };
  return res.json();
}

export async function getTemplate(id: number, version?: number): Promise<TemplateDetail | null> {
  const headers = await getAuthHeaders();
  const qs = version != null ? `?version=${version}` : '';
  const res = await apiFetchServer(`/api/documentation/templates/${id}${qs}`, headers);
  if (!res || !res.ok) return null;
  return res.json();
}

export async function getTemplateForFill(id: number): Promise<TemplateDetail | null> {
  const headers = await getAuthHeaders();
  const res = await apiFetchServer(`/api/documentation/templates/${id}/fill`, headers);
  if (!res || !res.ok) return null;
  return res.json();
}

export async function getSubmissions(params?: {
  template_id?: number;
  patient_id?: number;
  status?: string;
  skip?: number;
  take?: number;
}): Promise<SubmissionListResponse> {
  const headers = await getAuthHeaders();
  const q = new URLSearchParams();
  if (params?.template_id) q.set('template_id', String(params.template_id));
  if (params?.patient_id) q.set('patient_id', String(params.patient_id));
  if (params?.status) q.set('status', params.status);
  if (params?.skip != null) q.set('skip', String(params.skip));
  if (params?.take != null) q.set('take', String(params.take));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetchServer(`/api/documentation/submissions${qs}`, headers);
  if (!res || !res.ok) return { total: 0, items: [] };
  return res.json();
}

export async function getSubmission(id: number): Promise<SubmissionDetail | null> {
  const headers = await getAuthHeaders();
  const res = await apiFetchServer(`/api/documentation/submissions/${id}`, headers);
  if (!res || !res.ok) return null;
  return res.json();
}

