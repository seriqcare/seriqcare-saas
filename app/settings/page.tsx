'use client';

import { FormEvent, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BillingIdentitySettings } from '@/components/billing-identity-settings';
import { SettingsDialog } from '@/components/settings-dialog';
import panelStyles from '@/components/settings-panels.module.css';
import settingsStyles from './settings.module.css';
import { PayrollSettingsPanel } from '@/components/payroll-settings-panel';
import { ServiceRatesSettings } from '@/components/service-rates-settings';
import { ProtectedLayout } from '@/components/protected-layout';
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
  const agencyPending = useRef(false);
  const [agencyLoading, setAgencyLoading] = useState(true);
  const [agencyLoadTick, setAgencyLoadTick] = useState(0);

  /* Notifications */
  const [notifs, setNotifs] = useState<NotifSettings>(DEFAULT_NOTIFS);

  /* Security — Portal (self-service change password) */
  const [securityEditor, setSecurityEditor] = useState<'portal' | 'mobile' | null>(null);
  const securityPending = useRef(false);
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

  useEffect(() => {
    if (!portalMsg && !mobileMsg) return;
    const id = window.setTimeout(() => { setPortalMsg(''); setMobileMsg(''); }, 4000);
    return () => window.clearTimeout(id);
  }, [portalMsg, mobileMsg]);

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
  const sandataSnapshot = useRef<SandataForm>(DEFAULT_SANDATA);
  const hhaxSnapshot = useRef<HhaxForm>(DEFAULT_HHAX);
  function openSandata() { sandataSnapshot.current = { ...sandataCfg }; setSandataAggErr(''); setShowSandataModal(true); }
  function openHhax() { hhaxSnapshot.current = { ...hhaxCfg }; setHhaxAggErr(''); setShowHhaxModal(true); }
  function closeSandata() { if (!sandataAggSaving) { setSandataCfg({ ...sandataSnapshot.current }); setSandataAggErr(''); setShowSandataModal(false); } }
  function closeHhax() { if (!hhaxAggSaving) { setHhaxCfg({ ...hhaxSnapshot.current }); setHhaxAggErr(''); setShowHhaxModal(false); } }


  useEffect(() => {
    setAgencyLoading(true);
    setAgencyErr('');
    apiFetch(`${API_BASE}/api/settings/agency`)
      .then(r => { if (!r.ok) throw new Error('Could not load agency information.'); return r.json(); })
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
      .catch(() => setAgencyErr('Could not load agency information. Please retry.'))
      .finally(() => setAgencyLoading(false));
  }, [apiFetch, agencyLoadTick]);

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
        if (!sandataCfg.sandata_medicaid_provider_id.trim()) { setSandataAggErr('Medicaid Provider ID is required.'); setSandataAggSaving(false); return false; }
        if (!sandataCfg.sandata_user_id.trim())              { setSandataAggErr('User ID is required.');              setSandataAggSaving(false); return false; }
        if (!sandataCfg.sandata_password.trim())             { setSandataAggErr('Password is required.');             setSandataAggSaving(false); return false; }
      }
      localStorage.setItem(AGGREGATOR_SANDATA_KEY, JSON.stringify(sandataCfg));
      setSandataAggMsg(sandataCfg.sandata_enabled ? 'Sandata saved and enabled.' : 'Sandata settings saved (disabled).');
      setTimeout(() => setSandataAggMsg(''), 3500);
      return true;
    } catch {
      setSandataAggErr('Failed to save settings.');
      return false;
    } finally {
      setSandataAggSaving(false);
    }
  };
  const saveHhax = () => {
    setHhaxAggErr(''); setHhaxAggMsg(''); setHhaxAggSaving(true);
    try {
      if (hhaxCfg.hhax_enabled) {
        if (!hhaxCfg.hhax_provider_id.trim()) { setHhaxAggErr('Provider ID is required.'); setHhaxAggSaving(false); return false; }
        if (!hhaxCfg.hhax_user_id.trim())     { setHhaxAggErr('User ID is required.');     setHhaxAggSaving(false); return false; }
        if (!hhaxCfg.hhax_password.trim())    { setHhaxAggErr('Password is required.');    setHhaxAggSaving(false); return false; }
      }
      localStorage.setItem(AGGREGATOR_HHAX_KEY, JSON.stringify(hhaxCfg));
      setHhaxAggMsg(hhaxCfg.hhax_enabled ? 'HHAeXchange saved and enabled.' : 'HHAeXchange settings saved (disabled).');
      setTimeout(() => setHhaxAggMsg(''), 3500);
      return true;
    } catch {
      setHhaxAggErr('Failed to save settings.');
      return false;
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
  const saveAgency = async (event: FormEvent) => {
    event.preventDefault();
    if (agencyPending.current) return;
    agencyPending.current = true;
    setAgencyErr(''); setAgencyMsg(''); setAgencySaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/settings/agency`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agency),
      });
      if (res.ok) {
        setAgencySnapshot(agency);
        setAgencyEditing(false);
        setAgencyMsg('Changes saved.');
        setTimeout(() => setAgencyMsg(''), 3000);
      } else {
        const b = await res.json().catch(() => ({}));
        setAgencyErr(typeof b?.detail === 'string' ? b.detail : 'Failed to save agency information.');
      }
    } catch {
      setAgencyErr('Cannot connect to server.');
    } finally {
      agencyPending.current = false;
      setAgencySaving(false);
    }
  };

  const handlePortalReset = async (e: FormEvent) => {
    e.preventDefault();
    setPortalErr(''); setPortalMsg('');
    if (portal.newPassword !== portal.confirmPassword) { setPortalErr('Passwords do not match.'); return; }
    if (portal.newPassword.length < 8) { setPortalErr('Password must be at least 8 characters.'); return; }
    if (securityPending.current) return;
    securityPending.current = true;
    setPortalBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: portal.currentPassword, new_password: portal.newPassword }),
      });
      if (res.status === 204) {
        setSecurityEditor(null);
        setPortalMsg('Password updated successfully.');
        setPortal({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        const b = await res.json().catch(() => ({}));
        setPortalErr(b?.detail ?? 'Failed to update password.');
      }
    } catch { setPortalErr('Cannot connect to server.'); }
    finally { securityPending.current = false; setPortalBusy(false); }
  };

  const handleMobileReset = async (e: FormEvent) => {
    e.preventDefault();
    setMobileErr(''); setMobileMsg('');
    if (!mobile.username || !mobileCaregivers.some(caregiver => caregiver.username === mobile.username)) { setMobileErr('Select a caregiver with an active mobile account.'); return; }
    if (mobile.newPassword !== mobile.confirmPassword) { setMobileErr('Passwords do not match.'); return; }
    if (mobile.newPassword.length < 8) { setMobileErr('Password must be at least 8 characters.'); return; }
    if (securityPending.current) return;
    securityPending.current = true;
    setMobileBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/admin-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: mobile.username, new_password: mobile.newPassword, user_type: 'mobile' }),
      });
      if (res.status === 204) {
        setSecurityEditor(null);
        setMobileMsg(`Password reset for ${mobile.username}.`);
        setMobile({ username: '', newPassword: '', confirmPassword: '' });
      } else {
        const b = await res.json().catch(() => ({}));
        setMobileErr(b?.detail ?? 'Failed to reset password.');
      }
    } catch { setMobileErr('Cannot connect to server.'); }
    finally { securityPending.current = false; setMobileBusy(false); }
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
        <div className={panelStyles.page}>
          <div className={panelStyles.heading}><h2>General</h2><p className={panelStyles.subtitle}>Manage your agency's information and registered account.</p></div>
          <section className={settingsStyles.agencyCard} aria-label="Agency Information">
            <header className={settingsStyles.agencyCardHeader}>
              <div><h3>Agency Information</h3><p>Business details associated with your agency.</p></div>
              <button className="btn secondary" disabled={agencyLoading || !!agencyErr} onClick={() => { setAgency({ ...agencySnapshot }); setAgencyEditing(true); setAgencyErr(''); setAgencyMsg(''); }}>Edit</button>
            </header>
            {agencyLoading ? <p role="status" className={settingsStyles.agencyLoading}>Loading agency information...</p> : <div>
              <section className={settingsStyles.agencySection} aria-labelledby="agency-details-heading">
                <div className={settingsStyles.agencySectionHeading}><h4 id="agency-details-heading">Agency details</h4><p>Your agency's name and identifier.</p></div>
                <dl className={settingsStyles.agencyRows}>
                  <div><dt>Agency name</dt><dd className={settingsStyles.agencyBusinessName}>{agencySnapshot.agencyName || <span className={settingsStyles.emptyValue}>Not configured</span>}</dd></div>
                  {user?.agency_code && <div><dt>Agency code</dt><dd className={settingsStyles.agencyCode}>{user.agency_code}</dd></div>}
                </dl>
              </section>
              <section className={settingsStyles.agencySection} aria-labelledby="agency-contact-heading">
                <div className={settingsStyles.agencySectionHeading}><h4 id="agency-contact-heading">Contact details</h4><p>Contact information for your agency.</p></div>
                <dl className={settingsStyles.agencyRows}>
                  <div><dt>Phone</dt><dd>{agencySnapshot.phone || <span className={settingsStyles.emptyValue}>Not added</span>}</dd></div>
                  <div><dt>Website</dt><dd>{agencySnapshot.website || <span className={settingsStyles.emptyValue}>Not added</span>}</dd></div>
                  <div><dt>Address</dt><dd>{agencySnapshot.address || <span className={settingsStyles.emptyValue}>Not added</span>}</dd></div>
                </dl>
              </section>
              <section className={settingsStyles.agencySection} aria-labelledby="agency-registration-heading">
                <div className={settingsStyles.agencySectionHeading}><h4 id="agency-registration-heading">Registration</h4><p>Account information managed by Super Admin.</p></div>
                <dl className={settingsStyles.agencyRows}>
                  <div><dt>Registered email</dt><dd><div className={settingsStyles.agencyEmail}>{agencySnapshot.email || <span className={settingsStyles.emptyValue}>Not configured</span>}<span className={settingsStyles.readOnly}>Read only</span></div><p className={settingsStyles.agencyEmailNote}>Used to sign in. Contact Super Admin to request a change.</p></dd></div>
                </dl>
              </section>
            </div>}
            {agencyErr && !agencyEditing && <div role="alert" className={`error-text ${settingsStyles.agencyLoading}`}>{agencyErr} <button className="btn secondary sm" onClick={() => setAgencyLoadTick(tick => tick + 1)}>Retry</button></div>}
          </section>
          {agencyMsg && <div role="status" className={panelStyles.toast}>{agencyMsg}</div>}
          {agencyEditing && <SettingsDialog title="Edit agency information" description="Update your agency's profile. The registered login email cannot be changed here." onSubmit={saveAgency} busy={agencySaving} error={agencyErr} onClose={() => { if (!agencySaving) { setAgency({ ...agencySnapshot }); setAgencyEditing(false); setAgencyErr(''); } }}>
            <div className={panelStyles.fields}>
              <label><span className={panelStyles.label}>Agency name *</span><input required value={agency.agencyName} onChange={e => setAgency(a => ({ ...a, agencyName: e.target.value }))} /></label>
              <label><span className={panelStyles.label}>Registered email</span><input type="email" value={agency.email} disabled aria-describedby="agency-email-help" /><span id="agency-email-help" className={settingsStyles.fieldHint}>Used for login. Contact Super Admin to request a change.</span></label>
              <label><span className={panelStyles.label}>Phone</span><input type="tel" value={agency.phone} onChange={e => setAgency(a => ({ ...a, phone: e.target.value }))} /></label>
              <label><span className={panelStyles.label}>Website</span><input type="url" placeholder="https://" value={agency.website} onChange={e => setAgency(a => ({ ...a, website: e.target.value }))} /></label>
              <label className={panelStyles.full}><span className={panelStyles.label}>Address</span><textarea rows={2} value={agency.address} onChange={e => setAgency(a => ({ ...a, address: e.target.value }))} /></label>
            </div>
          </SettingsDialog>}
        </div>
      )}

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
        <div className={panelStyles.page}>
          <div className={panelStyles.heading}><h2>Billing</h2><p className={panelStyles.subtitle}>Manage service rates, provider identifiers, and aggregator configuration.</p></div>
          <ServiceRatesSettings key={user?.agency_id ?? 'no-agency'} />
          <div className={`${panelStyles.grid} ${panelStyles.equalCards}`}>
            <BillingIdentitySettings key={user?.agency_id ?? 'no-agency'} />
            {(showSandata || showHhax) && <>
              {showSandata && <section className={panelStyles.card}>
                <div className={panelStyles.cardHeader}><div><h3>Sandata Aggregator</h3><p className={panelStyles.subtitle}>ODP / Waiver services</p></div><button className="btn secondary" onClick={openSandata}>Configure</button></div>
                <dl className={panelStyles.summary}><div><dt>Browser configuration</dt><dd><span className={panelStyles.badge}>{sandataCfg.sandata_enabled ? 'Enabled' : 'Disabled'}</span></dd></div><div><dt>Mode</dt><dd>{sandataCfg.sandata_mode === 'live' ? 'Live' : 'Simulation'}</dd></div><div><dt>Provider ID</dt><dd>{sandataCfg.sandata_medicaid_provider_id || 'Not configured'}</dd></div><div><dt>Credentials</dt><dd>{sandataCfg.sandata_password ? 'Password saved in this browser' : 'Not configured'}</dd></div></dl>
                <p className={panelStyles.hint}>These preferences are stored in this browser. Server submission credentials are configured separately.</p>
              </section>}
              {showHhax && <section className={panelStyles.card}>
                <div className={panelStyles.cardHeader}><div><h3>HHAeXchange Aggregator</h3><p className={panelStyles.subtitle}>PDA / MA services</p></div><button className="btn secondary" onClick={openHhax}>Configure</button></div>
                <dl className={panelStyles.summary}><div><dt>Browser configuration</dt><dd><span className={panelStyles.badge}>{hhaxCfg.hhax_enabled ? 'Enabled' : 'Disabled'}</span></dd></div><div><dt>Mode</dt><dd>{hhaxCfg.hhax_mode === 'production' ? 'Production' : 'Test'}</dd></div><div><dt>Provider ID</dt><dd>{hhaxCfg.hhax_provider_id || 'Not configured'}</dd></div><div><dt>Credentials</dt><dd>{hhaxCfg.hhax_password ? 'Password saved in this browser' : 'Not configured'}</dd></div></dl>
                <p className={panelStyles.hint}>These preferences are stored in this browser. Server submission credentials are configured separately.</p>
              </section>}
            </>}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className={panelStyles.page}>
          <div className={panelStyles.heading}><h2>Security</h2><p className={panelStyles.subtitle}>Manage your portal password and caregiver mobile access.</p></div>
          <div className={panelStyles.grid}>
            <section className={panelStyles.card}>
              <div className={panelStyles.cardHeader}><div><h3>Portal Users</h3><p className={panelStyles.subtitle}>Change your own portal password.</p></div><span className={panelStyles.badge}>WEB</span></div>
              <dl className={panelStyles.summary}><div><dt>Signed in as</dt><dd>{user?.display_name || user?.username}</dd></div><div><dt>Email</dt><dd>{user?.email || 'Not configured'}</dd></div></dl>
              <p className={panelStyles.hint}>Your current password is required to make a change.</p>
              <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setPortal({ currentPassword: '', newPassword: '', confirmPassword: '' }); setPortalErr(''); setSecurityEditor('portal'); }}>Change password</button>
            </section>
            <section className={panelStyles.card} id="mobile-app-users">
              <div className={panelStyles.cardHeader}><div><h3>Mobile App Users</h3><p className={panelStyles.subtitle}>Reset a caregiver's mobile password.</p></div><span className={panelStyles.badge}>MOBILE</span></div>
              <dl className={panelStyles.summary}><div><dt>Caregivers</dt><dd>{mobileCaregiversLoading ? 'Loading...' : mobileCaregiversError ? 'Unavailable' : mobileCaregivers.length}</dd></div><div><dt>Reset method</dt><dd>Administrator selects a caregiver</dd></div></dl>
              <p className={panelStyles.hint}>The caregiver's current password is not required.</p>
              <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setMobile({ username: '', newPassword: '', confirmPassword: '' }); setMobileErr(''); setSecurityEditor('mobile'); }}>Reset mobile password</button>
              {mobileCaregiversError && <ErrorBanner msg={mobileCaregiversError} />}
            </section>
          </div>
          <section className={panelStyles.card}>
            <div className={panelStyles.cardHeader}><div><h3>Password &amp; Session Policy</h3><p className={panelStyles.subtitle}>Security requirements for account changes.</p></div></div>
            <dl className={panelStyles.summary}><div><dt>Minimum password length</dt><dd>8 characters</dd></div><div><dt>Portal password change</dt><dd>Current password verification required</dd></div><div><dt>Mobile password reset</dt><dd>Authorized administrators and coordinators</dd></div><div><dt>Account scope</dt><dd>Caregivers within your agency</dd></div></dl>
          </section>
          {(portalMsg || mobileMsg) && <div className={panelStyles.toast} role="status">{portalMsg || mobileMsg}</div>}
          {securityEditor === 'portal' && <SettingsDialog title="Change portal password" description="Verify your current password, then choose a new one." onSubmit={handlePortalReset} busy={portalBusy} error={portalErr} submitLabel="Update password" onClose={() => { if (!portalBusy) { setSecurityEditor(null); setPortal({ currentPassword: '', newPassword: '', confirmPassword: '' }); setPortalErr(''); } }}>
            <div className={panelStyles.fields}>
              <label className={panelStyles.full}><span className={panelStyles.label}>Current password *</span><input type="password" autoComplete="current-password" required value={portal.currentPassword} onChange={e => setPortal(p => ({ ...p, currentPassword: e.target.value }))} /></label>
              <label><span className={panelStyles.label}>New password *</span><input type="password" autoComplete="new-password" required minLength={8} value={portal.newPassword} onChange={e => setPortal(p => ({ ...p, newPassword: e.target.value }))} /></label>
              <label><span className={panelStyles.label}>Confirm new password *</span><input type="password" autoComplete="new-password" required minLength={8} value={portal.confirmPassword} onChange={e => setPortal(p => ({ ...p, confirmPassword: e.target.value }))} /></label>
            </div>
          </SettingsDialog>}
          {securityEditor === 'mobile' && <SettingsDialog title="Reset mobile password" description="Select a caregiver and set their new mobile app password." onSubmit={handleMobileReset} busy={mobileBusy} error={mobileErr} submitLabel="Reset password" disableSubmit={!mobile.username || mobileCaregiversLoading || !!mobileCaregiversError} onClose={() => { if (!mobileBusy) { setSecurityEditor(null); setMobile({ username: '', newPassword: '', confirmPassword: '' }); setMobileErr(''); } }}>
            <div className={panelStyles.fields}>
              <label className={panelStyles.full}><span className={panelStyles.label}>Caregiver *</span><select required value={mobile.username} disabled={mobileCaregiversLoading || !!mobileCaregiversError} onChange={e => { setMobile({ username: e.target.value, newPassword: '', confirmPassword: '' }); setMobileErr(''); }}><option value="">{mobileCaregiversLoading ? 'Loading caregivers...' : 'Select a caregiver...'}</option>{mobileCaregivers.map(c => <option key={c.employee_id} value={c.username || `unavailable-${c.employee_id}`} disabled={!c.username}>{c.name} - {c.employee_code} - {c.username || 'No active mobile account'}</option>)}</select></label>
              <label><span className={panelStyles.label}>New password *</span><input type="password" autoComplete="new-password" required minLength={8} value={mobile.newPassword} onChange={e => setMobile(m => ({ ...m, newPassword: e.target.value }))} /></label>
              <label><span className={panelStyles.label}>Confirm new password *</span><input type="password" autoComplete="new-password" required minLength={8} value={mobile.confirmPassword} onChange={e => setMobile(m => ({ ...m, confirmPassword: e.target.value }))} /></label>
            </div>
            {mobileCaregiversError && <ErrorBanner msg={mobileCaregiversError} />}
            {!mobileCaregiversLoading && !mobileCaregiversError && mobileCaregivers.length === 0 && <p className={panelStyles.hint}>No caregivers are available.</p>}
          </SettingsDialog>}
        </div>
      )}

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
                    onAction={openSandata}
                  />
                )}
                {showHhax && (
                  <IntegrationCard
                    logo={<HHAXLogo />}
                    name="HHAeXchange Pennsylvania"
                    description="PDA / MA services · per-branch EVV submission."
                    connected={hhaxCfg.hhax_enabled}
                    onAction={openHhax}
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
      {showSandataModal && <SettingsDialog title="Configure Sandata" description="Browser preferences for ODP / Waiver submissions. Server credentials are managed separately." busy={sandataAggSaving} error={sandataAggErr} onClose={closeSandata} onSubmit={e => { e.preventDefault(); if (saveSandata()) setShowSandataModal(false); }}>
        <div className={panelStyles.fields}>
          <label className={panelStyles.full} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" style={{ width: 16 }} checked={sandataCfg.sandata_enabled} onChange={e => setSandataCfg(c => ({ ...c, sandata_enabled: e.target.checked }))} />Enable Sandata in this browser</label>
          {([
            ['sandata_medicaid_provider_id', 'Medicaid Provider ID', true], ['sandata_national_provider_id', 'National Provider ID (NPI)', false],
            ['sandata_provider_qualifier', 'Provider Qualifier', false], ['sandata_business_entity_id', 'Business Entity ID', false],
            ['sandata_user_id', 'User ID', true], ['sandata_tax_id', 'Tax ID (EIN)', false], ['sandata_password', 'Password', true],
          ] as const).map(([key, title, required]) => <label key={key}><span className={panelStyles.label}>{title}{required && sandataCfg.sandata_enabled ? ' *' : ''}</span><input type={key === 'sandata_password' ? 'password' : 'text'} autoComplete={key === 'sandata_password' ? 'new-password' : 'off'} required={required && sandataCfg.sandata_enabled} value={sandataCfg[key]} onChange={e => setSandataCfg(c => ({ ...c, [key]: e.target.value }))} /></label>)}
          <label><span className={panelStyles.label}>Submission mode</span><select value={sandataCfg.sandata_mode} onChange={e => setSandataCfg(c => ({ ...c, sandata_mode: e.target.value as SandataForm['sandata_mode'] }))}><option value="simulate">Simulation</option><option value="live">Live</option></select></label>
        </div>
        <p className={panelStyles.hint}>Saved only in this browser; this does not change the server's submission mode or credentials.</p>
      </SettingsDialog>}

      {showHhaxModal && <SettingsDialog title="Configure HHAeXchange" description="Browser preferences for PDA / MA submissions. Server credentials are managed separately." busy={hhaxAggSaving} error={hhaxAggErr} onClose={closeHhax} onSubmit={e => { e.preventDefault(); if (saveHhax()) setShowHhaxModal(false); }}>
        <div className={panelStyles.fields}>
          <label className={panelStyles.full} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" style={{ width: 16 }} checked={hhaxCfg.hhax_enabled} onChange={e => setHhaxCfg(c => ({ ...c, hhax_enabled: e.target.checked }))} />Enable HHAeXchange in this browser</label>
          {([
            ['hhax_provider_id', 'Provider ID', true], ['hhax_branch_id', 'Branch ID', false], ['hhax_business_entity_id', 'Business Entity ID', false],
            ['hhax_user_id', 'User ID', true], ['hhax_tax_id', 'Tax ID (EIN)', false], ['hhax_password', 'Password', true],
          ] as const).map(([key, title, required]) => <label key={key}><span className={panelStyles.label}>{title}{required && hhaxCfg.hhax_enabled ? ' *' : ''}</span><input type={key === 'hhax_password' ? 'password' : 'text'} autoComplete={key === 'hhax_password' ? 'new-password' : 'off'} required={required && hhaxCfg.hhax_enabled} value={hhaxCfg[key]} onChange={e => setHhaxCfg(c => ({ ...c, [key]: e.target.value }))} /></label>)}
          <label className={panelStyles.full}><span className={panelStyles.label}>Submission mode</span><select value={hhaxCfg.hhax_mode} onChange={e => setHhaxCfg(c => ({ ...c, hhax_mode: e.target.value as HhaxForm['hhax_mode'] }))}><option value="test">Test</option><option value="production">Production</option></select></label>
        </div>
        <p className={panelStyles.hint}>Saved only in this browser; this does not change the server's submission mode or credentials.</p>
      </SettingsDialog>}

    </ProtectedLayout>
  );
}
