'use client';

import { FormEvent, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import settingsStyles from './settings.module.css';
import { PayrollSettingsPanel } from '@/components/payroll-settings-panel';
import { ServiceRatesSettings } from '@/components/service-rates-settings';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { useAuth } from '@/components/auth-context';
import { AGGREGATOR_SANDATA_KEY, AGGREGATOR_HHAX_KEY } from '@/components/aggregator-off-banner';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

type Tab = 'general' | 'notifications' | 'billing' | 'security' | 'payroll' | 'integrations';
type MobileCaregiverOption = { employee_id: number; name: string; employee_code: string; username: string | null };
type IntegrationFilter = 'all' | 'payroll' | 'aggregator' | 'hr';

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
  const [mobileCaregivers, setMobileCaregivers] = useState<MobileCaregiverOption[]>([]);
  const [mobileCaregiversLoading, setMobileCaregiversLoading] = useState(false);
  const [mobileCaregiversError, setMobileCaregiversError] = useState('');

  useEffect(() => {
    if (tab !== 'security') return;
    let active = true;
    setMobileCaregiversLoading(true);
    setMobileCaregiversError('');
    apiFetch('/api/caregivers/mobile-users')
      .then(async response => {
        if (!response.ok) throw new Error('Could not load caregivers.');
        const options: MobileCaregiverOption[] = await response.json();
        if (active) setMobileCaregivers(options);
      })
      .catch(error => { if (active) setMobileCaregiversError(error instanceof Error ? error.message : 'Could not load caregivers.'); })
      .finally(() => { if (active) setMobileCaregiversLoading(false); });
    return () => { active = false; };
  }, [tab, apiFetch]);

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
    } else if (searchParams.get('tab') === 'billing') {
      setTab('billing');
    } else if (searchParams.get('tab') === 'security') {
      setTab('security');
    }
  }, [searchParams]);

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
    if (!mobile.username || !mobileCaregivers.some(caregiver => caregiver.username === mobile.username)) { setMobileErr('Select a caregiver with an active mobile account.'); return; }
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

      <div className={settingsStyles.tabs} role="tablist" aria-label="Settings" onKeyDown={event => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {(['general', 'notifications', 'billing', 'security', 'payroll', 'integrations'] as Tab[]).map(t => (
          <button
            key={t}
            role="tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1}
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
                <input className="input" type="email" value={agency.email} disabled aria-label="Registered agency email" aria-describedby="agency-email-help" />
                <span id="agency-email-help" className={settingsStyles.fieldHint}>Registered login email. Contact Super Admin to request a change.</span>
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
          <ServiceRatesSettings key={user?.agency_id ?? 'no-agency'} />
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

            <div className="card" id="mobile-app-users">
              <div className="card-header" style={{ marginBottom: 14 }}>
                <div>
                  <div className="card-title">Mobile App Users</div>
                  <div className="card-subtitle">Admin resets a caregiver's password · No current password required</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 3, background: '#e8f5e9', color: '#2e7d32' }}>MOBILE</span>
              </div>
              <form onSubmit={handleMobileReset} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="info-field">
                  <label className="info-label" htmlFor="mobile-caregiver">Caregiver</label>
                  <select id="mobile-caregiver" className="form-select" value={mobile.username} required disabled={mobileBusy || mobileCaregiversLoading || !!mobileCaregiversError} onChange={e => { setMobile({ username: e.target.value, newPassword: '', confirmPassword: '' }); setMobileErr(''); setMobileMsg(''); }}>
                    <option value="">{mobileCaregiversLoading ? 'Loading caregivers…' : 'Select a caregiver…'}</option>
                    {mobileCaregivers.map(caregiver => <option key={caregiver.employee_id} value={caregiver.username ?? `unavailable-${caregiver.employee_id}`} disabled={!caregiver.username}>
                      {caregiver.name} · {caregiver.employee_code} · {caregiver.username ?? 'No active mobile account'}
                    </option>)}
                  </select>
                  {mobileCaregiversError && <ErrorBanner msg={mobileCaregiversError} />}
                  {!mobileCaregiversLoading && !mobileCaregiversError && mobileCaregivers.length === 0 && <div className="form-hint">No caregivers are available.</div>}
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
                <button className="btn" type="submit" disabled={mobileBusy || !mobile.username || mobileCaregiversLoading || !!mobileCaregiversError} style={{ marginTop: 2 }}>{mobileBusy ? 'Resetting…' : 'Reset Password'}</button>
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
      {tab === 'payroll' && <PayrollSettingsPanel key={user?.agency_id ?? 'no-agency'} />}

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
