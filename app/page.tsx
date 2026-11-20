import { AuthorizationTracker } from '@/components/authorization-tracker';
import { ProtectedLayout } from '@/components/protected-layout';
import { DashboardEvvPanels } from '@/components/dashboard-evv-panels';
import { getCaregiverUtilization, getDashboardAuthorizations, getDashboardMetrics } from '@/lib/queries/dashboard';
import styles from './dashboard.module.css';
import { LiveVisitRefresh } from '@/components/live-visit-refresh';
import fitted from '@/components/fitted-page.module.css';

export const dynamic = 'force-dynamic';

/* ── Helpers ──────────────────────────────────────── */
function fmt(n: number | null | undefined) { return (n ?? 0).toLocaleString('en-US'); }
function fmtHours(n: number | null | undefined) { return (n ?? 0).toFixed(0); }

export default async function DashboardPage() {
  const [m, utilizationResult, authorizationResult] = await Promise.all([
    getDashboardMetrics(),
    getCaregiverUtilization().then(
      data => ({ data, error: null }),
      error => ({ data: null, error: error instanceof Error ? error.message : 'Unable to load caregiver utilization' }),
    ),
    getDashboardAuthorizations().then(
      data => ({ data, error: null }),
      error => ({ data: null, error: error instanceof Error ? error.message : 'Unable to load authorizations' }),
    ),
  ]);

  /* Activity chart — normalise bar heights */
  const maxCount = Math.max(...m.visitsByDay.map((d) => d.count), 1);

  return (
    <ProtectedLayout className={`${fitted.shell} ${styles.dashboard}`}>
      <LiveVisitRefresh />
      {/* ── Topbar ─────────────────────────────────── */}
      <div className="topbar overview-topbar">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Home-care operations
          </p>
        </div>
        <div className="top-actions">
          <div className="filter">This Week</div>
        </div>
      </div>

      {/* ── Row 1 — KPI cards ──────────────────────── */}
      <section className="summary-row" style={{ marginBottom: 14 }}>
        <div className="summary-card">
          <div className="summary-label">Active Clients</div>
          <div className="summary-sub-label">New this month</div>
          <div className="summary-value">{fmt(m.activeClients)}</div>
          <div className="summary-sub-value">{m.newClientsThisMonth ?? 0}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Visits This Week</div>
          <div className="summary-sub-label">Open Shifts</div>
          <div className="summary-value">{fmt(m.scheduledVisitsThisWeek)}</div>
          <div className="summary-sub-value">{m.openShifts ?? 0}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Caregiver Hours</div>
          <div className="summary-sub-label">Pending Approval</div>
          <div className="summary-value">{fmtHours(m.totalHoursThisWeek)}</div>
          <div className="summary-sub-value">{m.pendingApproval ?? 0}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">EVV Exceptions</div>
          <div className="summary-sub-label">Urgent</div>
          <div className="summary-value">{m.evvExceptions}</div>
          <div className="summary-sub-value" style={{ color: m.urgentExceptions > 0 ? '#d56b6b' : undefined }}>
            {m.urgentExceptions ?? 0}
          </div>
        </div>
      </section>

      {/* ── Row 2 — Activity chart + Priority queue ── */}
      <div className={styles.panels}>
        <div className={`card ${styles.activity}`}>
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
      {/* ── Row 3 — Revenue pipeline (placeholder) + Caregiver utilization ── */}
        <AuthorizationTracker items={authorizationResult.data ?? []} error={authorizationResult.error} />

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Caregiver Utilization</div>
              <div className="card-subtitle">Scheduled hours this week vs. 40-hour capacity</div>
            </div>
          </div>
          {utilizationResult.error ? (
            <div role="alert">{utilizationResult.error}</div>
          ) : utilizationResult.data?.length === 0 ? (
            <div className="coming-soon-wrap">No active caregivers in this agency.</div>
          ) : (
          <div className="util-rows">
            {utilizationResult.data?.map(({ employee_id, name, scheduled_hours, utilization_pct }) => (
              <div key={employee_id} className="util-row" title={`${scheduled_hours} scheduled hours`}>
                <div className="util-name">{name}</div>
                <div className="util-track">
                  <div className="util-fill" style={{ width: `${Math.min(utilization_pct, 100)}%` }} />
                </div>
                <div className="util-pct">{utilization_pct}%</div>
              </div>
            ))}
          </div>
          )}
        </div>
        <DashboardEvvPanels metrics={m} embedded />
      </div>
    </ProtectedLayout>
  );
}
