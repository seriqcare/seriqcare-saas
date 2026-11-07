'use client';

import { FormEvent, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { useAuth } from '@/components/auth-context';
import { getAllProviders, getProvider, ProviderId, PAYROLL_PROVIDER_KEY } from '@/lib/payroll/providers';
import { createBlankPayrollGroup, createDefaultPayPeriod, getPayrollSettings, savePayrollSettings, type PayrollGroup, type PayrollPayPeriod, type PayrollRateItem, type WeekStartDay } from '@/lib/queries/payroll';
import { AGGREGATOR_SANDATA_KEY, AGGREGATOR_HHAX_KEY } from '@/components/aggregator-off-banner';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

type Tab = 'general' | 'notifications' | 'billing' | 'security' | 'payroll' | 'integrations';
type IntegrationFilter = 'all' | 'payroll' | 'aggregator' | 'hr';

const PAY_TYPE_OPTIONS = ['Hourly', 'Per Visit'] as const;
const PAY_PERIOD_FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'semimonthly', label: 'Semi-Monthly' },
  { value: 'monthly', label: 'Monthly' },
] as const;
const WEEK_START_OPTIONS: { value: WeekStartDay; label: string }[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];
const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1);

/* ── Agency form ──────────────────────────────────────────────────────────── */
type AgencyForm = {
  agencyName: string; email: string; phone: string;
  address: string; website: string; timezone: string;
  currency: string; defaultHourlyRate: string;
};
const DEFAULT_AGENCY: AgencyForm = {
  agencyName: '', email: '',
  phone: '', address: '',
  website: '', timezone: 'America/New_York', currency: 'usd', defaultHourlyRate: '',
};

/* ── Notification settings ────────────────────────────────────────────────── */
type NotifKey = 'newClient' | 'timesheetSubmitted' | 'missedClockIn' |
                'paymentReceived' | 'scheduleChanges' | 'weeklyReport';
type NotifSettings = Record<NotifKey, boolean>;
const DEFAULT_NOTIFS: NotifSettings = {
  newClient: true, timesheetSubmitted: true, missedClockIn: true,
  paymentReceived: true, scheduleChanges: false, weeklyReport: true,
};

/* ── Password form types ──────────────────────────────────────────────────── */
type PortalForm = { currentPassword: string; newPassword: string; confirmPassword: string };
type MobileForm = { username: string; newPassword: string; confirmPassword: string };

/* ── Aggregator settings ──────────────────────────────────────────────────── */
type SandataForm = {
  sandata_enabled: boolean;
  sandata_medicaid_provider_id: string;
  sandata_national_provider_id: string;
  sandata_provider_qualifier: string;
  sandata_business_entity_id: string;
  sandata_user_id: string;
  sandata_tax_id: string;
  sandata_password: string;
  sandata_mode: 'simulate' | 'live';
};
type HhaxForm = {
  hhax_enabled: boolean;
  hhax_provider_id: string;
  hhax_branch_id: string;
  hhax_business_entity_id: string;
  hhax_user_id: string;
  hhax_tax_id: string;
  hhax_password: string;
  hhax_mode: 'test' | 'production';
};
const DEFAULT_SANDATA: SandataForm = {
  sandata_enabled: false,
  sandata_medicaid_provider_id: '', sandata_national_provider_id: '',
  sandata_provider_qualifier: '', sandata_business_entity_id: '',
  sandata_user_id: '', sandata_tax_id: '', sandata_password: '',
  sandata_mode: 'simulate',
};
const DEFAULT_HHAX: HhaxForm = {
  hhax_enabled: false,
  hhax_provider_id: '', hhax_branch_id: '', hhax_business_entity_id: '',
  hhax_user_id: '', hhax_tax_id: '', hhax_password: '',
  hhax_mode: 'test',
};

/* ── Integration configs ──────────────────────────────────────────────────── */
type ISolvedConfig = {
  enabled: boolean;
  client_id: string;
  code_regular: string;
  code_overtime: string;
  code_double_time: string;
  code_personal_time: string;
  code_holiday: string;
};
type ADPConfig = {
  enabled: boolean;
  company_code: string;
  code_regular: string;
  code_overtime: string;
  code_double_time: string;
  code_personal_time: string;
  code_holiday: string;
};
const DEFAULT_ISOLVED: ISolvedConfig = {
  enabled: false, client_id: '',
  code_regular: 'Reg', code_overtime: 'OT', code_double_time: 'DBT',
  code_personal_time: 'PTO', code_holiday: 'HOLI',
};
const DEFAULT_ADP: ADPConfig = {
  enabled: false, company_code: '',
  code_regular: 'REG', code_overtime: 'OT', code_double_time: 'DBT',
  code_personal_time: 'PTO', code_holiday: 'HOL',
};
const ISOLVED_KEY = 'seriqcare-integration-isolved';
const ADP_KEY    = 'seriqcare-integration-adp';

