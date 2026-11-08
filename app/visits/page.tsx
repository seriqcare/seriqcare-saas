import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { getVisits, type VisitEntry } from '@/lib/queries/timesheets';
import { VisitSubmitBtn } from '@/components/visit-submit-btn';
import { QueryTabs } from '@/components/query-tabs';
import { VisitPeriodSelect } from '@/components/visit-period-select';
import { EscCodePanel } from '@/components/esc-code-panel';
import { VisitRowActions } from '@/components/visit-detail-modal';
import { AggregatorOffBanner } from '@/components/aggregator-off-banner';
import { AggregatorTabs } from '@/components/aggregator-tabs';

export const dynamic = 'force-dynamic';

const PER_PAGE = 20;

/* ── EVV status maps ──────────────────────────────────── */
const EVV_COLOR: Record<string, string> = {
  Pending:  '#c4831e',
  Verified: '#35693c',
  Failed:   '#d56b6b',
  Adjusted: '#2567a4',
  Exempt:   '#8a9aaa',
};
const EVV_CLS: Record<string, string> = {
  Pending:  'hold',
  Verified: 'active',
  Failed:   'flag',
  Adjusted: '',
  Exempt:   '',
};

/* ── Integration status maps (Sandata & HHAeXchange) ──── */
const INT_COLOR: Record<string, string> = {
  Draft:     '#8a9aaa',
  Ready:     '#35693c',
  Submitted: '#2567a4',
  Accepted:  '#1d5c35',
  Rejected:  '#d56b6b',
};
const INT_CLS: Record<string, string> = {
  Draft:     '',
  Ready:     'active',
  Submitted: '',
  Accepted:  'active',
  Rejected:  'flag',
};

/* ── Sandata submission mock data ────────────────────── */
const SANDATA_SUBMISSIONS = [
  { id: 'TXN-20260308-001', type: 'Visit',    count: 14, status: 'Accepted', submitted: '2026-03-08', accepted: 13, rejected: 1 },
  { id: 'TXN-20260307-001', type: 'Visit',    count: 18, status: 'Accepted', submitted: '2026-03-07', accepted: 18, rejected: 0 },
  { id: 'TXN-20260306-001', type: 'Client',   count: 2,  status: 'Accepted', submitted: '2026-03-06', accepted: 2,  rejected: 0 },
  { id: 'TXN-20260305-001', type: 'Visit',    count: 22, status: 'Partial',  submitted: '2026-03-05', accepted: 19, rejected: 3 },
  { id: 'TXN-20260304-001', type: 'Employee', count: 1,  status: 'Accepted', submitted: '2026-03-04', accepted: 1,  rejected: 0 },
];

const SUB_STATUS_CLS: Record<string, string> = {
  Accepted: 'active',
  Partial:  'pending',
  Rejected: 'flag',
  Pending:  'hold',
};

/* ── Helpers ──────────────────────────────────────────── */
function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function evvBreakdown(items: VisitEntry[]) {
  const counts: Record<string, number> = { Pending: 0, Verified: 0, Failed: 0, Adjusted: 0, Exempt: 0 };
  for (const v of items) {
    if (v.evv_status in counts) counts[v.evv_status]++;
  }
  return counts;
}

function complianceRate(counts: Record<string, number>, total: number) {
  return total === 0 ? 100 : Math.round(((counts.Verified + counts.Adjusted + counts.Exempt) / total) * 100);
}

function periodLabel(week: string) {
  if (week === 'last2') return 'Last 2 Weeks';
  if (week === 'last4') return 'Last 4 Weeks';
  return 'This Week';
}

function buildPageHref(search: string, status: string, week: string, aggregator: string, page: number) {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (status) p.set('status', status);
  if (week !== 'current') p.set('week', week);
  if (aggregator) p.set('aggregator', aggregator);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  return qs ? `/visits?${qs}` : '/visits';
}

