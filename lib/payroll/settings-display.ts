import type { PayrollGroup, PayrollPayPeriod } from '@/lib/queries/payroll';

export const FREQUENCIES = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Biweekly'],
  ['semimonthly', 'Semimonthly'], ['monthly', 'Monthly'],
] as const;
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export const baseRate = (group: PayrollGroup) => group.items.find(item => item.is_base_rate) ?? group.items[0];
export function payGroupNeedsReview(group: PayrollGroup) {
  const base = baseRate(group);
  return !base || base.rate <= 0 || !base.effective_date || base.effective_date < '2000-01-01';
}
export function payrollDate(value?: string | null) {
  if (!value) return 'Not set';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Not set' : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}
export function scheduleSummary(period: PayrollPayPeriod) {
  const day = period.week_starts_on || 'monday';
  const capitalized = day.charAt(0).toUpperCase() + day.slice(1);
  switch (period.frequency) {
    case 'daily': return 'Each calendar day is a pay period.';
    case 'weekly': return `Pay periods begin on ${capitalized}.`;
    case 'biweekly': return `Every two weeks from ${payrollDate(period.anchor_date)}, beginning on ${capitalized}.`;
    case 'monthly': return `Monthly periods close on day ${period.monthly_day || 1}. Shorter months close on their last day.`;
    case 'semimonthly': return `Periods close on days ${period.semi_monthly_days.join(' and ')} each month.`;
  }
}
export function normalizePayrollPeriod(period: PayrollPayPeriod): PayrollPayPeriod {
  return {
    frequency: period.frequency,
    week_starts_on: ['weekly', 'biweekly'].includes(period.frequency) ? period.week_starts_on || 'monday' : null,
    anchor_date: period.frequency === 'biweekly' ? period.anchor_date || null : null,
    monthly_day: period.frequency === 'monthly' ? Number(period.monthly_day || 1) : null,
    semi_monthly_days: period.frequency === 'semimonthly' ? [...new Set(period.semi_monthly_days)].sort((a, b) => a - b) : [],
  };
}