/* ── Toggle switch component ─────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        position: 'relative', flexShrink: 0, transition: 'background .2s',
        background: checked ? 'var(--primary)' : '#c8d0da',
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: 8,
        background: '#fff', transition: 'left .2s',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function SuccessBanner({ msg }: { msg: string }) {
  return (
    <div style={{ fontSize: 12, color: '#1b5e20', background: '#f1f8e9', border: '1px solid #c5e1a5', borderRadius: 4, padding: '7px 10px' }}>
      {msg}
    </div>
  );
}
function ErrorBanner({ msg }: { msg: string }) {
  return <div className="error-text" style={{ marginTop: 0 }}>{msg}</div>;
}

function clonePayrollGroups(groups: PayrollGroup[]) {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
  }));
}

function clonePayPeriod(payPeriod: PayrollPayPeriod): PayrollPayPeriod {
  return {
    ...payPeriod,
    semi_monthly_days: [...payPeriod.semi_monthly_days],
  };
}

function formatOrdinalDay(day: number) {
  const remainder = day % 10;
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  if (remainder === 1) return `${day}st`;
  if (remainder === 2) return `${day}nd`;
  if (remainder === 3) return `${day}rd`;
  return `${day}th`;
}

function summarizePayPeriod(payPeriod: PayrollPayPeriod) {
  const weekStartLabel = WEEK_START_OPTIONS.find((option) => option.value === payPeriod.week_starts_on)?.label ?? 'Monday';
  switch (payPeriod.frequency) {
    case 'daily':
      return 'Every calendar day.';
    case 'weekly':
      return `Weekly periods beginning on ${weekStartLabel}.`;
    case 'biweekly':
      return payPeriod.anchor_date
        ? `Every 2 weeks, starting ${payPeriod.anchor_date}, with weeks beginning on ${weekStartLabel}.`
        : `Every 2 weeks, with weeks beginning on ${weekStartLabel}.`;
    case 'monthly':
      return `Monthly periods closing on the ${formatOrdinalDay(payPeriod.monthly_day ?? 1)}.`;
    case 'semimonthly': {
      const [firstDay = 1, secondDay = 15] = payPeriod.semi_monthly_days;
      return `Two periods per month, closing on the ${formatOrdinalDay(firstDay)} and ${formatOrdinalDay(secondDay)}.`;
    }
    default:
      return 'Weekly periods beginning on Monday.';
  }
}

function normalizePayPeriodForSave(payPeriod: PayrollPayPeriod): PayrollPayPeriod {
  const semiMonthlyDays = [...payPeriod.semi_monthly_days]
    .map((day) => Number(day))
    .filter((day, index, days) => Number.isInteger(day) && day >= 1 && day <= 31 && days.indexOf(day) === index)
    .sort((left, right) => left - right);

  return {
    frequency: payPeriod.frequency,
    week_starts_on: payPeriod.frequency === 'weekly' || payPeriod.frequency === 'biweekly'
      ? (payPeriod.week_starts_on ?? 'monday')
      : null,
    anchor_date: payPeriod.frequency === 'biweekly' ? (payPeriod.anchor_date || null) : null,
    monthly_day: payPeriod.frequency === 'monthly' ? Number(payPeriod.monthly_day || 1) : null,
    semi_monthly_days: payPeriod.frequency === 'semimonthly'
      ? (semiMonthlyDays.length >= 2 ? semiMonthlyDays.slice(0, 2) : [1, 15])
      : [1, 15],
  };
}

function formatPayrollRate(rate: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(rate || 0);
}

function describePayrollItem(item: PayrollRateItem) {
  const details = [item.pay_type, formatPayrollRate(item.rate)];
  if (item.applies_on?.trim()) details.push(item.applies_on.trim());
  if (item.effective_date) details.push(`Effective ${item.effective_date}`);
  return details.join(' | ');
}

const payrollActionButtonStyle = {
  minWidth: 96,
  justifyContent: 'center',
  display: 'inline-flex',
};

/* ── Integration card logos ──────────────────────────────────────────────── */
function ISolvedLogo() {
  return (
    <div style={{ width: 48, height: 48, borderRadius: 10, background: '#1c1c2e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/isolved-logo.png" alt="" style={{ width: 32, height: 32, objectFit: 'contain' }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, letterSpacing: '-.3px', display: 'none' }}>iS</span>
    </div>
  );
}

function ISolvedLogoFallback() {
  return (
    <div style={{ width: 48, height: 48, borderRadius: 10, background: '#1c1c2e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: '#fff', fontSize: 12, fontWeight: 900, letterSpacing: '-.3px' }}>iS</span>
    </div>
  );
}

function ADPLogo() {
  return (
    <div style={{ width: 48, height: 48, borderRadius: 10, background: '#cc0000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, letterSpacing: '1.5px', lineHeight: 1 }}>ADP</span>
    </div>
  );
}

function UniversalLogo() {
  return (
    <div style={{ width: 48, height: 48, borderRadius: 10, background: '#2c3e50', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    </div>
  );
}

function SandataLogo() {
  return (
    <div style={{ width: 48, height: 48, borderRadius: 10, background: '#2567a4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: '#fff', fontSize: 18, fontWeight: 900 }}>S</span>
    </div>
  );
}

function HHAXLogo() {
  return (
    <div style={{ width: 48, height: 48, borderRadius: 10, background: '#1F8C8A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: '#fff', fontSize: 18, fontWeight: 900 }}>H</span>
    </div>
  );
}

/* ── Integration card ────────────────────────────────────────────────────── */
function IntegrationCard({
  logo, name, description, connected, onAction, alwaysConnected,
}: {
  logo: ReactNode;
  name: string;
  description: string;
  connected: boolean;
  onAction?: () => void;
  alwaysConnected?: boolean;
}) {
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 12, padding: '20px 20px 16px',
      background: '#fff', display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {logo}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{description}</div>
        </div>
      </div>
      {connected && (
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#35693c', background: '#e8f5e9',
          border: '1px solid #cfe5d2', borderRadius: 99, padding: '3px 10px',
          alignSelf: 'flex-start', letterSpacing: '.04em', textTransform: 'uppercase',
        }}>
          Connected
        </div>
      )}
      {!alwaysConnected && (
        <button
          className={connected ? 'btn secondary' : 'btn'}
          style={{ width: '100%', height: 38, fontSize: 13 }}
          onClick={onAction}
        >
          {connected ? 'Configure' : 'Connect'}
        </button>
      )}
      {alwaysConnected && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Built-in · always available</div>
      )}
    </div>
  );
}

/* ── Earning codes table ─────────────────────────────────────────────────── */
type IntegrationCodeKey = Exclude<keyof ISolvedConfig & keyof ADPConfig, 'enabled'>;

const EARNING_ROWS: [string, string, IntegrationCodeKey][] = [
  ['Regular',       'Reg',     'code_regular'],
  ['Overtime',      'OT',      'code_overtime'],
  ['Double Time',   'DBT',     'code_double_time'],
  ['Personal Time', 'PTO',     'code_personal_time'],
  ['Holiday',       'Holiday', 'code_holiday'],
];

function EarningCodesTable<T extends ISolvedConfig | ADPConfig>({
  draft, onChange, codeLabel,
}: {
  draft: T;
  onChange: (patch: Partial<T>) => void;
  codeLabel: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Map Earning Codes</div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#f8fafc', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--line)' }}>
          <div>Earning Code Type</div>
          <div>Abbreviation</div>
          <div>{codeLabel}</div>
        </div>
        {EARNING_ROWS.map(([label, abbr, key], idx) => (
          <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '8px 12px', alignItems: 'center', borderBottom: idx < EARNING_ROWS.length - 1 ? '1px solid var(--line-soft)' : undefined }}>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>{label}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{abbr}</div>
            <input
              className="input"
              style={{ height: 32, fontSize: 13 }}
              value={draft[key] ?? ''}
              onChange={e => onChange({ [key]: e.target.value } as Partial<T>)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Modal wrapper ───────────────────────────────────────────────────────── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--muted)', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <ProtectedLayout>
          <div className="topbar">
            <div>
              <h1 className="page-title">Settings</h1>
              <p className="page-subtitle">Loading agency settings...</p>
            </div>
            <div className="top-actions"><HeaderUser /></div>
          </div>
        </ProtectedLayout>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent() {
  const { user, apiFetch } = useAuth();
  const searchParams = useSearchParams();
  const aggregatorRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
    const valid: Tab[] = ['general', 'notifications', 'billing', 'security', 'payroll', 'integrations'];
    // backwards compat: ?tab=aggregator → integrations
    if (t === 'aggregator') return 'integrations';
    return (valid.includes(t as Tab) ? t : 'general') as Tab;
  });

  /* General */
  const [agency, setAgency] = useState<AgencyForm>(DEFAULT_AGENCY);
  const [agencySnapshot, setAgencySnapshot] = useState<AgencyForm>(DEFAULT_AGENCY);
  const [agencyEditing, setAgencyEditing] = useState(false);
  const [agencySaving, setAgencySaving] = useState(false);
  const [agencyMsg, setAgencyMsg] = useState('');
  const [agencyErr, setAgencyErr] = useState('');

  /* Notifications */
  const [notifs, setNotifs] = useState<NotifSettings>(DEFAULT_NOTIFS);

  /* Billing — provider identity */
  const [billing, setBilling] = useState({ npi: '', taxonomy: '', ein: '', medicaid: '' });
  const [billingMsg, setBillingMsg] = useState('');

  /* Billing — Sandata */
  const [sandata, setSandata] = useState({ providerId: '', apiMode: 'simulate', apiKey: '' });
  const [sandataMsg, setSandataMsg] = useState('');

  /* Security — Portal (self-service change password) */
  const [portal, setPortal] = useState<PortalForm>({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');
  const [portalErr, setPortalErr] = useState('');

  /* Security — Mobile (admin resets caregiver password) */
  const [mobile, setMobile] = useState<MobileForm>({ username: '', newPassword: '', confirmPassword: '' });
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobileMsg, setMobileMsg] = useState('');
  const [mobileErr, setMobileErr] = useState('');

  /* Payroll provider */
  const [payrollProvider,      setPayrollProvider]      = useState<ProviderId>('universal');
  const [payrollProviderSaved, setPayrollProviderSaved] = useState(false);
  const [payGroups, setPayGroups] = useState<PayrollGroup[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [payrollMsg, setPayrollMsg] = useState('');
  const [payrollErr, setPayrollErr] = useState('');
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [editingPayrollProvider, setEditingPayrollProvider] = useState(false);
  const [editingPayGroups, setEditingPayGroups] = useState(false);
  const [editingPayPeriod, setEditingPayPeriod] = useState(false);
  const [payrollProviderSnapshot, setPayrollProviderSnapshot] = useState<ProviderId>('universal');
  const [payGroupsSnapshot, setPayGroupsSnapshot] = useState<PayrollGroup[]>([]);
  const [payPeriod, setPayPeriod] = useState<PayrollPayPeriod>(createDefaultPayPeriod());
  const [payPeriodSnapshot, setPayPeriodSnapshot] = useState<PayrollPayPeriod>(createDefaultPayPeriod());

  /* Aggregator — Sandata */
  const [sandataCfg,       setSandataCfg]       = useState<SandataForm>(DEFAULT_SANDATA);
  const [sandataAggSaving, setSandataAggSaving] = useState(false);
  const [sandataAggMsg,    setSandataAggMsg]    = useState('');
  const [sandataAggErr,    setSandataAggErr]    = useState('');

  /* Aggregator — HHAeXchange */
  const [hhaxCfg,       setHhaxCfg]       = useState<HhaxForm>(DEFAULT_HHAX);
  const [hhaxAggSaving, setHhaxAggSaving] = useState(false);
  const [hhaxAggMsg,    setHhaxAggMsg]    = useState('');
  const [hhaxAggErr,    setHhaxAggErr]    = useState('');

  /* Integrations */
  const [intFilter, setIntFilter]           = useState<IntegrationFilter>('all');
  const [iSolvedCfg, setISolvedCfg]         = useState<ISolvedConfig>(DEFAULT_ISOLVED);
  const [adpCfg, setAdpCfg]                 = useState<ADPConfig>(DEFAULT_ADP);
  const [iSolvedDraft, setISolvedDraft]     = useState<ISolvedConfig>(DEFAULT_ISOLVED);
  const [adpDraft, setAdpDraft]             = useState<ADPConfig>(DEFAULT_ADP);
  const [showISolvedModal, setShowISolvedModal] = useState(false);
  const [showADPModal, setShowADPModal]         = useState(false);
  const [showSandataModal, setShowSandataModal] = useState(false);
  const [showHhaxModal, setShowHhaxModal]       = useState(false);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/settings/agency`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const nextAgency: AgencyForm = {
          agencyName: data.agencyName ?? '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          website: data.website ?? '',
          timezone: data.timezone ?? 'America/New_York',
          currency: data.currency ?? 'usd',
          defaultHourlyRate: data.defaultHourlyRate ?? '',
        };
        setAgency(nextAgency);
        setAgencySnapshot(nextAgency);
      })
      .catch(() => {});
  }, [apiFetch]);

  useEffect(() => {
    const stored = localStorage.getItem(PAYROLL_PROVIDER_KEY) as ProviderId | null;
    if (stored) {
      setPayrollProvider(stored);
      setPayrollProviderSnapshot(stored);
    }

    getPayrollSettings()
      .then((data) => {
        setPayGroups(data.groups);
        setPayGroupsSnapshot(clonePayrollGroups(data.groups));
        setPayPeriod(clonePayPeriod(data.pay_period));
        setPayPeriodSnapshot(clonePayPeriod(data.pay_period));
      })
      .catch((error: Error) => setPayrollErr(error.message))
      .finally(() => setPayrollLoading(false));
  }, []);

  useEffect(() => {
    try {
      const rawS = localStorage.getItem(AGGREGATOR_SANDATA_KEY);
      if (rawS) setSandataCfg(s => ({ ...s, ...JSON.parse(rawS) }));
      const rawH = localStorage.getItem(AGGREGATOR_HHAX_KEY);
      if (rawH) setHhaxCfg(h => ({ ...h, ...JSON.parse(rawH) }));
      const rawI = localStorage.getItem(ISOLVED_KEY);
      if (rawI) setISolvedCfg(prev => ({ ...prev, ...JSON.parse(rawI) }));
      const rawA = localStorage.getItem(ADP_KEY);
      if (rawA) setAdpCfg(prev => ({ ...prev, ...JSON.parse(rawA) }));
    } catch { /* ignore */ }
    if (searchParams.get('tab') === 'aggregator') {
      setTab('integrations');
      setTimeout(() => aggregatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
  }, [searchParams]);

  /* ── Payroll provider handlers ─────────────────────────────────────────── */
  const savePayrollProvider = () => {
    localStorage.setItem(PAYROLL_PROVIDER_KEY, payrollProvider);
    setPayrollProviderSnapshot(payrollProvider);
    setEditingPayrollProvider(false);
    setPayrollProviderSaved(true);
    setTimeout(() => setPayrollProviderSaved(false), 3000);
  };
  const startPayrollProviderEdit = () => {
    setPayrollProviderSnapshot(payrollProvider);
    setPayrollProviderSaved(false);
    setEditingPayrollProvider(true);
  };
  const cancelPayrollProviderEdit = () => {
    setPayrollProvider(payrollProviderSnapshot);
    setEditingPayrollProvider(false);
  };

  const updatePayGroup = (groupIndex: number, patch: Partial<PayrollGroup>) => {
    setPayGroups((current) => current.map((group, index) => index === groupIndex ? { ...group, ...patch } : group));
  };
  const updatePayItem = (groupIndex: number, itemIndex: number, patch: Partial<PayrollRateItem>) => {
    setPayGroups((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      const nextItems = group.items.map((item, idx) => idx === itemIndex ? { ...item, ...patch } : item);
      if (patch.is_base_rate) {
        return { ...group, items: nextItems.map((item, idx) => ({ ...item, is_base_rate: idx === itemIndex })) };
      }
      return { ...group, items: nextItems };
    }));
  };
  const addPayGroup = () => setPayGroups((current) => [...current, createBlankPayrollGroup(current.length)]);
  const startPayGroupsEdit = () => {
    setPayGroupsSnapshot(clonePayrollGroups(payGroups));
    setPayrollErr('');
    setPayrollMsg('');
    setEditingPayGroups(true);
  };
  const cancelPayGroupsEdit = () => {
    setPayGroups(clonePayrollGroups(payGroupsSnapshot));
    setPayrollErr('');
    setEditingPayGroups(false);
  };
  const startPayPeriodEdit = () => {
    setPayPeriodSnapshot(clonePayPeriod(payPeriod));
    setPayrollErr('');
    setPayrollMsg('');
    setEditingPayPeriod(true);
  };
  const cancelPayPeriodEdit = () => {
    setPayPeriod(clonePayPeriod(payPeriodSnapshot));
    setPayrollErr('');
    setEditingPayPeriod(false);
  };
  const updateSemiMonthlyDay = (dayIndex: 0 | 1, nextValue: number) => {
    setPayPeriod((current) => {
      const nextDays = [...current.semi_monthly_days];
      nextDays[dayIndex] = nextValue;
      return { ...current, semi_monthly_days: nextDays };
    });
  };
  const removePayGroup = (groupIndex: number) => {
    setPayGroups((current) => current.filter((_, index) => index !== groupIndex));
  };
  const addPayItem = (groupIndex: number) => {
    setPayGroups((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      return {
        ...group,
        items: [
          ...group.items,
          { name: 'Weekdays', pay_type: 'Hourly', rate: 0, applies_on: 'Weekdays', start_time: '', end_time: '', effective_date: '', sort_order: group.items.length, is_base_rate: false },
        ],
      };
    }));
  };
  const removePayItem = (groupIndex: number, itemIndex: number) => {
    setPayGroups((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      const nextItems = group.items.filter((_, idx) => idx !== itemIndex).map((item, idx) => ({ ...item, sort_order: idx }));
      if (!nextItems.some((item) => item.is_base_rate) && nextItems[0]) nextItems[0].is_base_rate = true;
      return { ...group, items: nextItems };
    }));
  };
  const handleSavePayrollGroups = async () => {
    setPayrollErr('');
    setPayrollMsg('');
    setPayrollSaving(true);
    try {
      const normalized = payGroups.map((group, groupIndex) => ({
        ...group,
        name: group.name.trim(),
        description: group.description?.trim() || '',
        items: group.items.map((item, itemIndex) => ({
          ...item,
          name: item.name.trim(),
          pay_type: item.pay_type,
          rate: Number(item.rate || 0),
          applies_on: item.applies_on?.trim() || '',
          start_time: '',
          end_time: '',
          effective_date: item.effective_date || '',
          sort_order: itemIndex,
          is_base_rate: item.is_base_rate || itemIndex === 0,
        })),
      }));
      const data = await savePayrollSettings({
        groups: normalized,
        pay_period: normalizePayPeriodForSave(payPeriod),
      });
      setPayGroups(data.groups);
      setPayGroupsSnapshot(clonePayrollGroups(data.groups));
      setPayPeriod(clonePayPeriod(data.pay_period));
      setPayPeriodSnapshot(clonePayPeriod(data.pay_period));
      setEditingPayGroups(false);
      setPayrollMsg('Payroll groups saved. Caregiver payroll selectors and timesheets will use the updated rates.');
      setTimeout(() => setPayrollMsg(''), 4000);
    } catch (error) {
      setPayrollErr(error instanceof Error ? error.message : 'Failed to save payroll settings.');
    } finally {
      setPayrollSaving(false);
    }
  };
  const handleSavePayPeriod = async () => {
    setPayrollErr('');
    setPayrollMsg('');
    setPayrollSaving(true);
    try {
      const data = await savePayrollSettings({
        groups: payGroups,
        pay_period: normalizePayPeriodForSave(payPeriod),
      });
      setPayGroups(data.groups);
      setPayGroupsSnapshot(clonePayrollGroups(data.groups));
      setPayPeriod(clonePayPeriod(data.pay_period));
      setPayPeriodSnapshot(clonePayPeriod(data.pay_period));
      setEditingPayPeriod(false);
      setPayrollMsg('Pay period saved. New payroll cycles will use the updated cadence.');
      setTimeout(() => setPayrollMsg(''), 4000);
    } catch (error) {
      setPayrollErr(error instanceof Error ? error.message : 'Failed to save payroll settings.');
    } finally {
      setPayrollSaving(false);
    }
  };

  /* ── Aggregator handlers ───────────────────────────────────────────────── */
  const saveSandata = () => {
    setSandataAggErr(''); setSandataAggMsg(''); setSandataAggSaving(true);
    try {
      if (sandataCfg.sandata_enabled) {
        if (!sandataCfg.sandata_medicaid_provider_id.trim()) { setSandataAggErr('Medicaid Provider ID is required.'); setSandataAggSaving(false); return; }
        if (!sandataCfg.sandata_user_id.trim())              { setSandataAggErr('User ID is required.');              setSandataAggSaving(false); return; }
        if (!sandataCfg.sandata_password.trim())             { setSandataAggErr('Password is required.');             setSandataAggSaving(false); return; }
      }
      localStorage.setItem(AGGREGATOR_SANDATA_KEY, JSON.stringify(sandataCfg));
      setSandataAggMsg(sandataCfg.sandata_enabled ? 'Sandata saved and enabled.' : 'Sandata settings saved (disabled).');
      setTimeout(() => setSandataAggMsg(''), 3500);
    } catch {
      setSandataAggErr('Failed to save settings.');
    } finally {
      setSandataAggSaving(false);
    }
  };
  const saveHhax = () => {
    setHhaxAggErr(''); setHhaxAggMsg(''); setHhaxAggSaving(true);
    try {
      if (hhaxCfg.hhax_enabled) {
        if (!hhaxCfg.hhax_provider_id.trim()) { setHhaxAggErr('Provider ID is required.'); setHhaxAggSaving(false); return; }
        if (!hhaxCfg.hhax_user_id.trim())     { setHhaxAggErr('User ID is required.');     setHhaxAggSaving(false); return; }
        if (!hhaxCfg.hhax_password.trim())    { setHhaxAggErr('Password is required.');    setHhaxAggSaving(false); return; }
      }
      localStorage.setItem(AGGREGATOR_HHAX_KEY, JSON.stringify(hhaxCfg));
      setHhaxAggMsg(hhaxCfg.hhax_enabled ? 'HHAeXchange saved and enabled.' : 'HHAeXchange settings saved (disabled).');
      setTimeout(() => setHhaxAggMsg(''), 3500);
    } catch {
      setHhaxAggErr('Failed to save settings.');
    } finally {
      setHhaxAggSaving(false);
    }
  };

  /* ── Integration handlers ──────────────────────────────────────────────── */
  const saveISolved = () => {
    localStorage.setItem(ISOLVED_KEY, JSON.stringify(iSolvedDraft));
    setISolvedCfg(iSolvedDraft);
    setShowISolvedModal(false);
  };
  const saveADP = () => {
    localStorage.setItem(ADP_KEY, JSON.stringify(adpDraft));
    setAdpCfg(adpDraft);
    setShowADPModal(false);
  };

  /* ── Agency handlers ───────────────────────────────────────────────────── */
  const saveAgency = async () => {
    setAgencyErr(''); setAgencyMsg(''); setAgencySaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/settings/agency`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agency),
      });
      if (res.ok || res.status === 404) {
        setAgencySnapshot(agency);
        setAgencyEditing(false);
        setAgencyMsg('Changes saved.');
        setTimeout(() => setAgencyMsg(''), 3000);
      } else {
        const b = await res.json().catch(() => ({}));
        setAgencyErr(b?.detail ?? 'Failed to save.');
      }
    } catch {
      setAgencyErr('Cannot connect to server.');
    } finally {
      setAgencySaving(false);
    }
  };

  const handlePortalReset = async (e: FormEvent) => {
    e.preventDefault();
    setPortalErr(''); setPortalMsg('');
    if (portal.newPassword !== portal.confirmPassword) { setPortalErr('Passwords do not match.'); return; }
    if (portal.newPassword.length < 8) { setPortalErr('Password must be at least 8 characters.'); return; }
    setPortalBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: portal.currentPassword, new_password: portal.newPassword }),
      });
      if (res.status === 204) {
        setPortalMsg('Password updated successfully.');
        setPortal({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        const b = await res.json().catch(() => ({}));
        setPortalErr(b?.detail ?? 'Failed to update password.');
      }
    } catch { setPortalErr('Cannot connect to server.'); }
    finally { setPortalBusy(false); }
  };

  const handleMobileReset = async (e: FormEvent) => {
    e.preventDefault();
    setMobileErr(''); setMobileMsg('');
    if (mobile.newPassword !== mobile.confirmPassword) { setMobileErr('Passwords do not match.'); return; }
    if (mobile.newPassword.length < 8) { setMobileErr('Password must be at least 8 characters.'); return; }
    setMobileBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/admin-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: mobile.username, new_password: mobile.newPassword, user_type: 'mobile' }),
      });
      if (res.status === 204) {
        setMobileMsg(`Password reset for ${mobile.username}.`);
        setMobile({ username: '', newPassword: '', confirmPassword: '' });
      } else {
        const b = await res.json().catch(() => ({}));
        setMobileErr(b?.detail ?? 'Failed to reset password.');
      }
    } catch { setMobileErr('Cannot connect to server.'); }
    finally { setMobileBusy(false); }
  };

  const currentPayrollProvider = getProvider(payrollProvider);

  /* ── Visibility helpers ────────────────────────────────────────────────── */
  const showSandata = user?.agency_aggregator === 'sandata' || user?.agency_tier === 'evvplus';
  const showHhax    = user?.agency_aggregator === 'hhax'    || user?.agency_tier === 'evvplus';
  const hasHrIntegrations = user?.agency_tier !== 'core' && (showSandata || showHhax);

  /* ══ RENDER ══════════════════════════════════════════════════════════════ */
  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Agency configuration, billing details, and security controls.</p>
        </div>
        <div className="top-actions"><HeaderUser /></div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 18 }}>
        {(['general', 'notifications', 'billing', 'security', 'payroll', 'integrations'] as Tab[]).map(t => (
          <button
            key={t}
            className={`tab-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
            style={t === 'integrations' ? { position: 'relative' } : undefined}
          >
            {t === 'payroll' ? 'Pay Group' : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'integrations' && hasHrIntegrations && !sandataCfg.sandata_enabled && !hhaxCfg.hhax_enabled && (
              <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: '#d56b6b', border: '1.5px solid #fff' }} />
            )}
          </button>
        ))}
      </div>

      {/* ══ GENERAL ════════════════════════════════════════════════════════ */}
      {tab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-section-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div>
                <div className="form-section-heading">Agency Information</div>
                <div className="form-section-sub">Your agency details and contact information.</div>
              </div>
              {!agencyEditing && (
                <button className="btn secondary" style={{ fontSize: 12, height: 32, padding: '0 14px' }}
                  onClick={() => { setAgencySnapshot(agency); setAgencyEditing(true); setAgencyErr(''); setAgencyMsg(''); }}>
                  Edit
                </button>
              )}
            </div>

            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">Agency Name</div>
                <input className="input" value={agency.agencyName} disabled={!agencyEditing}
                  onChange={e => setAgency(a => ({ ...a, agencyName: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">Email</div>
                <input className="input" type="email" value={agency.email} disabled={!agencyEditing}
                  onChange={e => setAgency(a => ({ ...a, email: e.target.value }))} />
              </div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">Phone</div>
                <input className="input" value={agency.phone} disabled={!agencyEditing}
                  onChange={e => setAgency(a => ({ ...a, phone: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">Website</div>
                <input className="input" type="url" placeholder="https://…" value={agency.website} disabled={!agencyEditing}
                  onChange={e => setAgency(a => ({ ...a, website: e.target.value }))} />
              </div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="info-field">
                <div className="info-label">Address</div>
                <input className="input" value={agency.address} disabled={!agencyEditing}
                  onChange={e => setAgency(a => ({ ...a, address: e.target.value }))} />
              </div>
            </div>

            {agencyErr && <ErrorBanner msg={agencyErr} />}
            {agencyMsg && <SuccessBanner msg={agencyMsg} />}

            {agencyEditing && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button className="btn" style={{ minWidth: 100 }} onClick={saveAgency} disabled={agencySaving}>
                  {agencySaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn secondary" onClick={() => { setAgency(agencySnapshot); setAgencyEditing(false); setAgencyErr(''); }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ NOTIFICATIONS ══════════════════════════════════════════════════ */}
      {tab === 'notifications' && (
        <div className="form-section-card" style={{ maxWidth: 640 }}>
          <div className="form-section-heading">Email Notifications</div>
          <div className="form-section-sub">Choose which email alerts you want to receive.</div>
          {([
            ['newClient',          'New Client Registered',    'Get notified when a new client is added to the system.'],
            ['timesheetSubmitted', 'Timesheet Submitted',       'Notified when caregivers submit timesheets for review.'],
            ['missedClockIn',      'Missed Clock-in Alert',     'Notified when a caregiver misses their scheduled clock-in.'],
            ['paymentReceived',    'Payment Received',          'Notified when an invoice payment is received.'],
            ['scheduleChanges',    'Schedule Changes',          'Notified when schedule modifications are made.'],
            ['weeklyReport',       'Weekly Summary Report',     'Receive a weekly digest of key metrics and activities.'],
          ] as [NotifKey, string, string][]).map(([key, title, desc], idx) => (
            <div key={key}>
              {idx > 0 && <hr className="form-divider" />}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '4px 0' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
                </div>
                <Toggle checked={notifs[key]} onChange={v => setNotifs(n => ({ ...n, [key]: v }))} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ BILLING ════════════════════════════════════════════════════════ */}
      {tab === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-section-card">
            <div className="form-section-heading">Provider Billing Identity</div>
            <div className="form-section-sub">NPI, taxonomy codes, and payer identifiers used for claim submission.</div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">National Provider ID (NPI)</div>
                <input className="input" placeholder="10-digit NPI" value={billing.npi}
                  onChange={e => setBilling(b => ({ ...b, npi: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">Taxonomy Code</div>
                <input className="input" placeholder="e.g. 251E00000X" value={billing.taxonomy}
                  onChange={e => setBilling(b => ({ ...b, taxonomy: e.target.value }))} />
              </div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">Federal Tax ID (EIN)</div>
                <input className="input" placeholder="XX-XXXXXXX" value={billing.ein}
                  onChange={e => setBilling(b => ({ ...b, ein: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">Medicaid Provider Number</div>
                <input className="input" placeholder="PA Medicaid #" value={billing.medicaid}
                  onChange={e => setBilling(b => ({ ...b, medicaid: e.target.value }))} />
              </div>
            </div>
            {billingMsg && <SuccessBanner msg={billingMsg} />}
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button className="btn" style={{ minWidth: 120 }}
                onClick={() => { setBillingMsg('Billing details saved.'); setTimeout(() => setBillingMsg(''), 3000); }}>
                Save Changes
              </button>
              <button className="btn secondary">Cancel</button>
            </div>
          </div>

          <div className="form-section-card">
            <div className="form-section-heading">Sandata Aggregator Credentials</div>
            <div className="form-section-sub">Required for submitting EVV visit records to the PA ODP aggregator.</div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">Sandata Provider ID</div>
                <input className="input" placeholder="Assigned by Sandata" value={sandata.providerId}
                  onChange={e => setSandata(s => ({ ...s, providerId: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">API Mode</div>
                <select className="input" value={sandata.apiMode}
                  onChange={e => setSandata(s => ({ ...s, apiMode: e.target.value }))}>
                  <option value="simulate">Simulate (dev / staging)</option>
                  <option value="live">Live (production)</option>
                </select>
              </div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="info-field">
                <div className="info-label">API Key</div>
                <input className="input" type="password" placeholder="••••••••••••••••"
                  value={sandata.apiKey}
                  onChange={e => setSandata(s => ({ ...s, apiKey: e.target.value }))} />
              </div>
            </div>
            {sandataMsg && <SuccessBanner msg={sandataMsg} />}
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button className="btn" style={{ minWidth: 140 }}
                onClick={() => { setSandataMsg('Credentials saved.'); setTimeout(() => setSandataMsg(''), 3000); }}>
                Save Credentials
              </button>
              <button className="btn secondary">Test Connection</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ SECURITY ═══════════════════════════════════════════════════════ */}
      {tab === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: '11px 16px', background: '#f4f7ff', borderColor: '#c7d4f5' }}>
            <div style={{ fontSize: 12, color: '#3b5bdb', lineHeight: 1.7 }}>
              <strong>Two access types — manage separately.</strong>&nbsp;
              <strong>Portal users</strong> (Coordinators, Agency Admins) change their own password and must verify their current password.&nbsp;
              <strong>Mobile App users</strong> (Caregivers / DSPs) have their passwords reset by an admin — no current password required.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="card">
              <div className="card-header" style={{ marginBottom: 14 }}>
                <div>
                  <div className="card-title">Portal Users</div>
                  <div className="card-subtitle">Change your own password · Coordinators &amp; Admins</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 3, background: '#dde8ff', color: '#2b4acb' }}>WEB</span>
              </div>
              <form onSubmit={handlePortalReset} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="info-field">
                  <div className="info-label">Current Password</div>
                  <input className="input" type="password" placeholder="Your current password" value={portal.currentPassword} required onChange={e => setPortal(p => ({ ...p, currentPassword: e.target.value }))} />
                </div>
                <hr className="form-divider" style={{ margin: '2px 0 4px' }} />
                <div className="info-field">
                  <div className="info-label">New Password</div>
                  <input className="input" type="password" placeholder="Min. 8 characters" value={portal.newPassword} required onChange={e => setPortal(p => ({ ...p, newPassword: e.target.value }))} />
                </div>
                <div className="info-field">
                  <div className="info-label">Confirm New Password</div>
                  <input className="input" type="password" placeholder="Repeat new password" value={portal.confirmPassword} required onChange={e => setPortal(p => ({ ...p, confirmPassword: e.target.value }))} />
                </div>
                {portalErr && <ErrorBanner msg={portalErr} />}
                {portalMsg && <SuccessBanner msg={portalMsg} />}
                <button className="btn" type="submit" disabled={portalBusy} style={{ marginTop: 2 }}>{portalBusy ? 'Updating…' : 'Update Password'}</button>
              </form>
            </div>

            <div className="card">
              <div className="card-header" style={{ marginBottom: 14 }}>
                <div>
                  <div className="card-title">Mobile App Users</div>
                  <div className="card-subtitle">Admin resets a caregiver's password · No current password required</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 3, background: '#e8f5e9', color: '#2e7d32' }}>MOBILE</span>
              </div>
              <form onSubmit={handleMobileReset} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="info-field">
                  <div className="info-label">Caregiver Username</div>
                  <input className="input" placeholder="e.g. sarah.mills" value={mobile.username} required onChange={e => setMobile(m => ({ ...m, username: e.target.value }))} />
                </div>
                <hr className="form-divider" style={{ margin: '2px 0 4px' }} />
                <div className="info-field">
                  <div className="info-label">New Password</div>
                  <input className="input" type="password" placeholder="Min. 8 characters" value={mobile.newPassword} required onChange={e => setMobile(m => ({ ...m, newPassword: e.target.value }))} />
                </div>
                <div className="info-field">
                  <div className="info-label">Confirm New Password</div>
                  <input className="input" type="password" placeholder="Repeat new password" value={mobile.confirmPassword} required onChange={e => setMobile(m => ({ ...m, confirmPassword: e.target.value }))} />
                </div>
                {mobileErr && <ErrorBanner msg={mobileErr} />}
                {mobileMsg && <SuccessBanner msg={mobileMsg} />}
                <button className="btn" type="submit" disabled={mobileBusy} style={{ marginTop: 2 }}>{mobileBusy ? 'Resetting…' : 'Reset Password'}</button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ marginBottom: 12 }}>
              <div>
                <div className="card-title">Password &amp; Session Policy</div>
                <div className="card-subtitle">Current security configuration</div>
              </div>
            </div>
            <div className="detail-grid">
              {[
                ['Min. Password Length', '8 characters'],
                ['Session Duration', '24 hours (JWT TTL)'],
                ['Failed Login Throttle', '5 attempts → 2–10 s delay'],
                ['Account Lockout', '10 attempts → 15-min lockout'],
                ['Token Algorithm', 'HS256 (JWT)'],
                ['Session Revocation', 'Immediate (JTI blacklist)'],
              ].map(([label, val]) => (
                <div key={label} className="info-field">
                  <div className="info-label">{label}</div>
                  <div className="info-value">{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ PAY GROUP ══════════════════════════════════════════════════════ */}
      {tab === 'payroll' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
            <div className="form-section-card" style={{ display: 'grid', gap: 16, minWidth: 0, maxWidth: 360 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div className="form-section-heading">Payroll Provider</div>
                  <div className="form-section-sub">Select the payroll system your agency uses. This determines the export column layout when downloading timesheets.</div>
                </div>
                {editingPayrollProvider ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="btn secondary" style={payrollActionButtonStyle} onClick={cancelPayrollProviderEdit}>Cancel</button>
                    <button className="btn" style={payrollActionButtonStyle} onClick={savePayrollProvider}>Save</button>
                  </div>
                ) : (
                  <button className="btn secondary" onClick={startPayrollProviderEdit}>Edit</button>
                )}
              </div>

              {editingPayrollProvider ? (
                <div className="info-field">
                  <div className="info-label">Provider</div>
                  <select className="input" value={payrollProvider} onChange={e => setPayrollProvider(e.target.value as ProviderId)}>
                    {getAllProviders().map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{currentPayrollProvider.description}</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: '#fbfcfe' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Current Provider</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{currentPayrollProvider.name}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--muted)', marginTop: 6 }}>{currentPayrollProvider.description}</div>
                  </div>
                </div>
              )}

              {payrollProviderSaved && (
                <SuccessBanner msg={`Saved. Exports will use ${currentPayrollProvider.name} format.`} />
              )}
            </div>

            <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
              <div className="form-section-card" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div className="form-section-heading">Pay Groups</div>
                    <div className="form-section-sub">Configure caregiver pay groups and rate rules. Caregiver payroll settings and timesheet pay rates pull from these items.</div>
                  </div>
                  {payrollLoading ? null : editingPayGroups ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="btn secondary" style={payrollActionButtonStyle} onClick={cancelPayGroupsEdit}>Cancel</button>
                      <button className="btn" style={payrollActionButtonStyle} onClick={handleSavePayrollGroups} disabled={payrollSaving || payrollLoading}>
                        {payrollSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn secondary" onClick={startPayGroupsEdit} disabled={editingPayPeriod}>Edit</button>
                  )}
                </div>

                {payrollLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading payroll groups...</div>
                ) : editingPayGroups ? (
                  <div style={{ display: 'grid', gap: 16 }}>
                    {payGroups.map((group, groupIndex) => (
                      <div key={group.id ?? `group-${groupIndex}`} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)', display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr) auto', gap: 12, alignItems: 'center' }}>
                          <input className="input" value={group.name} onChange={(event) => updatePayGroup(groupIndex, { name: event.target.value })} placeholder="Pay group name" />
                          <input className="input" value={group.description ?? ''} onChange={(event) => updatePayGroup(groupIndex, { description: event.target.value })} placeholder="Optional description" />
                          <button className="btn secondary" onClick={() => removePayGroup(groupIndex)} disabled={payGroups.length === 1}>Remove Group</button>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ minWidth: 900 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.9fr 0.9fr 1.3fr 1fr auto', gap: 12, padding: '12px 16px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', background: '#f8fafc', borderBottom: '1px solid var(--line-soft)' }}>
                              <div>Name</div><div>Pay Type</div><div>Rate</div><div>When does this apply?</div><div>Effective Date</div><div />
                            </div>
                            {group.items.map((item, itemIndex) => (
                              <div key={item.id ?? `item-${groupIndex}-${itemIndex}`} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.9fr 0.9fr 1.3fr 1fr auto', gap: 12, padding: '12px 16px', alignItems: 'start', borderBottom: '1px solid var(--line-soft)' }}>
                                <div>
                                  <input className="input" value={item.name} onChange={(event) => updatePayItem(groupIndex, itemIndex, { name: event.target.value })} placeholder="Base rate" />
                                  {item.is_base_rate && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                                      <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--text)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>i</span>
                                      <span>The base rate is the default pay rate for this group, applying 24/7 unless another pay item is triggered.</span>
                                    </div>
                                  )}
                                </div>
                                <select className="input" value={item.pay_type} onChange={(event) => updatePayItem(groupIndex, itemIndex, { pay_type: event.target.value as PayrollRateItem['pay_type'] })}>
                                  {PAY_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                                <div style={{ position: 'relative' }}>
                                  <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted)', fontSize: 13 }}>$</span>
                                  <input className="input" type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updatePayItem(groupIndex, itemIndex, { rate: Number(event.target.value) })} style={{ paddingLeft: 24 }} />
                                </div>
                                <input className="input" value={item.applies_on ?? ''} onChange={(event) => updatePayItem(groupIndex, itemIndex, { applies_on: event.target.value })} placeholder="Weekdays / Saturday / Public Holidays" />
                                <input className="input" type="date" value={item.effective_date ?? ''} onChange={(event) => updatePayItem(groupIndex, itemIndex, { effective_date: event.target.value })} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
                                    <input type="radio" name={`base-rate-${groupIndex}`} checked={item.is_base_rate} onChange={() => updatePayItem(groupIndex, itemIndex, { is_base_rate: true })} />
                                    Base
                                  </label>
                                  <button className="btn secondary" style={{ padding: '0 10px', height: 34 }} onClick={() => removePayItem(groupIndex, itemIndex)} disabled={group.items.length === 1}>Delete</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <button className="btn secondary" onClick={() => addPayItem(groupIndex)}>Add Pay Item</button>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{group.items.length} pay item{group.items.length === 1 ? '' : 's'}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn secondary" onClick={addPayGroup}>Add Pay Group</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 14 }}>
                    {payGroups.map((group, groupIndex) => (
                      <div key={group.id ?? `group-view-${groupIndex}`} style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: '#fbfcfe' }}>
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{group.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{group.description?.trim() || 'No description added.'}</div>
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                            {group.items.length} item{group.items.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gap: 10, padding: '14px 16px' }}>
                          {group.items.map((item, itemIndex) => (
                            <div key={item.id ?? `group-item-view-${groupIndex}-${itemIndex}`} style={{ border: '1px solid var(--line-soft)', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.name}</div>
                                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{describePayrollItem(item)}</div>
                                </div>
                                {item.is_base_rate && (
                                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: 999, color: '#35693c', background: '#e8f5e9', border: '1px solid #cfe5d2' }}>
                                    Base rate
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-section-card" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div className="form-section-heading">Pay Period</div>
                    <div className="form-section-sub">Set how payroll cycles are grouped. Weekly schedules use a week start, bi-weekly schedules also need the first cycle start date, and monthly options support fixed close days.</div>
                  </div>
                  {payrollLoading ? null : editingPayPeriod ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="btn secondary" style={payrollActionButtonStyle} onClick={cancelPayPeriodEdit}>Cancel</button>
                      <button className="btn" style={payrollActionButtonStyle} onClick={handleSavePayPeriod} disabled={payrollSaving || payrollLoading}>
                        {payrollSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn secondary" onClick={startPayPeriodEdit} disabled={editingPayGroups}>Edit</button>
                  )}
                </div>

                {payrollLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading pay period...</div>
                ) : editingPayPeriod ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div className="form-row" style={{ gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)' }}>
                      <div className="info-field">
                        <div className="info-label">Pay Period Type</div>
                        <select className="input" value={payPeriod.frequency} onChange={(event) => setPayPeriod((current) => ({ ...current, frequency: event.target.value as PayrollPayPeriod['frequency'] }))}>
                          {PAY_PERIOD_FREQUENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </div>
                      <div style={{ border: '1px solid var(--line-soft)', borderRadius: 10, padding: '12px 14px', background: '#fbfcfe' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Preview</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>{summarizePayPeriod(payPeriod)}</div>
                      </div>
                    </div>

                    {(payPeriod.frequency === 'weekly' || payPeriod.frequency === 'biweekly') && (
                      <div className="form-row" style={{ gridTemplateColumns: payPeriod.frequency === 'biweekly' ? '1fr 1fr' : '1fr' }}>
                        <div className="info-field">
                          <div className="info-label">Week Starts On</div>
                          <select className="input" value={payPeriod.week_starts_on ?? 'monday'} onChange={(event) => setPayPeriod((current) => ({ ...current, week_starts_on: event.target.value as WeekStartDay }))}>
                            {WEEK_START_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </div>
                        {payPeriod.frequency === 'biweekly' && (
                          <div className="info-field">
                            <div className="info-label">First Period Start Date</div>
                            <input className="input" type="date" value={payPeriod.anchor_date ?? ''} onChange={(event) => setPayPeriod((current) => ({ ...current, anchor_date: event.target.value }))} />
                          </div>
                        )}
                      </div>
                    )}

                    {payPeriod.frequency === 'monthly' && (
                      <div className="form-row" style={{ gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)' }}>
                        <div className="info-field">
                          <div className="info-label">Close Day of Month</div>
                          <select className="input" value={String(payPeriod.monthly_day ?? 1)} onChange={(event) => setPayPeriod((current) => ({ ...current, monthly_day: Number(event.target.value) }))}>
                            {MONTH_DAY_OPTIONS.map((day) => <option key={day} value={day}>{formatOrdinalDay(day)}</option>)}
                          </select>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, paddingTop: 26 }}>
                          If you choose the 29th, 30th, or 31st, shorter months should be treated as closing on the last calendar day.
                        </div>
                      </div>
                    )}

                    {payPeriod.frequency === 'semimonthly' && (
                      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div className="info-field">
                          <div className="info-label">First Close Day</div>
                          <select className="input" value={String(payPeriod.semi_monthly_days[0] ?? 1)} onChange={(event) => updateSemiMonthlyDay(0, Number(event.target.value))}>
                            {MONTH_DAY_OPTIONS.map((day) => <option key={`semi-first-${day}`} value={day}>{formatOrdinalDay(day)}</option>)}
                          </select>
                        </div>
                        <div className="info-field">
                          <div className="info-label">Second Close Day</div>
                          <select className="input" value={String(payPeriod.semi_monthly_days[1] ?? 15)} onChange={(event) => updateSemiMonthlyDay(1, Number(event.target.value))}>
                            {MONTH_DAY_OPTIONS.map((day) => <option key={`semi-second-${day}`} value={day}>{formatOrdinalDay(day)}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {payPeriod.frequency === 'daily' && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                        Daily payroll closes each calendar day. No additional setup is required.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', background: '#fbfcfe' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Current Schedule</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                        {PAY_PERIOD_FREQUENCY_OPTIONS.find((option) => option.value === payPeriod.frequency)?.label ?? 'Weekly'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.55 }}>{summarizePayPeriod(payPeriod)}</div>
                    </div>
                  </div>
                )}
              </div>

              {payrollErr && <ErrorBanner msg={payrollErr} />}
              {payrollMsg && <SuccessBanner msg={payrollMsg} />}
            </div>
          </div>
        </div>
      )}

      {/* ══ INTEGRATIONS ═══════════════════════════════════════════════════ */}
      {tab === 'integrations' && (
        <div ref={aggregatorRef}>
          {/* Page header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Integrations</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Connect tools you use every day and improve your workflow.</div>
          </div>

          {/* Sub-filter tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--line)', paddingBottom: 0 }}>
            {([
              ['all',        'All Integrations'],
              ['payroll',    'Payroll'],
              ['aggregator', 'Aggregator'],
              ['hr',         'HR'],
            ] as [IntegrationFilter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setIntFilter(f)}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none',
                  borderBottom: `2px solid ${intFilter === f ? 'var(--primary)' : 'transparent'}`,
                  marginBottom: -2, cursor: 'pointer', color: intFilter === f ? 'var(--primary)' : 'var(--muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Cards grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>

            {/* ── Payroll integrations ──────────────────────────────────── */}
            {(intFilter === 'all' || intFilter === 'payroll') && (
              <>
                <IntegrationCard
                  logo={<ISolvedLogoFallback />}
                  name="iSolved"
                  description="Map earning codes and sync payroll data with iSolved HCM."
                  connected={iSolvedCfg.enabled}
                  onAction={() => { setISolvedDraft({ ...iSolvedCfg }); setShowISolvedModal(true); }}
                />
                <IntegrationCard
                  logo={<ADPLogo />}
                  name="ADP Workforce Now"
                  description="Export timesheets in ADP WFN batch format with earning code mapping."
                  connected={adpCfg.enabled}
                  onAction={() => { setAdpDraft({ ...adpCfg }); setShowADPModal(true); }}
                />
                <IntegrationCard
                  logo={<UniversalLogo />}
                  name="Universal Export"
                  description="Full dataset CSV export with all 30 fields — no provider transformations."
                  connected={true}
                  alwaysConnected={true}
                />
              </>
            )}

            {/* ── HR / Aggregator integrations (tier-based) ─────────────── */}
            {(intFilter === 'all' || intFilter === 'hr' || intFilter === 'aggregator') && (
              <>
                {user?.agency_tier === 'core' && (intFilter === 'hr' || intFilter === 'aggregator') && (
                  <div style={{ gridColumn: '1 / -1', padding: '32px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    EVV aggregator integrations are not available on the Core plan.
                  </div>
                )}
                {showSandata && (
                  <IntegrationCard
                    logo={<SandataLogo />}
                    name="Sandata Pennsylvania"
                    description="ODP / Waiver services · PA-DHS EVV v1.4 aggregator submission."
                    connected={sandataCfg.sandata_enabled}
                    onAction={() => setShowSandataModal(true)}
                  />
                )}
                {showHhax && (
                  <IntegrationCard
                    logo={<HHAXLogo />}
                    name="HHAeXchange Pennsylvania"
                    description="PDA / MA services · per-branch EVV submission."
                    connected={hhaxCfg.hhax_enabled}
                    onAction={() => setShowHhaxModal(true)}
                  />
                )}
              </>
            )}
          </div>

          {/* Empty state for aggregator filter with no EVV */}
          {intFilter === 'aggregator' && !showSandata && !showHhax && user?.agency_tier !== 'core' && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No aggregator integrations available for your agency configuration.
            </div>
          )}
        </div>
      )}

      {/* ══ MODAL — iSolved ════════════════════════════════════════════════ */}
      {showISolvedModal && (
        <Modal title="iSolved Settings" onClose={() => setShowISolvedModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={iSolvedDraft.enabled}
                onChange={e => setISolvedDraft(d => ({ ...d, enabled: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Enable integration with iSolved</span>
            </label>

            <div className="info-field">
              <div className="info-label">iSolved Client Id</div>
              <input
                className="input"
                placeholder="e.g. 1256841"
                value={iSolvedDraft.client_id}
                onChange={e => setISolvedDraft(d => ({ ...d, client_id: e.target.value }))}
              />
            </div>

            <EarningCodesTable<ISolvedConfig>
              draft={iSolvedDraft}
              onChange={patch => setISolvedDraft(d => ({ ...d, ...patch }))}
              codeLabel="iSolved Code"
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn secondary" onClick={() => setShowISolvedModal(false)}>Cancel</button>
              <button className="btn" onClick={saveISolved}>Confirm</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══ MODAL — ADP ════════════════════════════════════════════════════ */}
      {showADPModal && (
        <Modal title="ADP Workforce Now Settings" onClose={() => setShowADPModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={adpDraft.enabled}
                onChange={e => setAdpDraft(d => ({ ...d, enabled: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Enable integration with ADP Workforce Now</span>
            </label>

            <div className="info-field">
              <div className="info-label">ADP Company Code</div>
              <input
                className="input"
                placeholder="e.g. ABC123"
                value={adpDraft.company_code}
                onChange={e => setAdpDraft(d => ({ ...d, company_code: e.target.value }))}
              />
            </div>

            <EarningCodesTable<ADPConfig>
              draft={adpDraft}
              onChange={patch => setAdpDraft(d => ({ ...d, ...patch }))}
              codeLabel="ADP Code"
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn secondary" onClick={() => setShowADPModal(false)}>Cancel</button>
              <button className="btn" onClick={saveADP}>Confirm</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══ MODAL — Sandata ════════════════════════════════════════════════ */}
      {showSandataModal && (
        <Modal title="Sandata Pennsylvania" onClose={() => setShowSandataModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>ODP / Waiver services · PA-DHS v1.4</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: sandataCfg.sandata_enabled ? '#35693c' : 'var(--muted)' }}>
                  {sandataCfg.sandata_enabled ? 'On' : 'Off'}
                </span>
                <Toggle checked={sandataCfg.sandata_enabled} onChange={v => setSandataCfg(s => ({ ...s, sandata_enabled: v }))} />
              </div>
            </div>

            <hr className="form-divider" style={{ margin: 0 }} />

            <div className="info-field">
              <div className="info-label">Medicaid Provider ID <span style={{ color: '#d56b6b' }}>*</span></div>
              <input className="input" placeholder="e.g. 123456789A" value={sandataCfg.sandata_medicaid_provider_id} onChange={e => setSandataCfg(s => ({ ...s, sandata_medicaid_provider_id: e.target.value }))} />
            </div>
            <div className="info-field">
              <div className="info-label">National Provider ID (NPI)</div>
              <input className="input" placeholder="10-digit NPI" value={sandataCfg.sandata_national_provider_id} onChange={e => setSandataCfg(s => ({ ...s, sandata_national_provider_id: e.target.value }))} />
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">Provider Qualifier</div>
                <select className="input" value={sandataCfg.sandata_provider_qualifier} onChange={e => setSandataCfg(s => ({ ...s, sandata_provider_qualifier: e.target.value }))}>
                  <option value="">— Select —</option>
                  <option value="1">1 — Individual</option>
                  <option value="2">2 — Organization</option>
                  <option value="3">3 — Group Practice</option>
                </select>
              </div>
              <div className="info-field">
                <div className="info-label">Business Entity ID</div>
                <input className="input" placeholder="Assigned by Sandata" value={sandataCfg.sandata_business_entity_id} onChange={e => setSandataCfg(s => ({ ...s, sandata_business_entity_id: e.target.value }))} />
              </div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">User ID <span style={{ color: '#d56b6b' }}>*</span></div>
                <input className="input" placeholder="Sandata portal username" value={sandataCfg.sandata_user_id} onChange={e => setSandataCfg(s => ({ ...s, sandata_user_id: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">Tax ID (EIN)</div>
                <input className="input" placeholder="XX-XXXXXXX" value={sandataCfg.sandata_tax_id} onChange={e => setSandataCfg(s => ({ ...s, sandata_tax_id: e.target.value }))} />
              </div>
            </div>
            <div className="info-field">
              <div className="info-label">Password <span style={{ color: '#d56b6b' }}>*</span></div>
              <input className="input" type="password" placeholder="••••••••••••" value={sandataCfg.sandata_password} onChange={e => setSandataCfg(s => ({ ...s, sandata_password: e.target.value }))} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Stored locally only — never sent to SeriqCare servers.</div>
            </div>
            <div className="info-field">
              <div className="info-label">Submission Mode</div>
              <select className="input" value={sandataCfg.sandata_mode} onChange={e => setSandataCfg(s => ({ ...s, sandata_mode: e.target.value as 'simulate' | 'live' }))}>
                <option value="simulate">Simulate (dev / staging)</option>
                <option value="live">Live (production)</option>
              </select>
            </div>

            {sandataAggErr && <ErrorBanner msg={sandataAggErr} />}
            {sandataAggMsg && <SuccessBanner msg={sandataAggMsg} />}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn secondary" onClick={() => setSandataCfg(DEFAULT_SANDATA)}>Reset</button>
              <button className="btn secondary" onClick={() => setShowSandataModal(false)}>Cancel</button>
              <button className="btn" style={{ background: '#2567a4' }} onClick={() => { saveSandata(); if (!sandataAggErr) setShowSandataModal(false); }} disabled={sandataAggSaving}>
                {sandataAggSaving ? 'Saving…' : 'Save Sandata'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══ MODAL — HHAeXchange ════════════════════════════════════════════ */}
      {showHhaxModal && (
        <Modal title="HHAeXchange Pennsylvania" onClose={() => setShowHhaxModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>PDA / MA services · per-branch submission</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: hhaxCfg.hhax_enabled ? '#35693c' : 'var(--muted)' }}>
                  {hhaxCfg.hhax_enabled ? 'On' : 'Off'}
                </span>
                <Toggle checked={hhaxCfg.hhax_enabled} onChange={v => setHhaxCfg(h => ({ ...h, hhax_enabled: v }))} />
              </div>
            </div>

            <hr className="form-divider" style={{ margin: 0 }} />

            <div className="info-field">
              <div className="info-label">Provider ID <span style={{ color: '#d56b6b' }}>*</span></div>
              <input className="input" placeholder="HHAeXchange Provider ID" value={hhaxCfg.hhax_provider_id} onChange={e => setHhaxCfg(h => ({ ...h, hhax_provider_id: e.target.value }))} />
            </div>
            <div className="info-field">
              <div className="info-label">Branch ID</div>
              <input className="input" placeholder="HHAeXchange Branch ID" value={hhaxCfg.hhax_branch_id} onChange={e => setHhaxCfg(h => ({ ...h, hhax_branch_id: e.target.value }))} />
            </div>
            <div className="info-field">
              <div className="info-label">Business Entity ID</div>
              <input className="input" placeholder="Assigned by HHAeXchange" value={hhaxCfg.hhax_business_entity_id} onChange={e => setHhaxCfg(h => ({ ...h, hhax_business_entity_id: e.target.value }))} />
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="info-field">
                <div className="info-label">User ID <span style={{ color: '#d56b6b' }}>*</span></div>
                <input className="input" placeholder="HHAeXchange portal username" value={hhaxCfg.hhax_user_id} onChange={e => setHhaxCfg(h => ({ ...h, hhax_user_id: e.target.value }))} />
              </div>
              <div className="info-field">
                <div className="info-label">Tax ID (EIN)</div>
                <input className="input" placeholder="XX-XXXXXXX" value={hhaxCfg.hhax_tax_id} onChange={e => setHhaxCfg(h => ({ ...h, hhax_tax_id: e.target.value }))} />
              </div>
            </div>
            <div className="info-field">
              <div className="info-label">Password <span style={{ color: '#d56b6b' }}>*</span></div>
              <input className="input" type="password" placeholder="••••••••••••" value={hhaxCfg.hhax_password} onChange={e => setHhaxCfg(h => ({ ...h, hhax_password: e.target.value }))} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Stored locally only — never sent to SeriqCare servers.</div>
            </div>
            <div className="info-field">
              <div className="info-label">Submission Mode</div>
              <select className="input" value={hhaxCfg.hhax_mode} onChange={e => setHhaxCfg(h => ({ ...h, hhax_mode: e.target.value as 'test' | 'production' }))}>
                <option value="test">Test (staging environment)</option>
                <option value="production">Production (live)</option>
              </select>
            </div>

            {hhaxAggErr && <ErrorBanner msg={hhaxAggErr} />}
            {hhaxAggMsg && <SuccessBanner msg={hhaxAggMsg} />}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn secondary" onClick={() => setHhaxCfg(DEFAULT_HHAX)}>Reset</button>
              <button className="btn secondary" onClick={() => setShowHhaxModal(false)}>Cancel</button>
              <button className="btn" style={{ background: '#1F8C8A' }} onClick={() => { saveHhax(); if (!hhaxAggErr) setShowHhaxModal(false); }} disabled={hhaxAggSaving}>
                {hhaxAggSaving ? 'Saving…' : 'Save HHAeXchange'}
              </button>
            </div>
          </div>
        </Modal>
      )}

    </ProtectedLayout>
  );
}
