'use client';

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { createBlankPayrollGroup, createDefaultPayPeriod, type PayrollGroup, type PayrollPayPeriod, type PayrollRateItem, type PayrollSettingsResponse } from '@/lib/queries/payroll';
import { getAllProviders, getProvider, PAYROLL_PROVIDER_KEY, type ProviderId, type UniversalRecord } from '@/lib/payroll/providers';
import { baseRate, FREQUENCIES, normalizePayrollPeriod, payGroupNeedsReview, payrollDate, scheduleSummary, WEEKDAYS } from '@/lib/payroll/settings-display';
import s from './payroll-settings.module.css';

type Editor = { type: 'group'; index: number | null } | { type: 'rate'; group: number; index: number | null } | { type: 'provider' | 'period' | 'preview' };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const price = (value: number) => `$${value.toFixed(2)}`;
const emptyPreview: UniversalRecord = {
  EmployeeID: '', ExternalEmployeeCode: '', FirstName: '', LastName: '', AgencyID: '', AgencyName: '', DepartmentCode: '', LocationCode: '',
  TimesheetID: '', VisitID: '', ClientID: '', ServiceType: '', ClockIn: '', ClockOut: '', TotalHours: 0, PayrollHours: 0, PayRateUsed: 0, GrossPay: 0,
  PayPeriodStart: '', PayPeriodEnd: '', PayDate: '', ClockInGPS: '', ClockOutGPS: '', Verified: '', CorrectionReason: '', OT_Hours: 0, HolidayHours: 0,
  DifferentialType: '', DifferentialAmount: 0, TravelTimeHours: 0, Notes: '',
};

function PayrollDialog({ title, description, busy, onClose, onSubmit, children, error, remove }: {
  title: string; description: string; busy: boolean; onClose: () => void; onSubmit?: (event: FormEvent) => void;
  children: ReactNode; error: string; remove?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="payroll-editor-title" aria-describedby="payroll-editor-description" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={onSubmit || (e => { e.preventDefault(); onClose(); })}>
      <div className={s.dialogHeader}><h2 id="payroll-editor-title">{title}</h2><p id="payroll-editor-description" className={s.subtitle}>{description}</p></div>
      <div className={s.dialogBody}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
        {error && <div role="alert" className="error-text">{error}</div>}
      </div>
      <div className={s.dialogFooter}>{remove}<button type="button" className="btn secondary" disabled={busy} onClick={onClose}>{onSubmit ? 'Cancel' : 'Close'}</button>{onSubmit && <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>}</div>
    </form>
  </dialog>;
}

function RuleFields({ item, onChange }: { item: PayrollRateItem; onChange: (patch: Partial<PayrollRateItem>) => void }) {
  return <div className={s.fields}>
    <label className={s.full}><span className={s.label}>Rule name *</span><input required value={item.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. Base rate or Weekend rate" /></label>
    <label><span className={s.label}>Pay type *</span><select value={item.pay_type} onChange={e => onChange({ pay_type: e.target.value as PayrollRateItem['pay_type'] })}><option>Hourly</option><option>Per Visit</option></select></label>
    <label><span className={s.label}>Rate ($) *</span><input required type="number" min="0" max="999999.99" step="0.01" value={item.rate} onChange={e => onChange({ rate: e.target.valueAsNumber })} /></label>
    <label><span className={s.label}>Effective from *</span><input required type="date" value={item.effective_date || ''} onChange={e => onChange({ effective_date: e.target.value })} /></label>
    <label><span className={s.label}>Applies on</span><input value={item.applies_on || ''} onChange={e => onChange({ applies_on: e.target.value })} placeholder="e.g. Weekends or Public holidays" /></label>
    <label className={s.full} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12 }}><input type="checkbox" style={{ width: 15 }} checked={item.is_base_rate} onChange={e => onChange({ is_base_rate: e.target.checked })} />Use as the group's base rate</label>
    <p className={`${s.muted} ${s.full}`} style={{ margin: 0 }}>The base rate applies by default. A group must have one base rate.</p>
  </div>;
}

