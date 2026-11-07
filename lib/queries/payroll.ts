import { getAuthHeaders } from './server-auth';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';

export type PayType = 'Hourly' | 'Per Visit';

export interface PayrollRateItem {
  id?: number;
  name: string;
  pay_type: PayType;
  rate: number;
  applies_on?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  effective_date?: string | null;
  sort_order: number;
  is_base_rate: boolean;
}

export interface PayrollGroup {
  id?: number;
  name: string;
  description?: string | null;
  items: PayrollRateItem[];
}

export type PayPeriodFrequency = 'daily' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export type WeekStartDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface PayrollPayPeriod {
  frequency: PayPeriodFrequency;
  week_starts_on?: WeekStartDay | null;
  anchor_date?: string | null;
  monthly_day?: number | null;
  semi_monthly_days: number[];
}

export interface PayrollSettingsResponse {
  groups: PayrollGroup[];
  pay_period: PayrollPayPeriod;
}

export interface CaregiverPayrollSettingsResponse {
  caregiver_id: number;
  pay_group_id?: number | null;
  pay_group_rate_id?: number | null;
  pay_group_name?: string | null;
  pay_rate_name?: string | null;
  pay_type?: PayType | null;
  pay_rate?: number | null;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const urls = [...new Set([
    `${API}${path}`,
    `${API.replace('localhost', '127.0.0.1')}${path}`,
  ])];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...authHeaders, ...(init?.headers ?? {}) },
        ...init,
      });
      return res;
    } catch {
      continue;
    }
  }

  throw new Error('API unreachable');
}

export async function getPayrollSettings(): Promise<PayrollSettingsResponse> {
  const res = await apiFetch('/api/settings/payroll');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to load payroll settings');
  return res.json();
}

export async function savePayrollSettings(payload: { groups: PayrollGroup[]; pay_period: PayrollPayPeriod }): Promise<PayrollSettingsResponse> {
  const res = await apiFetch('/api/settings/payroll', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to save payroll settings');
  return res.json();
}

export function createDefaultPayPeriod(): PayrollPayPeriod {
  return {
    frequency: 'weekly',
    week_starts_on: 'monday',
    anchor_date: null,
    monthly_day: null,
    semi_monthly_days: [1, 15],
  };
}

export async function getCaregiverPayroll(caregiverId: number): Promise<CaregiverPayrollSettingsResponse> {
  const res = await apiFetch(`/api/caregivers/${caregiverId}/payroll`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to load caregiver payroll settings');
  return res.json();
}

export async function saveCaregiverPayroll(
  caregiverId: number,
  payload: { pay_group_id?: number | null; pay_group_rate_id?: number | null },
): Promise<{ success: boolean; caregiver_id: number; message: string }> {
  const res = await apiFetch(`/api/caregivers/${caregiverId}/payroll`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to save caregiver payroll settings');
  return res.json();
}

export function createBlankPayrollGroup(index: number): PayrollGroup {
  return {
    name: `Pay Group ${index + 1}`,
    description: '',
    items: [
      {
        name: 'Base rate',
        pay_type: 'Hourly',
        rate: 0,
        applies_on: '',
        start_time: '',
        end_time: '',
        effective_date: '',
        sort_order: 0,
        is_base_rate: true,
      },
    ],
  };
}