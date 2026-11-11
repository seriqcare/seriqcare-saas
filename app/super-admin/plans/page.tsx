'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { useAuth } from '@/components/auth-context';

type PlanKey = 'core' | 'evv' | 'evvplus';
type Aggregator = 'sandata' | 'hhax';
type Agency = { id: number; agency_code: string; name: string; tier: string; aggregator: string | null; is_active: boolean };
const plans: { key: PlanKey; name: string; description: string; integration: string; available: boolean }[] = [
  { key: 'core', name: 'Core', description: 'Everyday home care operations, without EVV.', integration: 'No EVV integration', available: true },
  { key: 'evv', name: 'EVV', description: 'Core operations with electronic visit verification.', integration: 'Sandata or HHAeXchange', available: true },
  { key: 'evvplus', name: 'EVV+', description: 'Advanced integrations for growing agency needs.', integration: 'Multiple integrations planned', available: false },
];
const groups = [
  { name: 'Operations', features: ['Dashboard', 'Clients', 'Caregivers', 'Schedule', 'Visits (EVV)'] },
  { name: 'Clinical', features: ['Care plans', 'Documentation'] },
  { name: 'Finance', features: ['Timesheets', 'Billing', 'Claims'] },
  { name: 'Reports & settings', features: ['Reports', 'General, notifications & security', 'Billing & payroll settings', 'EVV aggregator'] },
];
const evvFeatures = ['Visits (EVV)', 'EVV aggregator'];
const planName = (key: string) => plans.find(plan => plan.key === key)?.name ?? key ?? 'Unassigned';
const aggregatorName = (key: string | null) => key === 'sandata' ? 'Sandata' : key === 'hhax' ? 'HHAeXchange' : 'Not configured';

function Availability({ available, planned = false }: { available: boolean; planned?: boolean }) {
  if (planned) return <span className="pm-planned-text">Planned</span>;
  return <span className={available ? 'pm-included' : 'pm-unavailable'}><span aria-hidden="true">{available ? '✓' : '—'}</span><span>{available ? 'Included' : 'Not included'}</span></span>;
}