export function PayrollSettingsPanel() {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PayrollSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(0);
  const [provider, setProvider] = useState<ProviderId>('universal');
  const [draftProvider, setDraftProvider] = useState<ProviderId>('universal');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [groupDraft, setGroupDraft] = useState<PayrollGroup>(createBlankPayrollGroup(0));
  const [ruleDraft, setRuleDraft] = useState<PayrollRateItem>(createBlankPayrollGroup(0).items[0]);
  const [periodDraft, setPeriodDraft] = useState<PayrollPayPeriod>(createDefaultPayPeriod());
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editError, setEditError] = useState('');
  const groups = data?.groups || [];
  const group = groups[selected];
  const currentProvider = getProvider(provider);
  const review = groups.map((g, index) => ({ g, index })).filter(({ g }) => payGroupNeedsReview(g));

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/settings/payroll', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Could not load payroll settings.');
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load payroll settings.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const stored = localStorage.getItem(PAYROLL_PROVIDER_KEY);
    if (getAllProviders().some(p => p.id === stored)) setProvider(stored as ProviderId);
    void load();
    // The parent remounts this workspace when the agency changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  function open(next: Editor) {
    setEditError('');
    if (next.type === 'group') setGroupDraft(copy(next.index === null ? createBlankPayrollGroup(groups.length) : groups[next.index]));
    if (next.type === 'rate') setRuleDraft(copy(next.index === null ? { ...createBlankPayrollGroup(0).items[0], name: '', is_base_rate: groups[next.group].items.length === 0, sort_order: groups[next.group].items.length } : groups[next.group].items[next.index]));
    if (next.type === 'period') setPeriodDraft(copy(data?.pay_period || createDefaultPayPeriod()));
    if (next.type === 'provider') setDraftProvider(provider);
    setEditor(next);
  }

  async function persist(nextGroups: PayrollGroup[], period: PayrollPayPeriod) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setEditError('');
    try {
      const response = await apiFetch('/api/settings/payroll', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: nextGroups, pay_period: normalizePayrollPeriod(period) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Check the names, rates, and dates.');
      const focusedGroup = editor?.type === 'group' ? groupDraft : groups[selected];
      const focusedIndex = result.groups.findIndex((g: PayrollGroup) => focusedGroup?.id != null ? g.id === focusedGroup.id : g.name === focusedGroup?.name.trim());
      setData(result); setSelected(current => focusedIndex >= 0 ? focusedIndex : Math.min(current, Math.max(0, result.groups.length - 1)));
      setEditor(null); setNotice('Payroll settings saved.'); router.refresh();
      window.dispatchEvent(new CustomEvent('payroll-settings-updated'));
    } catch (e) { setEditError(e instanceof Error ? e.message : 'Could not save payroll settings.'); }
    finally { saving.current = false; setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || !data) return;
    if (editor.type === 'provider') {
      try {
        localStorage.setItem(PAYROLL_PROVIDER_KEY, draftProvider); setProvider(draftProvider); setEditor(null); setNotice('Payroll export provider saved.');
      } catch { setEditError('Could not save the provider. Check that browser storage is available.'); }
      return;
    }
    if (editor.type === 'period') { void persist(groups, periodDraft); return; }
    const next = copy(groups);
    if (editor.type === 'group') {
      if (!groupDraft.name.trim()) { setEditError('Enter a pay group name.'); return; }
      if (editor.index === null) next.push({ ...groupDraft, name: groupDraft.name.trim() });
      else next[editor.index] = { ...groupDraft, name: groupDraft.name.trim() };
    }
    if (editor.type === 'rate') {
      if (!ruleDraft.name.trim() || !Number.isFinite(ruleDraft.rate) || ruleDraft.rate < 0) { setEditError('Enter a rule name and a valid rate.'); return; }
      const items = next[editor.group].items;
      const index = editor.index ?? items.length;
      items[index] = { ...ruleDraft, name: ruleDraft.name.trim() };
      if (ruleDraft.is_base_rate) items.forEach((item, i) => { item.is_base_rate = i === index; });
      if (!items.some(item => item.is_base_rate)) { setEditError('Choose a base rate for this group.'); return; }
      next[editor.group].items = [...items.filter(i => i.is_base_rate), ...items.filter(i => !i.is_base_rate)].map((item, i) => ({ ...item, sort_order: i }));
    }
    void persist(next, data.pay_period);
  }

  const editorTitle = editor?.type === 'group' ? (editor.index === null ? 'New pay group' : 'Edit pay group') : editor?.type === 'rate' ? (editor.index === null ? 'Add rate rule' : 'Edit rate rule') : editor?.type === 'period' ? 'Edit pay schedule' : editor?.type === 'provider' ? 'Change payroll provider' : 'Export format preview';
  return <div className={s.page}>
    <div className={s.heading}><div><h2>Pay Group</h2><p className={s.subtitle}>Set how caregivers are paid: pay groups and rates, the payroll export format, and the pay period.<br />Timesheets pull their pay rates from these settings.</p></div></div>
    {error && <div role="alert" className={s.review}>{error}<button className="btn secondary" onClick={() => void load()}>Retry</button></div>}
    {loading ? <p role="status" className={s.muted}>Loading payroll settings…</p> : data && <>
      {review.length > 0 && <div className={s.review}><span><strong>{review.length} pay group{review.length > 1 ? 's need' : ' needs'} review.</strong> {review[0].g.name} has a zero or missing base rate, or an unset or placeholder effective date.</span><button className="btn secondary" onClick={() => { setSelected(review[0].index); const item = baseRate(review[0].g); open(item ? { type: 'rate', group: review[0].index, index: review[0].g.items.indexOf(item) } : { type: 'group', index: review[0].index }); }}>Review</button></div>}
      <div className={s.layout}>
        <div className={s.column}>
          <section className={s.card} aria-label="Pay groups"><div className={s.cardHeading}><div><h3>Pay groups</h3><p className={s.subtitle}>Select a group to see its rate rules</p></div><button className="btn primary" disabled={loading || !data} onClick={() => open({ type: 'group', index: null })}>New pay group</button></div>
            <table className={s.table}><thead><tr><th>Pay group</th><th>Base rate</th><th>Effective from</th><th>Caregivers</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>
              {groups.map((g, i) => { const base = baseRate(g); return <tr key={g.id ?? i} className={i === selected ? s.selected : ''} tabIndex={0} aria-label={`Select ${g.name}`} aria-selected={i === selected} onClick={() => setSelected(i)} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); } }}>
                <td><div className={s.name}>{g.name}{g.name === 'Default Casual' && <span className={s.badge}>Default</span>}</div><div className={s.muted}>{g.description || 'No description added'}</div></td><td>{base ? <>{base.pay_type} · {price(base.rate)}</> : 'Not set'}</td><td>{payrollDate(base?.effective_date)}</td><td>{g.caregiver_count ?? 0}</td><td><span className={`${s.badge} ${payGroupNeedsReview(g) ? s.warning : s.active}`}>{payGroupNeedsReview(g) ? 'Needs review' : 'Active'}</span></td><td className={s.actionCell}><button className={s.editButton} aria-label={`Edit ${g.name}`} onClick={e => { e.stopPropagation(); setSelected(i); open({ type: 'group', index: i }); }}>Edit</button></td>
              </tr>; })}
            </tbody></table>
          </section>
          {group && <section className={s.card} aria-label="Rate rules"><div className={s.cardHeading}><div><h3>Rate rules · {group.name}</h3><p className={s.subtitle}>Rates used for timesheets in this pay group</p></div><button className="btn secondary" onClick={() => open({ type: 'rate', group: selected, index: null })}>Add rate rule</button></div>
            {group.items.map((item, i) => <div key={item.id ?? i} className={s.rule}><div className={s.ruleInfo}><span className={s.badge}>{item.is_base_rate ? 'Base rate' : item.name}</span><span><strong>{item.pay_type} · {price(item.rate)}</strong><span className={s.muted}> · effective {payrollDate(item.effective_date)}</span>{item.applies_on && <div className={s.muted}>{item.applies_on}</div>}</span></div><button className={s.editButton} aria-label={`Edit ${item.name}`} onClick={() => open({ type: 'rate', group: selected, index: i })}>Edit</button></div>)}
          </section>}
        </div>
        <div className={s.column}>
          <section className={s.card}><div className={s.cardHeading}><div><h3>Payroll provider</h3><p className={s.subtitle}>Sets the layout of the payroll export file</p></div></div><span className={s.label}>Current provider</span><div className={s.value}>{currentProvider.name}</div><p className={s.subtitle}>{currentProvider.description}</p><div className={s.actions}><button className="btn secondary" onClick={() => open({ type: 'provider' })}>Change provider</button><button className={s.textButton} onClick={() => open({ type: 'preview' })}>Preview export</button></div></section>
          <section className={s.card}><div className={s.cardHeading}><div><h3>Pay period</h3><p className={s.subtitle}>Groups timesheets for payroll</p></div></div><span className={s.label}>Schedule</span><div className={s.value}>{FREQUENCIES.find(([id]) => id === data.pay_period.frequency)?.[1]}</div><p className={s.subtitle}>{scheduleSummary(data.pay_period)}</p><div className={s.period}><span className={s.label}>Current period</span><strong>{payrollDate(data.current_period_start)} – {payrollDate(data.current_period_end)}</strong></div><div className={s.actions}><button className="btn secondary" onClick={() => open({ type: 'period' })}>Edit schedule</button></div></section>
        </div>
      </div>
    </>}
    {notice && <div className={s.toast} role="status">{notice}</div>}
    {editor && <PayrollDialog title={editorTitle} description={editor.type === 'rate' ? `Pay rules for ${groups[editor.group].name}.` : editor.type === 'group' ? 'Give this group a clear name and description.' : editor.type === 'period' ? 'Choose how timesheets are grouped into pay periods.' : 'Choose the file layout used when exporting payroll.'} busy={busy} onClose={() => { if (!busy) setEditor(null); }} onSubmit={editor.type === 'preview' ? undefined : save} error={editError}
      remove={editor.type === 'group' && editor.index !== null && groups.length > 1 ? <button className={s.danger} type="button" disabled={busy || !!groups[editor.index].caregiver_count} title={groups[editor.index].caregiver_count ? 'Reassign caregivers before removing this group.' : undefined} onClick={() => { if (data) void persist(groups.filter((_, i) => i !== editor.index), data.pay_period); }}>Remove group</button> : editor.type === 'rate' && editor.index !== null && !ruleDraft.is_base_rate ? <button className={s.danger} type="button" disabled={busy} onClick={() => { const next = copy(groups); next[editor.group].items.splice(editor.index!, 1); if (data) void persist(next, data.pay_period); }}>Remove rule</button> : undefined}>
      {editor.type === 'group' && <><div className={s.fields}><label className={s.full}><span className={s.label}>Group name *</span><input required value={groupDraft.name} onChange={e => setGroupDraft(g => ({ ...g, name: e.target.value }))} /></label><label className={s.full}><span className={s.label}>Description</span><textarea rows={2} value={groupDraft.description || ''} onChange={e => setGroupDraft(g => ({ ...g, description: e.target.value }))} placeholder="Who is this pay group for?" /></label></div>{editor.index === null && <div style={{ marginTop: 20 }}><RuleFields item={groupDraft.items[0]} onChange={patch => setGroupDraft(g => ({ ...g, items: [{ ...g.items[0], ...patch, is_base_rate: true }] }))} /></div>}</>}
      {editor.type === 'rate' && <RuleFields item={ruleDraft} onChange={patch => setRuleDraft(r => ({ ...r, ...patch }))} />}
      {editor.type === 'provider' && <div className={s.fields}><label className={s.full}><span className={s.label}>Payroll provider</span><select value={draftProvider} onChange={e => setDraftProvider(e.target.value as ProviderId)}>{getAllProviders().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className={`${s.subtitle} ${s.full}`}>{getProvider(draftProvider).description}</p></div>}
      {editor.type === 'preview' && <><p className={s.subtitle}>{currentProvider.name} · CSV column layout. No employee data is included in this preview.</p><div className={s.columns}>{Object.keys(currentProvider.mapRow(emptyPreview)).map(column => <span key={column} className={s.badge}>{column}</span>)}</div></>}
      {editor.type === 'period' && <div className={s.fields}>
        <label className={s.full}><span className={s.label}>Pay frequency *</span><select value={periodDraft.frequency} onChange={e => setPeriodDraft(p => ({ ...p, frequency: e.target.value as PayrollPayPeriod['frequency'], semi_monthly_days: p.semi_monthly_days.length === 2 ? p.semi_monthly_days : [1, 15] }))}>{FREQUENCIES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
        {['weekly', 'biweekly'].includes(periodDraft.frequency) && <label><span className={s.label}>Week starts on *</span><select value={periodDraft.week_starts_on || 'monday'} onChange={e => setPeriodDraft(p => ({ ...p, week_starts_on: e.target.value as PayrollPayPeriod['week_starts_on'] }))}>{WEEKDAYS.map(day => <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>)}</select></label>}
        {periodDraft.frequency === 'biweekly' && <label><span className={s.label}>First period starts *</span><input required type="date" value={periodDraft.anchor_date || ''} onChange={e => setPeriodDraft(p => ({ ...p, anchor_date: e.target.value }))} /></label>}
        {periodDraft.frequency === 'monthly' && <label><span className={s.label}>Close day *</span><input type="number" required min="1" max="31" value={periodDraft.monthly_day || 1} onChange={e => setPeriodDraft(p => ({ ...p, monthly_day: e.target.valueAsNumber }))} /></label>}
        {periodDraft.frequency === 'semimonthly' && [0, 1].map(i => <label key={i}><span className={s.label}>{i === 0 ? 'First' : 'Second'} close day *</span><input type="number" required min="1" max="31" value={periodDraft.semi_monthly_days[i] || (i === 0 ? 1 : 15)} onChange={e => setPeriodDraft(p => { const days = [...p.semi_monthly_days]; days[i] = e.target.valueAsNumber; return { ...p, semi_monthly_days: days }; })} /></label>)}
        <p className={`${s.subtitle} ${s.full}`}>{scheduleSummary(periodDraft)}</p>
      </div>}
    </PayrollDialog>}
  </div>;
}
