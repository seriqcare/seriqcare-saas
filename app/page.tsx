import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getDashboardMetrics, type DashboardMetrics } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

/* ── Helpers ──────────────────────────────────────── */
function fmt(n: number) { return n.toLocaleString('en-US'); }
function fmtHours(n: number) { return n.toFixed(0); }

function buildAlerts(m: DashboardMetrics) {
  const alerts: { dot: string; title: string; sub: string }[] = [];
  if (m.urgentExceptions > 0)
    alerts.push({ dot: 'urgent', title: `${m.urgentExceptions} Urgent EVV Exception${m.urgentExceptions > 1 ? 's' : ''}`, sub: 'Require immediate review before aggregator submission' });
  if (m.rejectedSubmissions > 0)
    alerts.push({ dot: 'urgent', title: `${m.rejectedSubmissions} Rejected Aggregator Submission${m.rejectedSubmissions > 1 ? 's' : ''}`, sub: 'Sandata returned ESC errors — resubmission needed' });
  if (m.evvIncomplete > 0)
    alerts.push({ dot: 'warning', title: `${m.evvIncomplete} Incomplete EVV Record${m.evvIncomplete > 1 ? 's' : ''}`, sub: 'Missing GPS, clock-in, or clock-out data for billing' });
  if (m.carePlansExpiringSoon > 0)
    alerts.push({ dot: 'warning', title: `${m.carePlansExpiringSoon} Care Plan${m.carePlansExpiringSoon > 1 ? 's' : ''} Expiring Soon`, sub: 'Authorization renewal required before service continues' });
  if (m.pendingSubmissions > 0)
    alerts.push({ dot: 'info', title: `${m.pendingSubmissions} Visits Pending Sandata Submission`, sub: 'Ready to be submitted to the aggregator' });
  if (m.openShifts > 0)
    alerts.push({ dot: 'info', title: `${m.openShifts} Open Shift${m.openShifts > 1 ? 's' : ''} This Week`, sub: 'Coverage needed — assign caregivers to avoid gaps' });
  if (alerts.length === 0)
    alerts.push({ dot: 'info', title: 'All systems normal', sub: 'No active compliance alerts at this time' });
  return alerts;
}

/* Static caregiver utilization (placeholder — Phase 6 will make this live) */
const UTIL_DATA = [
  { name: 'Sarah Mills',    pct: 92 },
  { name: 'Linda Brooks',   pct: 78 },
  { name: 'Rachel Dunn',    pct: 85 },
  { name: 'Angela Reese',   pct: 64 },
  { name: 'Natalie Ford',   pct: 71 },
];