export default function PlansPage() {
  const { user, apiFetch } = useAuth();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [differences, setDifferences] = useState(false);
  const [editing, setEditing] = useState<Agency | null>(null);
  const assignmentsRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canManage = user?.role === 'super_admin';
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const res = await apiFetch('/api/super-admin/agencies', { signal });
      if (!res.ok) throw new Error('Unable to load agency assignments. Please try again.');
      const data: Agency[] = await res.json();
      if (!signal?.aborted) setAgencies(data);
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load agencies.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [apiFetch]);
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canManage, load]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return agencies.filter(agency => (filter === 'all' || agency.tier === filter) &&
      `${agency.id} ${agency.name} ${agency.agency_code}`.toLowerCase().includes(query));
  }, [agencies, filter, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const managePlan = (key: PlanKey) => {
    setFilter(key); setSearch(''); setPage(1);
    const assignments = assignmentsRef.current;
    if (assignments) {
      const scroller = assignments.closest<HTMLElement>('[data-page-scroll]');
      if (scroller) {
        scroller.scrollTo({ top: scroller.scrollTop + assignments.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20, behavior: 'smooth' });
      }
    }
    searchRef.current?.focus({ preventScroll: true });
  };

  if (!canManage) return <ProtectedLayout><div className="sa-empty">Access denied. Plans are managed by platform super admins.</div></ProtectedLayout>;

  return <ProtectedLayout scrollable>
    <div className="topbar">
      <div><h1 className="page-title">Plans & features</h1><p className="page-subtitle">Compare plan access and manage agency assignments across the platform.</p></div>
      <div className="top-actions"><HeaderUser /></div>
    </div>
    <div className="pm-page">
      {notice && <div className="sa-success pm-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
      {error && <div className="sa-error pm-notice" role="alert"><span>{error}</span><button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>Retry</button></div>}
      <section className="pm-summary" aria-label="Platform plans">
        {plans.map((plan, index) => {
          const assigned = agencies.filter(agency => agency.tier === plan.key);
          return <article className={`pm-plan${plan.available ? '' : ' pm-plan-planned'}`} key={plan.key}>
            <div className="pm-plan-top"><span className="pm-overline">PLAN {String(index + 1).padStart(2, '0')}</span><span className={`pm-status ${plan.available ? 'pm-status-active' : 'pm-status-planned'}`}>{plan.available ? 'Available' : 'Planned'}</span></div>
            <h2>{plan.name}</h2><p className="pm-plan-description">{plan.description}</p>
            <div className="pm-agency-count"><strong>{loading ? '—' : assigned.length}</strong><span>assigned {assigned.length === 1 ? 'agency' : 'agencies'}<small>{loading ? 'Loading assignments' : `${assigned.filter(a => a.is_active).length} active`}</small></span></div>
            <div className="pm-plan-integration"><span aria-hidden="true">{plan.available ? '◇' : '◷'}</span>{plan.integration}</div>
            <button type="button" className="btn secondary pm-manage-button" disabled={loading || (!plan.available && assigned.length === 0)} onClick={() => managePlan(plan.key)}>{plan.available ? 'Manage agencies' : assigned.length ? 'Review assignments' : 'Not available for assignment'}<span aria-hidden="true">→</span></button>
          </article>;
        })}
      </section>

      <section className="pm-section" aria-labelledby="feature-comparison-title">
        <div className="pm-section-heading"><div><h2 id="feature-comparison-title">Feature comparison</h2><p>Plan entitlements at a glance.</p></div><label className="pm-toggle"><input type="checkbox" checked={differences} onChange={e => setDifferences(e.target.checked)} />Differences only</label></div>
        <div className="pm-table-scroll"><table className="pm-comparison"><caption className="pm-sr-only">Feature availability by plan. EVV+ is planned and cannot be newly assigned.</caption>
          <thead><tr><th scope="col">Modules & features</th>{plans.map(plan => <th scope="col" key={plan.key}>{plan.name}{!plan.available && <span className="pm-column-note">Planned</span>}</th>)}</tr></thead>
          <tbody>{groups.map(group => {
            const features = group.features.filter(feature => !differences || evvFeatures.includes(feature));
            return features.length ? <Fragment key={group.name}><tr className="pm-group-row"><th colSpan={4} scope="colgroup">{group.name}</th></tr>{features.map(feature => <tr key={feature}><th scope="row">{feature}</th><td><Availability available={!evvFeatures.includes(feature)} /></td><td>{feature === 'EVV aggregator' ? <span className="pm-aggregator-label">Sandata or HHAeXchange</span> : <Availability available />}</td><td><Availability available={false} planned /></td></tr>)}</Fragment> : null;
          })}</tbody>
        </table></div>
        <div className="pm-section-note">EVV+ is planned. Existing assignments can be reviewed, but new assignments are disabled.</div>
      </section>

      <section ref={assignmentsRef} className="pm-section" aria-labelledby="agency-assignments-title">
        <div className="pm-section-heading"><div><h2 id="agency-assignments-title">Agency assignments <span className="pm-count-badge">{loading ? '—' : agencies.length}</span></h2><p>Review each agency’s plan and EVV integration.</p></div><button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing...' : 'Refresh'}</button></div>
        <div className="pm-toolbar"><div className="pm-search-wrap"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input ref={searchRef} aria-label="Search agencies by name, code or ID" placeholder="Search agency name, code or ID" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><select className="form-select pm-filter" aria-label="Filter agencies by plan" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="all">All plans</option>{plans.map(plan => <option key={plan.key} value={plan.key}>{plan.name}</option>)}</select>{(search || filter !== 'all') && <button type="button" className="pm-text-button" onClick={() => { setSearch(''); setFilter('all'); setPage(1); }}>Clear filters</button>}</div>
        <div className="pm-table-scroll"><table className="pm-agencies"><thead><tr><th scope="col">Agency</th><th scope="col">Agency ID</th><th scope="col">Plan</th><th scope="col">Aggregator</th><th scope="col">Status</th><th scope="col"><span className="pm-sr-only">Actions</span></th></tr></thead><tbody>
          {loading ? <tr><td colSpan={6} className="pm-table-empty" role="status">Loading agency assignments...</td></tr> : error ? <tr><td colSpan={6} className="pm-table-empty">Agency assignments could not be refreshed. Retry to load current data.</td></tr> : visible.length === 0 ? <tr><td colSpan={6} className="pm-table-empty">{agencies.length ? 'No agencies match your search.' : 'No agencies yet. Create an agency from the Super Admin page.'}</td></tr> : visible.map(agency => <tr key={agency.id}><td><strong>{agency.name}</strong><span className="pm-agency-code">{agency.agency_code}</span></td><td className="pm-id">{agency.id}</td><td><span className="pm-plan-label">{planName(agency.tier)}</span></td><td>{agency.tier === 'core' ? <span className="pm-muted">Not applicable</span> : aggregatorName(agency.aggregator)}</td><td><span className={`pm-status ${agency.is_active ? 'pm-status-active' : 'pm-status-planned'}`}>{agency.is_active ? 'Active' : 'Inactive'}</span></td><td className="pm-row-action"><button type="button" className="btn secondary" aria-label={`Change plan for ${agency.name}`} onClick={() => setEditing(agency)}>Change plan</button></td></tr>)}
        </tbody></table></div>
        <div className="pm-table-footer"><span>{loading ? 'Loading...' : `${filtered.length ? (currentPage - 1) * 10 + 1 : 0} to ${Math.min(currentPage * 10, filtered.length)} of ${filtered.length} agencies`}</span><div><button type="button" className="btn secondary" disabled={loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" className="btn secondary" disabled={loading || currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
      </section>
    </div>
    {editing && <ChangeAgencyPlan key={editing.id} agency={editing} apiFetch={apiFetch} onClose={() => setEditing(null)} onSaved={(tier, aggregator) => {
      setAgencies(current => current.map(agency => agency.id === editing.id ? { ...agency, tier, aggregator } : agency));
      setNotice(`${editing.name} is now assigned to ${planName(tier)}${aggregator ? ` with ${aggregatorName(aggregator)}` : ''}.`);
      setEditing(null);
    }} />}
  </ProtectedLayout>;
}

function ChangeAgencyPlan({ agency, apiFetch, onClose, onSaved }: {
  agency: Agency; apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void; onSaved: (tier: PlanKey, aggregator: Aggregator | null) => void;
}) {
  const [tier, setTier] = useState<PlanKey>(agency.tier as PlanKey);
  const [aggregator, setAggregator] = useState<Aggregator>(agency.aggregator === 'hhax' ? 'hhax' : 'sandata');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextAggregator = tier === 'core' ? null : aggregator;
  const changed = tier !== agency.tier || (tier !== 'core' && nextAggregator !== agency.aggregator);
  const losesEVV = agency.tier !== 'core' && tier === 'core';
  const gainsEVV = agency.tier === 'core' && tier === 'evv';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const scroller = modalRef.current?.closest<HTMLElement>('[data-page-scroll]');
    const overflow = scroller?.style.overflowY ?? '';
    if (scroller) scroller.style.overflowY = 'hidden';
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      if (scroller) scroller.style.overflowY = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [reviewing]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !changed || !['core', 'evv'].includes(tier)) return;
    if (!reviewing) { setReviewing(true); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/super-admin/agencies/${agency.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier, aggregator: nextAggregator }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to update this agency’s plan.');
      }
      onSaved(tier, nextAggregator);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save the plan.'); }
    finally { setSaving(false); }
  };
  return <div className="sa-modal-backdrop pm-backdrop" onClick={() => { if (!saving) onClose(); }}><div className="sa-modal pm-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="change-plan-title" onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab') return;
    const controls = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)');
    if (!controls?.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}><div className="sa-modal-header"><h2 id="change-plan-title" ref={headingRef} tabIndex={-1}>{reviewing ? 'Confirm plan change' : 'Change agency plan'}</h2><button type="button" className="sa-modal-close" disabled={saving} onClick={onClose} aria-label="Close plan change">×</button></div>
    <p className="pm-modal-subtitle">{agency.name} <span>Agency ID {agency.id}</span></p>
    {error && <div className="sa-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      {!reviewing ? <><label className="pm-field">Plan<select className="form-select" value={tier} onChange={e => setTier(e.target.value as PlanKey)}><option value="core">Core</option><option value="evv">EVV</option><option value="evvplus" disabled>EVV+ (planned)</option></select></label>{tier === 'evv' && <label className="pm-field">EVV aggregator<select className="form-select" value={aggregator} onChange={e => setAggregator(e.target.value as Aggregator)}><option value="sandata">Sandata</option><option value="hhax">HHAeXchange</option></select></label>}<p className="pm-help">EVV+ is not available for new assignments. Core does not use an EVV aggregator.</p></> : <>
        <div className="pm-change-summary"><div><span>Current plan</span><strong>{planName(agency.tier)}</strong><small>{agency.tier === 'core' ? 'No EVV integration' : aggregatorName(agency.aggregator)}</small></div><span aria-hidden="true">→</span><div><span>New plan</span><strong>{planName(tier)}</strong><small>{nextAggregator ? aggregatorName(nextAggregator) : 'No EVV integration'}</small></div></div>
        <div className={`pm-impact${losesEVV ? ' pm-impact-warning' : ''}`}><strong>{losesEVV ? 'Features removed' : gainsEVV ? 'Features added' : 'Integration change'}</strong><p>{losesEVV ? 'EVV visits and aggregator submissions will no longer be available under Core.' : gainsEVV ? 'The agency will gain EVV visits and aggregator integration.' : `The agency’s EVV aggregator will change to ${aggregatorName(nextAggregator)}.`}</p><span>Existing agency records are retained.</span></div>
      </>}
      <div className="sa-modal-actions"><button type="button" className="btn secondary" disabled={saving} onClick={() => reviewing ? setReviewing(false) : onClose()}>{reviewing ? 'Back' : 'Cancel'}</button><button type="submit" className="btn" disabled={saving || !changed || !['core', 'evv'].includes(tier)}>{saving ? 'Saving...' : reviewing ? 'Confirm change' : 'Review change'}</button></div>
    </form>
  </div></div>;
}