/* ── Per-aggregator tab config ────────────────────────── */
function getTabConfig(aggregator: string) {
  if (aggregator === 'sandata') {
    return {
      label: 'Sandata',
      subtitle: 'PA-DHS EVV · Sandata aggregator · ODP Consolidated Waiver',
      statusTabs: [
        { label: 'All',       value: '' },
        { label: 'Draft',     value: 'Draft',     dotColor: INT_COLOR.Draft     },
        { label: 'Ready',     value: 'Ready',     dotColor: INT_COLOR.Ready     },
        { label: 'Submitted', value: 'Submitted', dotColor: INT_COLOR.Submitted },
        { label: 'Accepted',  value: 'Accepted',  dotColor: INT_COLOR.Accepted  },
        { label: 'Rejected',  value: 'Rejected',  dotColor: INT_COLOR.Rejected  },
      ],
      statusKey: 'sandata_status' as const,
      colorMap: INT_COLOR,
      clsMap: INT_CLS,
    };
  }
  if (aggregator === 'hhax') {
    return {
      label: 'HHAeXchange',
      subtitle: 'PA-DHS EVV · HHAeXchange aggregator · PDA / MA services',
      statusTabs: [
        { label: 'All',       value: '' },
        { label: 'Draft',     value: 'Draft',     dotColor: INT_COLOR.Draft     },
        { label: 'Ready',     value: 'Ready',     dotColor: INT_COLOR.Ready     },
        { label: 'Submitted', value: 'Submitted', dotColor: INT_COLOR.Submitted },
        { label: 'Accepted',  value: 'Accepted',  dotColor: INT_COLOR.Accepted  },
        { label: 'Rejected',  value: 'Rejected',  dotColor: INT_COLOR.Rejected  },
      ],
      statusKey: 'hhax_status' as const,
      colorMap: INT_COLOR,
      clsMap: INT_CLS,
    };
  }
  // Default: All Visits — filter by evv_status
  return {
    label: 'All Visits',
    subtitle: 'PA-DHS Electronic Visit Verification · ESC exception management · ODP services',
    statusTabs: [
      { label: 'All',      value: '' },
      { label: 'Pending',  value: 'Pending',  dotColor: EVV_COLOR.Pending  },
      { label: 'Verified', value: 'Verified', dotColor: EVV_COLOR.Verified },
      { label: 'Failed',   value: 'Failed',   dotColor: EVV_COLOR.Failed   },
      { label: 'Adjusted', value: 'Adjusted', dotColor: EVV_COLOR.Adjusted },
      { label: 'Exempt',   value: 'Exempt',   dotColor: EVV_COLOR.Exempt   },
    ],
    statusKey: 'evv_status' as const,
    colorMap: EVV_COLOR,
    clsMap: EVV_CLS,
  };
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; week?: string; page?: string; aggregator?: string }>;
}) {
  const { search = '', status = '', week = 'current', page: pageStr = '1', aggregator = '' } = await searchParams;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const data = await getVisits(page, PER_PAGE, week, search, status, aggregator);
  const { stats, items, total } = data;

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const startRow   = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const endRow     = Math.min(page * PER_PAGE, total);

  const breakdown = evvBreakdown(items);
  const evvTotal  = Math.max(Object.values(breakdown).reduce((a, b) => a + b, 0), 1);
  const compRate  = complianceRate(breakdown, evvTotal);

  const exceptions = items.filter((v) => v.evv_status === 'Pending' || v.evv_status === 'Failed');
  const noClock    = items.filter((v) => !v.clock_in || !v.clock_out);
  const rejected   = items.filter((v) => v.approval_status === 'Denied');

  const tabCfg = getTabConfig(aggregator);

  return (
    <ProtectedLayout>
      <AggregatorOffBanner />

      {/* ── Topbar ─────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Visits</h1>
          <p className="page-subtitle">{tabCfg.subtitle}</p>
        </div>
        <div className="top-actions">
          {search && (
            <Link href={buildPageHref('', status, week, aggregator, 1)} className="btn secondary" style={{ display: 'flex', alignItems: 'center' }}>
              Clear search: {search}
            </Link>
          )}
          <VisitPeriodSelect current={week} />
          <button className="btn secondary">Export</button>
        </div>
      </div>

      {/* ── Aggregator tabs ─────────────────────────────── */}
      <AggregatorTabs />

      {/* ── Main layout ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 16, alignItems: 'start' }}>

        <div style={{ display: 'grid', gap: 16 }}>

          {/* Visit records table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ marginBottom: 12 }}>
                <div className="card-title">Visit Records</div>
                <div className="card-subtitle">{tabCfg.subtitle} · {periodLabel(week)}</div>
              </div>
              <QueryTabs
                param="status"
                tabs={tabCfg.statusTabs}
                resetKeys={['page']}
              />
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Visit ID</th>
                    <th>Caregiver</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>In GPS</th>
                    <th>Out GPS</th>
                    <th>Hours</th>
                    <th>{aggregator === 'sandata' ? 'Sandata Status' : aggregator === 'hhax' ? 'HHAX Status' : 'EVV Status'}</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>No visit records this week</div>
                        <div style={{ fontSize: 11 }}>Check API connection or clock in to a visit</div>
                      </td>
                    </tr>
                  ) : (
                    items.map((v) => {
                      const displayStatus = aggregator === 'sandata'
                        ? (v.sandata_status ?? '—')
                        : aggregator === 'hhax'
                          ? (v.hhax_status ?? '—')
                          : v.evv_status;
                      const dotColor = tabCfg.colorMap[displayStatus] ?? '#8a9aaa';
                      const statusCls = tabCfg.clsMap[displayStatus] ?? '';
                      return (
                        <tr key={v.id}>
                          <td>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#2567a4' }}>#{String(v.id).padStart(5, '0')}</div>
                          </td>
                          <td>
                            <div className="person-cell">
                              <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#35693c', background: 'linear-gradient(135deg,#d7edd7,#9ecb9e)' }}>
                                {initials(v.employee_name)}
                              </div>
                              <div>
                                <div className="person-name">{v.employee_name}</div>
                                <div className="person-meta">{v.employee_code}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="person-cell">
                              <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#2567a4' }}>
                                {initials(v.client_name)}
                              </div>
                              <div className="person-name">{v.client_name}</div>
                            </div>
                          </td>
                          <td style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(v.service_date)}</td>
                          <td>
                            {v.clock_in
                              ? <span style={{ fontSize: 12, fontWeight: 600, color: '#35693c' }}>{v.clock_in}</span>
                              : <span style={{ fontSize: 12, color: '#d56b6b', fontWeight: 600 }}>Missing</span>
                            }
                          </td>
                          <td>
                            {v.clock_out
                              ? <span style={{ fontSize: 12, fontWeight: 600, color: '#35693c' }}>{v.clock_out}</span>
                              : <span style={{ fontSize: 12, color: '#d56b6b', fontWeight: 600 }}>Missing</span>
                            }
                          </td>
                          <td style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {v.clock_in_lat != null
                              ? <><div>{v.clock_in_lat.toFixed(4)}</div><div>{v.clock_in_lon?.toFixed(4)}</div></>
                              : <span style={{ color: '#d56b6b', fontWeight: 600 }}>Missing</span>
                            }
                          </td>
                          <td style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {v.clock_out_lat != null
                              ? <><div>{v.clock_out_lat.toFixed(4)}</div><div>{v.clock_out_lon?.toFixed(4)}</div></>
                              : <span style={{ color: '#d56b6b', fontWeight: 600 }}>Missing</span>
                            }
                          </td>
                          <td>
                            <div style={{ fontSize: 16, fontWeight: 700 }}>{v.total_hours.toFixed(1)}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>hrs</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                              <span className={`status ${statusCls}`}>{displayStatus}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                              <VisitRowActions visit={v} />
                              <VisitSubmitBtn visitId={v.id} evvStatus={v.evv_status} />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination" style={{ padding: '10px 18px' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {total === 0 ? 'No records' : `Showing ${startRow}–${endRow} of ${total} visit records`}
                {search ? ` matching "${search}"` : ''}
                {status ? ` · ${status}` : ''}
              </div>
              <div className="page-controls">
                {page > 1
                  ? <Link href={buildPageHref(search, status, week, aggregator, page - 1)} className="page-btn">‹</Link>
                  : <div className="page-btn" style={{ opacity: 0.35, cursor: 'default' }}>‹</div>}

                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p < 1 || p > totalPages) return null;
                  return (
                    <Link key={p} href={buildPageHref(search, status, week, aggregator, p)} className={`page-btn${p === page ? ' active' : ''}`}>
                      {p}
                    </Link>
                  );
                })}

                {page < totalPages
                  ? <Link href={buildPageHref(search, status, week, aggregator, page + 1)} className="page-btn">›</Link>
                  : <div className="page-btn" style={{ opacity: 0.35, cursor: 'default' }}>›</div>}
              </div>
            </div>
          </div>

          <EscCodePanel />

          {/* Sandata submission history — shown only when Sandata tab is active or All Visits */}
          {aggregator !== 'hhax' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--line-soft)' }}>
                <div className="card-title">Sandata Aggregator Submission History</div>
                <div className="card-subtitle">Recent batch submissions · accepted, rejected, and partial results</div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Transaction ID</th>
                      <th>Type</th>
                      <th>Submitted</th>
                      <th>Records</th>
                      <th>Accepted</th>
                      <th>Rejected</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SANDATA_SUBMISSIONS.map((s) => (
                      <tr key={s.id}>
                        <td><div style={{ fontSize: 11, fontWeight: 700, color: '#2567a4', fontFamily: 'monospace' }}>{s.id}</div></td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, background: '#eef5fb', color: '#2567a4', padding: '2px 8px', borderRadius: 4, border: '1px solid #c8dff0' }}>{s.type}</span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{s.submitted}</td>
                        <td style={{ fontSize: 16, fontWeight: 700 }}>{s.count}</td>
                        <td style={{ fontSize: 14, fontWeight: 700, color: '#35693c' }}>{s.accepted}</td>
                        <td style={{ fontSize: 14, fontWeight: 700, color: s.rejected > 0 ? '#d56b6b' : 'var(--muted)' }}>{s.rejected}</td>
                        <td><span className={`status ${SUB_STATUS_CLS[s.status] ?? ''}`}>{s.status}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <a href="#" className="action-link">View</a>
                            {s.rejected > 0 && <a href="#" className="action-link" style={{ color: '#d56b6b' }}>Resubmit</a>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Right sidebar ───────────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>

          {/* Compliance rate */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>EVV Compliance Rate</div>
            <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
              <div style={{ fontSize: 40, fontWeight: 700, color: compRate >= 95 ? '#35693c' : compRate >= 80 ? '#c4831e' : '#d56b6b', lineHeight: 1 }}>
                {compRate}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>This week · {evvTotal} visits</div>
            </div>
            <div style={{ height: 8, background: '#e9eef4', borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${compRate}%`, background: compRate >= 95 ? '#35693c' : compRate >= 80 ? '#c4831e' : '#d56b6b', borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              PA-DHS requires ≥95% EVV compliance
            </div>
          </div>

          {/* EVV breakdown */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>EVV Status Breakdown</div>
            <div className="evv-rows">
              {[
                { label: 'Verified',  count: breakdown.Verified,  cls: 'verified'   },
                { label: 'Adjusted',  count: breakdown.Adjusted,  cls: 'processed'  },
                { label: 'Exempt',    count: breakdown.Exempt,    cls: 'omit'       },
                { label: 'Pending',   count: breakdown.Pending,   cls: 'hold'       },
                { label: 'Failed',    count: breakdown.Failed,    cls: 'incomplete' },
              ].map(({ label, count, cls }) => (
                <div key={label} className="evv-row">
                  <div className="evv-row-label">{label}</div>
                  <div className="evv-track">
                    <div className={`evv-fill ${cls}`} style={{ width: `${Math.round((count / evvTotal) * 100)}%` }} />
                  </div>
                  <div className="evv-row-count">{count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* EVV alerts */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>EVV Alerts</div>
            <div className="alert-list">
              {exceptions.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot urgent" />
                  <div className="alert-body">
                    <div className="alert-title">{exceptions.length} EVV Exception{exceptions.length > 1 ? 's' : ''}</div>
                    <div className="alert-sub">Pending or Failed EVV validation</div>
                  </div>
                </div>
              )}
              {noClock.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot warning" />
                  <div className="alert-body">
                    <div className="alert-title">{noClock.length} Missing Clock Time{noClock.length > 1 ? 's' : ''}</div>
                    <div className="alert-sub">Cannot bill until resolved — ESC 902</div>
                  </div>
                </div>
              )}
              {rejected.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot urgent" />
                  <div className="alert-body">
                    <div className="alert-title">{rejected.length} Denied Visit{rejected.length > 1 ? 's' : ''}</div>
                    <div className="alert-sub">Billing denied — resubmission required</div>
                  </div>
                </div>
              )}
              {exceptions.length === 0 && noClock.length === 0 && rejected.length === 0 && (
                <div className="alert-item">
                  <div className="alert-dot info" />
                  <div className="alert-body">
                    <div className="alert-title">All records in good standing</div>
                    <div className="alert-sub">No EVV exceptions this week</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>This Week</div>
            <div className="quick-stats">
              {[
                ['Total Visits',   String(total)],
                ['Hours Logged',   stats.total_hours.toFixed(1)],
                ['Approved',       String(stats.approved)],
                ['EVV Exceptions', String(stats.evv_exceptions)],
              ].map(([label, value]) => (
                <div className="quick-stat" key={label}>
                  <div className="quick-stat-label">{label}</div>
                  <div className="quick-stat-value">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Aggregator connection status */}
          {aggregator !== 'hhax' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 10 }}>Sandata Connection</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { label: 'API Endpoint', value: 'api.sandata.com', status: 'ok' },
                  { label: 'Program',      value: 'PA ODP',          status: 'ok' },
                  { label: 'Payer',        value: 'PAODP',           status: 'ok' },
                  { label: 'API Version',  value: 'v1.1',            status: 'ok' },
                ].map(({ label, value, status }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'ok' ? '#35693c' : '#d56b6b', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600 }}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {aggregator === 'hhax' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 10 }}>HHAeXchange Connection</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { label: 'API Endpoint', value: 'api.hhaexchange.com', status: 'ok' },
                  { label: 'Program',      value: 'PA PDA / MA',         status: 'ok' },
                  { label: 'API Version',  value: 'v2',                  status: 'ok' },
                ].map(({ label, value, status }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'ok' ? '#35693c' : '#d56b6b', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600 }}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[['Schedule', '/schedule'], ['Timesheets', '/timesheets'], ['Care Plans', '/care-plans'], ['Billing', '/billing']].map(([l, h]) => (
                <Link key={h} href={h} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>{l}</Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
