import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getClients } from '@/lib/queries/clients';

export const dynamic = 'force-dynamic';

function planCls(s: string) {
  if (s === 'Up to date') return 'active';
  if (s === 'Overdue') return 'flag';
  if (s.startsWith('Review')) return 'pending';
  return '';
}

function urgencyDot(s: string) {
  if (s === 'Overdue') return 'urgent';
  if (s.startsWith('Review')) return 'warning';
  return 'info';
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export default async function CarePlansPage() {
  const data = await getClients(1, 100);
  const { items } = data;

  const overdue     = items.filter((c) => c.care_plan_status === 'Overdue');
  const dueReview   = items.filter((c) => c.care_plan_status.startsWith('Review'));
  const current     = items.filter((c) => c.care_plan_status === 'Up to date');
  const pending     = items.filter((c) => c.care_plan_status === 'Pending');

  return (
    <ProtectedLayout>

      {/* ── Topbar ─────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Care Plans</h1>
          <p className="page-subtitle">
            PA ODP waiver recipients · service authorizations · review tracking · goal progress
          </p>
        </div>
        <div className="top-actions">
          <div className="search">Search client or coordinator…</div>
          <div className="filter">All Statuses</div>
          <div className="filter">All Services</div>
          <button className="btn secondary">Export</button>
          <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 1v12M1 7h12"/>
            </svg>
            New Care Plan
          </button>
          <HeaderUser />
        </div>
      </div>

      {/* ── Main layout ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 288px', gap: 16, alignItems: 'start' }}>

        {/* ── Care plan table ─────────────────────────── */}
        <div style={{ display: 'grid', gap: 16 }}>

          {/* Overdue / urgent */}
          {overdue.length > 0 && (
            <div className="card" style={{ padding: '14px 16px', border: '1px solid var(--danger-line)', background: '#fdf4f4' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#d56b6b" strokeWidth="2">
                  <circle cx="8" cy="8" r="6.5"/><path d="M8 5v4M8 11v.5"/>
                </svg>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#944949' }}>
                  {overdue.length} Overdue Care Plan{overdue.length > 1 ? 's' : ''} — Immediate Action Required
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {overdue.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid var(--danger-line)' }}>
                    <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#944949', background: 'linear-gradient(135deg,#f8e3e3,#f0c0c0)' }}>
                      {initials(c.name)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.client_code} · {c.service_type ?? 'No service assigned'}</div>
                    </div>
                    <span className="status flag">Overdue</span>
                    <Link href={`/clients/${c.id}`} className="action-link">Update Plan</Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Care plan directory */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div className="card-title">Care Plan Directory</div>
                  <div className="card-subtitle">All clients · current plan status · service authorizations · review schedule</div>
                </div>
                <div className="filter">All Coordinators</div>
              </div>
              <div className="status-tabs">
                {['All', 'Current', 'Review Due', 'Overdue', 'Pending'].map((s) => (
                  <div key={s} className={`status-tab${s === 'All' ? ' active' : ''}`}>{s}</div>
                ))}
              </div>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Service Type</th>
                    <th>Care Coordinator</th>
                    <th>Level of Care</th>
                    <th>Last Reviewed</th>
                    <th>Next Review</th>
                    <th>Plan Status</th>
                    <th>Goals</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
                        No clients found — check API connection
                      </td>
                    </tr>
                  ) : items.map((c) => {
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="person-cell">
                            <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#2567a4' }}>
                              {initials(c.name)}
                            </div>
                            <div>
                              <div className="person-name">{c.name}</div>
                              <div className="person-meta">{c.client_code}{c.age != null ? ` · Age ${c.age}` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {c.service_type
                            ? <><div style={{ fontWeight: 600 }}>{c.service_type.split('(')[0].trim()}</div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.service_type.match(/\((.*?)\)/)?.[1]}</div></>
                            : <span style={{ color: '#c0c8d0' }}>Not assigned</span>
                          }
                        </td>
                        <td style={{ color: 'var(--muted)' }}>Not available</td>
                        <td style={{ color: 'var(--muted)' }}>Not available</td>
                        <td style={{ color: 'var(--muted)' }}>Not available</td>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>{c.care_plan_review_date ?? 'Not set'}</td>
                        <td>
                          <span className={`status ${planCls(c.care_plan_status)}`}>{c.care_plan_status}</span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>Not available</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Link href={`/clients/${c.id}`} className="action-link">View</Link>
                            <a href="#" className="action-link">Edit</a>
                            {c.care_plan_status === 'Overdue' && <a href="#" className="action-link" style={{ color: '#d56b6b' }}>Renew</a>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination" style={{ padding: '10px 18px' }}>
              <div>Showing {items.length === 0 ? 0 : 1}–{items.length} of {data.total} clients</div>
              <div className="page-controls">
                <div className="page-btn">‹</div>
                <div className="page-btn active">1</div>
                <div className="page-btn">›</div>
              </div>
            </div>
          </div>

        </div>

        {/* ── Right sidebar ───────────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>

          {/* Status summary */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Plan Status Summary</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                { label: 'Current',     count: current.length,   color: '#35693c', bg: 'var(--success-bg)',  border: 'var(--success-line)' },
                { label: 'Review Due',  count: dueReview.length, color: '#c4831e', bg: 'var(--warning-bg)', border: 'var(--warning-line)' },
                { label: 'Overdue',     count: overdue.length,   color: '#d56b6b', bg: 'var(--danger-bg)',  border: 'var(--danger-line)' },
                { label: 'Pending',     count: pending.length,   color: '#2567a4', bg: 'var(--primary-soft)', border: '#c8dff0' },
              ].map(({ label, count, color, bg, border }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color }}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming reviews */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Upcoming Reviews</div>
            <div className="alert-list">
              {dueReview.slice(0, 4).map((c) => (
                <div key={c.id} className="alert-item">
                  <div className={`alert-dot ${urgencyDot(c.care_plan_status)}`} />
                  <div className="alert-body">
                    <div className="alert-title">{c.name}</div>
                    <div className="alert-sub">{c.care_plan_status}</div>
                  </div>
                </div>
              ))}
              {overdue.slice(0, 3).map((c) => (
                <div key={c.id} className="alert-item">
                  <div className="alert-dot urgent" />
                  <div className="alert-body">
                    <div className="alert-title">{c.name}</div>
                    <div className="alert-sub">Plan overdue — renew immediately</div>
                  </div>
                </div>
              ))}
              {dueReview.length === 0 && overdue.length === 0 && (
                <div className="alert-item">
                  <div className="alert-dot info" />
                  <div className="alert-body">
                    <div className="alert-title">No upcoming reviews</div>
                    <div className="alert-sub">No reviews due in the next 30 days</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[['Clients', '/clients'], ['Visits / EVV', '/visits'], ['Documentation', '/documentation']].map(([l, h]) => (
                <Link key={h} href={h} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>{l}</Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
