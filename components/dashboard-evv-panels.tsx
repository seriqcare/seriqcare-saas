'use client';

import { useAuth } from '@/components/auth-context';
import type { DashboardMetrics } from '@/lib/queries/dashboard';

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

export function DashboardEvvPanels({ metrics: m }: { metrics: DashboardMetrics }) {
  const { user, isLoading } = useAuth();
  if (isLoading || !user || user.agency_tier === 'core') return null;

  const total = m.evvProcessed + m.evvVerified + m.evvIncomplete + m.evvOmit;
  const alerts = buildAlerts(m);

  return (
    <div className="dash-row">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">EVV Status Breakdown</div>
            <div className="card-subtitle">Visit records by aggregator verification status</div>
          </div>
          {total > 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{total} total</div>}
        </div>
            <div className="evv-rows">
              {[
                { label: 'Processed', count: m.evvProcessed, cls: 'processed' },
                { label: 'Verified', count: m.evvVerified, cls: 'verified' },
                { label: 'Incomplete', count: m.evvIncomplete, cls: 'incomplete' },
                { label: 'Omit', count: m.evvOmit, cls: 'omit' },
              ].map(({ label, count, cls }) => (
                <div key={label} className="evv-row">
                  <div className="evv-row-label">{label}</div>
                  <div className="evv-track">
                    <div className={`evv-fill ${cls}`} style={{ width: `${Math.round((count / (total || 1)) * 100)}%` }} />
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
  );
}
