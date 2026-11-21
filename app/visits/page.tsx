import Link from 'next/link';
import styles from './visits.module.css';
import { ProtectedLayout } from '@/components/protected-layout';
import { getVisits } from '@/lib/queries/timesheets';
import { LiveVisitRefresh } from '@/components/live-visit-refresh';
import { QueryTabs } from '@/components/query-tabs';
import { VisitPeriodSelect } from '@/components/visit-period-select';
import { EscCodePanel } from '@/components/esc-code-panel';
import { VisitRecordActions } from '@/components/visit-record-actions';
import { AggregatorOffBanner } from '@/components/aggregator-off-banner';
import { AggregatorTabs } from '@/components/aggregator-tabs';
import { AggregatorSubmissionHistory } from '@/components/aggregator-submission-history';

export const dynamic = 'force-dynamic';

const PER_PAGE = 4;

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

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function periodLabel(week: string) {
  if (week === 'last2') return 'Last 2 Weeks';
  if (week === 'last4') return 'Last 4 Weeks';
  return 'This Week';
}

function buildPageHref(search: string, status: string, week: string, aggregator: string, page: number, historyPage = 1) {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (status) p.set('status', status);
  if (week !== 'current') p.set('week', week);
  if (aggregator) p.set('aggregator', aggregator);
  if (page > 1) p.set('page', String(page));
  if (historyPage > 1) p.set('historyPage', String(historyPage));
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
  searchParams: Promise<{ search?: string; status?: string; week?: string; page?: string; aggregator?: string; historyPage?: string }>;
}) {
  const { search = '', status = '', week = 'current', page: pageStr = '1', aggregator = '', historyPage: historyPageStr = '1' } = await searchParams;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const historyPage = Math.max(1, parseInt(historyPageStr, 10) || 1);
  const historyQuery = { ...(search ? { search } : {}), ...(status ? { status } : {}), week, ...(aggregator ? { aggregator } : {}), page: String(page) };
  const data = await getVisits(page, PER_PAGE, week, search, status, aggregator);
  const { stats, items, total } = data;

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const startRow   = items.length === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const endRow     = items.length === 0 ? 0 : (page - 1) * PER_PAGE + items.length;

  const summary = data.summary;
  const compRate = summary && summary.due > 0 ? Math.round(summary.verified_due / summary.due * 100) : null;
  const rateColor = compRate == null ? '#8a9aaa' : compRate === 100 ? '#35693c' : '#c4831e';

  const tabCfg = getTabConfig(aggregator);
  const sidebarContent = (<>


          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Visit Verification Rate</div>
            <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
              <div style={{ fontSize: 40, fontWeight: 700, color: rateColor, lineHeight: 1 }}>{compRate == null ? '\u2014' : `${compRate}%`}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{summary?.verified_due ?? 0} / {summary?.due ?? 0} visits verified</div>
            </div>
            <div style={{ height: 8, background: '#e9eef4', borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${compRate ?? 0}%`, background: rateColor, borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.6 }}>
              Active and exempt visits excluded.
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

          {/* Quick links */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[['Schedule', '/schedule'], ['Timesheets', '/timesheets'], ['Care Plans', '/care-plans'], ['Billing', '/billing']].map(([l, h]) => (
                <Link key={h} href={h} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>{l}</Link>
              ))}
            </div>
          </div>
  </>);

  return (
    <ProtectedLayout className={styles.workspace}>
      <LiveVisitRefresh />
      <AggregatorOffBanner />

      {/* ── Topbar ─────────────────────────────────────── */}
      <div className={`topbar ${styles.topbar}`}>
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
          <AggregatorTabs compact />
          <details className={styles.summaryMenu}>
            <summary>Visit summary</summary>
            <div className={styles.summaryPanel}>{sidebarContent}</div>
          </details>
        </div>
      </div>

      {/* ── Aggregator tabs ─────────────────────────────── */}

      {/* ── Main layout ────────────────────────────────── */}
      <div className={styles.layout}>

        <div className={styles.records}>

          {/* Visit records table */}
          <div className={`card ${styles.visitRecordsCard}`} style={{ padding: 0, overflow: 'hidden' }}>
            <div className={styles.visitRecordsHeader} style={{ padding: '10px 12px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ marginBottom: 8 }}>
                <div className="card-title">Visit Records</div>
                <div className="card-subtitle">{tabCfg.subtitle} · {periodLabel(week)}</div>
              </div>
              <QueryTabs
                param="status"
                tabs={tabCfg.statusTabs}
                resetKeys={['page']}
              />
            </div>

            <div className={`table-scroll ${styles.visitTableBody}`}>
              <table>
                <colgroup>{[15, 19, 19, 16, 7, 15, 9].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead>
                  <tr>
                    <th>Visit</th>
                    <th>Client</th>
                    <th>Caregiver</th>
                    <th>Time</th>
                    <th>Hours</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>No visit records this week</div>
                        <div style={{ fontSize: 11 }}>Check API connection or clock in to a visit</div>
                      </td>
                    </tr>
                  ) : (
                    items.map((v) => {
                      const submissionStatus = (aggregator === 'hhax' ? v.hhax_status : v.sandata_status) || 'Not submitted';
                      const submissionLabel = aggregator === 'hhax' ? 'HHAeXchange' : 'Sandata';
                      const gpsWarning = v.evv_status !== 'Exempt' && (
                        (!!v.clock_in && (v.clock_in_lat == null || v.clock_in_lon == null)) ||
                        (!!v.clock_out && (v.clock_out_lat == null || v.clock_out_lon == null)));
                      return (
                        <tr key={v.id}>
                          <td>
                            <div className={styles.visitId}>#{String(v.id).padStart(5, '0')}</div>
                            <div className={styles.visitDate}>{fmtDate(v.service_date)}</div>
                          </td>
                          <td>
                            <div className="person-cell">
                              <div className="person-avatar" aria-hidden="true">{initials(v.client_name)}</div>
                              <div className={styles.visitName} title={v.client_name}>{v.client_name}</div>
                            </div>
                          </td>
                          <td>
                            <div className="person-cell">
                              <div className={`person-avatar ${styles.caregiverAvatar}`} aria-hidden="true">{initials(v.employee_name)}</div>
                              <div className={styles.visitName} title={v.employee_name}>{v.employee_name}</div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.visitTimes}>
                              <div><span>In</span><strong>{v.clock_in || 'Missing'}</strong></div>
                              <div><span>Out</span><strong className={!v.clock_out && v.in_progress ? styles.activeTime : undefined}>{v.clock_out || (v.in_progress ? 'In progress' : 'Missing')}</strong></div>
                            </div>
                          </td>
                          <td className={styles.visitHours}>{v.total_hours.toFixed(1)}</td>
                          <td>
                            <div className={styles.visitStatuses}>
                              <div className={styles.evvStatusLine}>
                                <span className={`status ${EVV_CLS[v.evv_status] || ''}`}>{v.evv_status}</span>
                                {gpsWarning && <span className={styles.gpsWarning} role="img" aria-label="GPS missing: open View for location details" title="GPS missing. Open View for location details.">
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 1.5l6.5 12h-13L8 1.5zM8 5v4M8 11v1" /></svg>
                                </span>}
                              </div>
                              <span className={styles.submissionStatus} title={`${submissionLabel}: ${submissionStatus}`}>{submissionLabel}: {submissionStatus}</span>
                            </div>
                          </td>
                          <td><VisitRecordActions visit={v} aggregator={aggregator} /></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className={`pagination ${styles.tableFooter}`} style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {total === 0 ? 'No records' : `Showing ${startRow}–${endRow} of ${total} visit records`}
                {search ? ` matching "${search}"` : ''}
                {status ? ` · ${status}` : ''}
              </div>
              <div className="page-controls">
                {page > 1
                  ? <Link href={buildPageHref(search, status, week, aggregator, page - 1, historyPage)} className="page-btn" aria-label="Previous visits page">‹</Link>
                  : <div className="page-btn" aria-disabled="true" style={{ opacity: 0.35, cursor: 'default' }}>‹</div>}

                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p < 1 || p > totalPages) return null;
                  return (
                    <Link key={p} href={buildPageHref(search, status, week, aggregator, p, historyPage)} className={`page-btn${p === page ? ' active' : ''}`} aria-current={p === page ? 'page' : undefined}>
                      {p}
                    </Link>
                  );
                })}

                {page < totalPages
                  ? <Link href={buildPageHref(search, status, week, aggregator, page + 1, historyPage)} className="page-btn" aria-label="Next visits page">›</Link>
                  : <div className="page-btn" aria-disabled="true" style={{ opacity: 0.35, cursor: 'default' }}>›</div>}
              </div>
            </div>
          </div>

          <EscCodePanel />

          {/* Sandata submission history — shown only when Sandata tab is active or All Visits */}
          {aggregator !== 'hhax' && <AggregatorSubmissionHistory page={historyPage} query={historyQuery} />}
        </div>

        {/* ── Right sidebar ───────────────────────────── */}
        <aside className={styles.sidebar} aria-label="Visit summary">{sidebarContent}</aside>
      </div>
    </ProtectedLayout>
  );
}