export default async function DashboardPage() {
  const m = await getDashboardMetrics();

  /* Activity chart — normalise bar heights */
  const maxCount = Math.max(...m.visitsByDay.map((d) => d.count), 1);

  /* EVV breakdown total */
  const evvTotal = m.evvProcessed + m.evvVerified + m.evvIncomplete + m.evvOmit || 1;

  const alerts = buildAlerts(m);

  return (
    <ProtectedLayout>
      {/* ── Topbar ─────────────────────────────────── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            PA ODP home-care operations · EVV compliance · Sandata aggregator
          </p>
        </div>
        <div className="top-actions">
          <div className="filter">This Week</div>
          <button className="btn secondary">Export</button>
          <HeaderUser />
        </div>
      </div>

      {/* ── Row 1 — KPI cards ──────────────────────── */}
      <section className="summary-row" style={{ marginBottom: 14 }}>
        <div className="summary-card">
          <div className="summary-label">Active Clients</div>
          <div className="summary-sub-label">Auths Expiring</div>
          <div className="summary-value">{fmt(m.activeClients)}</div>
          <div className="summary-sub-value">{m.carePlansExpiringSoon}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Visits This Week</div>
          <div className="summary-sub-label">Open Shifts</div>
          <div className="summary-value">{fmt(m.scheduledVisitsThisWeek)}</div>
          <div className="summary-sub-value">{m.openShifts}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Caregiver Hours</div>
          <div className="summary-sub-label">Pending Approval</div>
          <div className="summary-value">{fmtHours(m.totalHoursThisWeek)}</div>
          <div className="summary-sub-value">{m.pendingApproval}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">EVV Exceptions</div>
          <div className="summary-sub-label">Urgent</div>
          <div className="summary-value">{m.evvExceptions}</div>
          <div className="summary-sub-value" style={{ color: m.urgentExceptions > 0 ? '#d56b6b' : undefined }}>
            {m.urgentExceptions}
          </div>
        </div>
      </section>

      {/* ── Row 2 — Activity chart + Priority queue ── */}
      <div className="dash-row wide-left">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Visit Activity — Last 14 Days</div>
              <div className="card-subtitle">Daily visit counts from EVV records</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {m.visitsByDay.length > 0
                ? `${m.visitsByDay[0].date} – ${m.visitsByDay[m.visitsByDay.length - 1].date}`
                : 'No data'}
            </div>
          </div>

          {m.visitsByDay.length === 0 ? (
            <div className="coming-soon-wrap">
              <div className="coming-soon-label">No visit activity data</div>
              <div className="coming-soon-sub">Connect API to see 14-day trend</div>
            </div>
          ) : (
            <div className="activity-bars">
              {m.visitsByDay.map((d, i) => {
                const isToday = i === m.visitsByDay.length - 1;
                const h = Math.max(Math.round((d.count / maxCount) * 100), 4);
                const label = d.date.slice(5); // MM-DD
                return (
                  <div key={d.date} className="activity-bar-wrap">
                    <div
                      className={`activity-bar${isToday ? ' today' : ''}`}
                      style={{ height: `${h}%` }}
                      title={`${d.date}: ${d.count} visits, ${d.hours.toFixed(1)}h`}
                    />
                    <div className="activity-label">{label}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Priority Queue</div>
              <div className="card-subtitle">Operational items requiring attention today</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {m.priorityQueue.length === 0 ? (
              <div className="coming-soon-wrap">
                <div className="coming-soon-label">No priority items</div>
                <div className="coming-soon-sub">Queue is clear</div>
              </div>
            ) : (
              m.priorityQueue.map((item, i) => (
                <div key={i} className="priority-item">
                  <div>
                    <div className="priority-title">{item.title}</div>
                    <div className="priority-sub">{item.sub}</div>
                  </div>
                  <span className={`status-pill${item.type === 'urgent' ? ' urgent' : item.type === 'warning' ? ' warning' : ''}`}>
                    {item.type === 'urgent' ? 'Urgent' : item.type === 'warning' ? 'Review' : 'Open'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Row 3 — EVV breakdown + Compliance alerts ── */}
      <div className="dash-row">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">EVV Status Breakdown</div>
              <div className="card-subtitle">Visit records by aggregator verification status</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{evvTotal - 1 > 0 ? `${evvTotal} total` : ''}</div>
          </div>
          <div className="evv-rows">
            {[
              { label: 'Processed',  count: m.evvProcessed,  cls: 'processed' },
              { label: 'Verified',   count: m.evvVerified,   cls: 'verified' },
              { label: 'Incomplete', count: m.evvIncomplete, cls: 'incomplete' },
              { label: 'Omit',       count: m.evvOmit,       cls: 'omit' },
            ].map(({ label, count, cls }) => (
              <div key={label} className="evv-row">
                <div className="evv-row-label">{label}</div>
                <div className="evv-track">
                  <div
                    className={`evv-fill ${cls}`}
                    style={{ width: `${Math.round((count / evvTotal) * 100)}%` }}
                  />
                </div>
                <div className="evv-row-count">{count}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="note-item">
              <div className="note-title">Pending Submission</div>
              <div className="note-sub">{m.pendingSubmissions} visits ready for Sandata</div>
            </div>
            <div className="note-item">
              <div className="note-title">Rejected</div>
              <div className="note-sub" style={{ color: m.rejectedSubmissions > 0 ? '#d56b6b' : undefined }}>
                {m.rejectedSubmissions} returned with ESC errors
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Compliance Alerts</div>
              <div className="card-subtitle">PA-DHS EVV, authorizations, and scheduling</div>
            </div>
          </div>
          <div className="alert-list">
            {alerts.map((a, i) => (
              <div key={i} className="alert-item">
                <div className={`alert-dot ${a.dot}`} />
                <div className="alert-body">
                  <div className="alert-title">{a.title}</div>
                  <div className="alert-sub">{a.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 4 — Revenue pipeline (placeholder) + Caregiver utilization ── */}
      <div className="dash-row">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Revenue Pipeline</div>
              <div className="card-subtitle">Billing, claims, and payer reimbursements</div>
            </div>
          </div>
          <div className="coming-soon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b0bec5" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
              <path d="M6 15h4M14 15h2" />
            </svg>
            <div className="coming-soon-label">Coming in Phase 6</div>
            <div className="coming-soon-sub">Billing · Claims · MA reimbursements · AR aging</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Caregiver Utilization</div>
              <div className="card-subtitle">Weekly scheduled hours vs. capacity</div>
            </div>
          </div>
          <div className="util-rows">
            {UTIL_DATA.map(({ name, pct }) => (
              <div key={name} className="util-row">
                <div className="util-name">{name}</div>
                <div className="util-track">
                  <div className="util-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="util-pct">{pct}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
