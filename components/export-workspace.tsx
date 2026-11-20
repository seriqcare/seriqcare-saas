'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { SettingsDialog } from './settings-dialog';
import panel from './settings-panels.module.css';
import { authenticatedDownload } from '@/lib/authenticated-download';
import { exportJson, type ExportKind, type ExportBatch, type ExportReadiness, type ExportDetail } from '@/lib/queries/exports';
import { getAllProviders, getProvider, PAYROLL_PROVIDER_KEY, type ProviderId } from '@/lib/payroll/providers';
import s from './export-workspace.module.css';

const money = (value: number | string) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const createdAt = (value: string) => new Date(/[Zz]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString('en-US');
const batchName = (id: number) => `EXP-${String(id).padStart(5, '0')}`;
type AuthorizationOption = { id: number; auth_number: string | null; provider_name: string | null; service_start_date: string; service_end_date: string };

export function ExportDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current, previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={s.dialog} aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><div className={s.dialogLayout}>
    <header className={s.dialogHeader}><h2>{title}</h2><button className="btn secondary sm" disabled={busy} onClick={onClose}>Close</button></header>
    <div className={s.dialogBody}>{children}</div>
  </div></dialog>;
}

export function ExportWorkspace({ kind, period: initialPeriod, compact = false, onBusyChange }: {
  kind: ExportKind; period: string; compact?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState<ExportReadiness | null>(null);
  const [batches, setBatches] = useState<ExportBatch[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [tab, setTab] = useState<'ready' | 'blocked' | 'history'>('ready');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [pendingBatch, setPendingBatch] = useState<ExportBatch | null>(null);
  const request = useRef<Record<string, unknown> | null>(null);
  const [provider, setProvider] = useState<ProviderId>('universal');
  const [detail, setDetail] = useState<ExportDetail | null>(null);
  const [legacy, setLegacy] = useState<{ id: number; claim_date: string; status: string; total_amount: number }[]>([]);
  const [legacyError, setLegacyError] = useState('');
  const [assignment, setAssignment] = useState<{ visitId: number; options: AuthorizationOption[]; selected: string; loading: boolean; error: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(PAYROLL_PROVIDER_KEY);
    if (getAllProviders().some(p => p.id === stored)) setProvider(stored as ProviderId);
  }, []);
  useEffect(() => { setPeriod(initialPeriod); setData(null); setPage(1); }, [initialPeriod]);
  useEffect(() => {
    let active = true, serial = 0;
    async function load() {
      const current = ++serial;
      const results = await Promise.allSettled([
        exportJson<ExportReadiness>(apiFetch, `/api/exports/readiness?kind=${kind}&period=${encodeURIComponent(period)}`),
        exportJson<{ items: ExportBatch[]; total: number }>(apiFetch, `/api/exports?kind=${kind}&page=${historyPage}&per_page=20`),
      ]);
      if (!active || current !== serial) return;
      const errors = [];
      if (results[0].status === 'fulfilled') setData(results[0].value); else errors.push('Could not load export eligibility.');
      if (results[1].status === 'fulfilled') { setBatches(results[1].value.items); setHistoryTotal(results[1].value.total); } else errors.push('Could not load export history.');
      setLoadError(errors.join(' '));
    }
    void load();
    const tick = () => { if (document.visibilityState !== 'hidden' && !saving.current) void load(); };
    const timer = window.setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [apiFetch, kind, period, historyPage, revision]);
  useEffect(() => {
    if (kind !== 'billing' || tab !== 'history') return;
    let active = true;
    exportJson<{ items: typeof legacy }>(apiFetch, '/api/billing/claims?per_page=100').then(result => { if (active) { setLegacy(result.items); setLegacyError(''); } }).catch(() => { if (active) setLegacyError('Earlier claim records could not be loaded.'); });
    return () => { active = false; };
  }, [apiFetch, kind, tab]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  function markBusy(value: boolean) { saving.current = value; setBusy(value); onBusyChange?.(value); }
  async function download(batch: ExportBatch) {
    await authenticatedDownload(`/api/exports/${batch.id}/download`, `${batch.kind}-${batch.provider}-${batchName(batch.id)}.csv`, apiFetch);
  }
  async function create(visitId?: number) {
    if (saving.current) return;
    markBusy(true); setActionError(''); setNotice('');
    let created = pendingBatch;
    try {
      if (!created) {
        request.current ??= { kind, period, provider: kind === 'payroll' ? provider : 'universal', request_id: crypto.randomUUID(), ...(visitId ? { visit_ids: [visitId] } : {}) };
        created = await exportJson<ExportBatch>(apiFetch, '/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current) });
        request.current = null;
        setPendingBatch(created);
      }
      await download(created);
      setPendingBatch(null); setNotice(`${batchName(created.id)} downloaded. ${created.visit_count} visit(s) recorded in export history.`);
    } catch (error) {
      if (!created && error instanceof Error && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500) request.current = null;
      setActionError(created ? `${batchName(created.id)} was created, but the download failed. Retry its download or use Export History.` : error instanceof Error ? error.message : 'Export failed. Retry or check Export History before creating another batch.');
    } finally {
      markBusy(false); setRevision(r => r + 1); router.refresh();
    }
  }
  async function historyDownload(batch: ExportBatch) {
    if (saving.current) return;
    markBusy(true); setActionError('');
    try { await download(batch); if (pendingBatch?.id === batch.id) setPendingBatch(null); setNotice(`${batchName(batch.id)} downloaded again. No new export was created.`); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Download failed.'); }
    finally { markBusy(false); }
  }
  async function view(batch: ExportBatch) {
    setActionError('');
    try { setDetail(await exportJson<ExportDetail>(apiFetch, `/api/exports/${batch.id}`)); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not load export details.'); }
  }
  async function chooseAuthorization(visitId: number) {
    setAssignment({ visitId, options: [], selected: '', loading: true, error: '' });
    try {
      const result = await exportJson<{ items: AuthorizationOption[] }>(apiFetch, `/api/exports/visits/${visitId}/authorizations`);
      setAssignment(a => a?.visitId === visitId ? { ...a, options: result.items, selected: result.items.length === 1 ? String(result.items[0].id) : '', loading: false } : a);
    } catch (e) { setAssignment(a => a?.visitId === visitId ? { ...a, loading: false, error: e instanceof Error ? e.message : 'Could not load authorizations.' } : a); }
  }
  async function assignAuthorization(event: React.FormEvent) {
    event.preventDefault();
    if (!assignment?.selected || saving.current) return;
    markBusy(true);
    try {
      await exportJson(apiFetch, `/api/exports/visits/${assignment.visitId}/authorization`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorization_id: Number(assignment.selected) }) });
      setAssignment(null); setNotice('Service authorization assigned. Billing eligibility updated.'); setRevision(r => r + 1); router.refresh();
    } catch (e) { setAssignment(a => a ? { ...a, error: e instanceof Error ? e.message : 'Could not assign authorization.' } : a); }
    finally { markBusy(false); }
  }

  const stats = data?.stats;
  const filtered = (data?.items || []).filter(row => (tab === 'ready' ? row.status === 'Ready for Export' : row.status !== 'Exported' && row.status !== 'Ready for Export') && `${row.visit_id} ${row.client_name} ${row.caregiver_name} ${row.service_code}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const historyPages = Math.max(1, Math.ceil(historyTotal / 20));
  const historyRows = batches;
  const actionLabel = pendingBatch ? 'Retry download' : request.current && actionError ? 'Retry export' : kind === 'billing' ? 'Export Billing Data' : 'Export Payroll';

  return <div className={s.workspace}>
    <div className={s.header}><div>{!compact && <h1>Billing</h1>}<p className={s.subtitle}>{kind === 'billing' ? 'Export approved visits with completed EVV checks and billing setup. Timesheet approval is not required. No claims are submitted from this page.' : 'Export approved timesheets with configured caregiver pay details. Billing rates and aggregator acceptance do not control payroll eligibility.'}</p></div>
      <div className={s.actions}>
        {!compact && <select aria-label="Billing period" value={period} disabled={busy || !!pendingBatch || !!request.current} onChange={e => { setPeriod(e.target.value); setData(null); setPage(1); }}><option value="this_month">This Month</option><option value="last_month">Last Month</option><option value="last3m">Last 3 Months</option><option value="this_week">This Week</option><option value="last_week">Last Week</option></select>}
        {kind === 'payroll' && <select aria-label="Payroll export format" value={provider} disabled={busy || !!pendingBatch || !!request.current} onChange={e => setProvider(e.target.value as ProviderId)}>{getAllProviders().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <button className="btn primary" onClick={() => void create()} disabled={busy || (!pendingBatch && !(request.current && actionError) && (!stats?.ready || !!loadError))}>{busy ? 'Exporting…' : actionLabel}</button>
      </div>
    </div>
    {data && <p className={s.subtitle}>Visit dates: {date(data.period_start)} – {date(data.period_end)}{kind === 'payroll' ? ` · ${getProvider(provider).name}` : ''}</p>}
    {notice && <div className={s.success} role="status">{notice}</div>}
    {actionError && <div className={s.error} role="alert">{actionError} {(pendingBatch || request.current) && <button className="btn secondary sm" disabled={busy} onClick={() => void create()}>{pendingBatch ? 'Retry download' : 'Retry export'}</button>}</div>}
    {loadError && <div className={s.error} role="alert">{loadError} <button className="btn secondary sm" onClick={() => setRevision(r => r + 1)}>Retry</button></div>}
    {!data && !loadError && <p role="status" className={s.subtitle}>Checking export eligibility…</p>}
    <div className={s.metrics}>{[
      ['Ready for Export', stats?.ready, 'New eligible visits'],
      kind === 'billing'
        ? [period === 'this_month' || period === 'last_month' ? 'Month Amount' : 'Period Amount', stats?.period_amount != null ? money(stats.period_amount) : undefined, 'Ready + exported visits · estimated']
        : ['Needs Attention', stats?.blocked, 'Approval or setup required'],
      ['Exported Visits', stats?.exported, 'Already included in a batch'], ['Ready Amount', stats ? money(stats.ready_amount) : undefined, kind === 'billing' ? 'Estimated billing amount' : 'Configured payroll amount'],
    ].map(([label, value, note]) => <div className={s.metric} key={String(label)}><div className={s.metricLabel}>{label}</div><div className={s.metricValue}>{value ?? '—'}</div><div className={s.metricNote}>{note}</div></div>)}</div>
    <section className={s.card}>
      <div className={s.tabs} role="tablist" aria-label={`${kind} exports`}>{([['ready', 'Ready for Export'], ['blocked', 'Needs Attention'], ['history', 'Export History']] as const).map(([key, title]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setPage(1); }}>{title}</button>)}</div>
      <div className={s.toolbar}><div><h2>{tab === 'history' ? 'Export History' : tab === 'ready' ? 'Ready for Export' : 'Visits Needing Attention'}</h2><p className={s.subtitle}>{tab === 'history' ? 'All saved export batches for this agency. Re-download the original snapshot.' : tab === 'ready' ? 'Only eligible, previously unexported visits are included in a new export.' : 'Resolve the reasons shown below. Eligibility updates automatically.'}</p></div>{tab !== 'history' && <input className="input" aria-label="Search export visits" placeholder="Search client, caregiver, or visit" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ width: 240, maxWidth: '100%' }} />}</div>
      <div className={s.scroll}><table className={s.table}>
        <thead><tr>{(tab === 'history' ? ['Export ID', 'Visit Period', 'Created', 'Created By', 'Visits', 'Amount', 'Actions'] : ['Visit ID', 'Date', 'Client', 'Caregiver', 'Service', kind === 'billing' ? 'Units' : 'Hours', 'Amount', 'Status / Eligibility', 'Actions']).map(title => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{tab === 'history' ? historyRows.map(batch => <tr key={batch.id}><td>{batchName(batch.id)}</td><td>{date(batch.period_start)} – {date(batch.period_end)}</td><td>{createdAt(batch.created_at)}</td><td>{batch.created_by_name}</td><td>{batch.visit_count}</td><td className={s.money}>{money(batch.total_amount)}</td><td><div className={s.actions}><button className={s.textButton} onClick={() => void view(batch)}>View</button><button className={s.textButton} disabled={busy} onClick={() => void historyDownload(batch)}>Download CSV</button></div></td></tr>) : visible.map(row => <tr key={row.visit_id}><td>{row.visit_id}</td><td>{date(row.service_date)}</td><td>{row.client_name}</td><td>{row.caregiver_name}</td><td>{row.service_code || '—'}</td><td>{Number(kind === 'billing' ? row.units : row.hours).toFixed(2)}</td><td className={s.money}>{row.rate == null ? '—' : money(row.amount)}</td><td><span className={`${s.status} ${row.status === 'Ready for Export' ? s.ready : s.blocked}`}>{row.status === 'Pending Approval' && kind === 'billing' ? 'Pending visit approval' : row.status}</span>{row.reasons.length > 0 && <div className={s.reason}>{row.reasons.join(' · ')}</div>}</td><td>{row.status === 'Ready for Export' ? <button className={s.textButton} disabled={busy || !!pendingBatch || !!request.current || !!loadError} onClick={() => void create(row.visit_id)}>Export</button> : kind === 'billing' && row.authorization_id == null ? <button className={s.textButton} disabled={busy} onClick={() => void chooseAuthorization(row.visit_id)}>Assign authorization</button> : '—'}</td></tr>)}</tbody>
      </table></div>
      {(tab === 'history' ? !historyRows.length : !visible.length) && !loadError && data && <div className={s.empty}>{tab === 'history' ? 'No exports recorded for this agency yet.' : tab === 'ready' ? 'No new visits ready for export in this period.' : 'No visits need attention in this period.'}</div>}
      <div className={s.footer}><span>{tab === 'history' ? `${historyTotal} export batches` : `${filtered.length} visits`}</span><div className={s.actions}><button className="btn secondary sm" disabled={tab === 'history' ? historyPage <= 1 : currentPage <= 1} onClick={() => tab === 'history' ? setHistoryPage(p => p - 1) : setPage(p => p - 1)}>Previous</button><span>{tab === 'history' ? historyPage : currentPage} / {tab === 'history' ? historyPages : pages}</span><button className="btn secondary sm" disabled={tab === 'history' ? historyPage >= historyPages : currentPage >= pages} onClick={() => tab === 'history' ? setHistoryPage(p => p + 1) : setPage(p => p + 1)}>Next</button></div></div>
    </section>
    {tab === 'history' && kind === 'billing' && <details className={`${s.card} ${s.legacy}`}><summary>Earlier claim records (read only)</summary><p>Showing up to 100 records preserved from the previous workflow. They do not mark visits as exported and are not sent to a payer.</p>{legacyError || (legacy.length ? <div className={s.scroll}><table className={s.table}><thead><tr><th>Record</th><th>Date</th><th>Legacy status</th><th>Amount</th><th>Actions</th></tr></thead><tbody>{legacy.map(row => <tr key={row.id}><td>#{row.id}</td><td>{date(row.claim_date)}</td><td>{row.status}</td><td>{money(row.total_amount)}</td><td><button className={s.textButton} onClick={async () => { try { await authenticatedDownload(`/api/billing/claims/${row.id}/export?format=csv`, `legacy-claim-${row.id}.csv`, apiFetch); } catch (e) { setActionError(e instanceof Error ? e.message : 'Download failed.'); } }}>Download legacy CSV</button></td></tr>)}</tbody></table></div> : 'No earlier records.')}</details>}
    {assignment && <SettingsDialog title="Assign service authorization" description={`Choose the authorization for visit #${assignment.visitId}. Only matching agency, client, service, and visit dates are listed.`} busy={busy} error={assignment.error} disableSubmit={assignment.loading || !assignment.selected} submitLabel="Assign authorization" onSubmit={assignAuthorization} onClose={() => { if (!busy) setAssignment(null); }}>
      <div className={panel.fields}><label className={panel.full}><span className={panel.label}>Service authorization *</span><select required disabled={assignment.loading} value={assignment.selected} onChange={e => setAssignment(a => a ? { ...a, selected: e.target.value, error: '' } : a)}><option value="">{assignment.loading ? 'Loading authorizations…' : 'Select an authorization…'}</option>{assignment.options.map(option => <option key={option.id} value={option.id}>{option.auth_number || 'No authorization number'} · {option.provider_name || 'Provider not configured'} · {date(option.service_start_date)} – {date(option.service_end_date)}</option>)}</select></label></div>
      {!assignment.loading && !assignment.options.length && !assignment.error && <p className={panel.hint}>No active authorizations match this visit. Add one under the client's Authorizations tab, then return here.</p>}
    </SettingsDialog>}
    {detail && <ExportDialog title={`${batchName(detail.id)} · ${detail.kind === 'billing' ? 'Billing' : 'Payroll'} export`} busy={busy} onClose={() => setDetail(null)}>
      <div className={s.detail}><div>Created by<strong>{detail.created_by_name}</strong></div><div>Created<strong>{createdAt(detail.created_at)}</strong></div><div>Visits<strong>{detail.visit_count}</strong></div><div>Total amount<strong>{money(detail.total_amount)}</strong></div><div>Format<strong>{detail.provider}</strong></div></div>
      <div className={s.scroll}><table className={s.table}><thead><tr><th>Visit</th><th>Service Date / Clock In</th><th>Client</th><th>Caregiver</th><th>Units / Hours</th><th>Amount</th></tr></thead><tbody>{detail.items.map(({ visit_id, data: row }) => <tr key={visit_id}><td>{visit_id}</td><td>{row['Service Date'] || row.ClockIn}</td><td>{row.Client || row.ClientID}</td><td>{row.Caregiver || `${row.FirstName} ${row.LastName}`}</td><td>{row['Billing Units'] ?? row['Approved Units'] ?? row.TotalHours}</td><td>{money(row['Estimated Amount'] ?? row.GrossPay ?? 0)}</td></tr>)}</tbody></table></div>
      <p className={s.notice}>{detail.kind === 'billing' ? 'This file contains supporting billing data. It is not a submitted claim or a payment confirmation.' : 'This is the saved payroll snapshot. Re-downloading does not add visits to a new batch.'}</p>
      <button className="btn primary" disabled={busy} onClick={() => void historyDownload(detail)}>Download original CSV</button>
    </ExportDialog>}
  </div>;
}
