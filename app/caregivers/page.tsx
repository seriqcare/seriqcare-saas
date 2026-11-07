import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { getCaregivers, type CaregiverSummary } from '@/lib/queries/caregivers';
import { QuerySearchInput } from '@/components/query-search-input';
import { QueryTabs } from '@/components/query-tabs';

export const dynamic = 'force-dynamic';

const STATUS_CLS: Record<string, string> = {
  Active:     'active',
  'On Leave': 'pending',
  Inactive:   'hold',
};

const ROLE_ABBR: Record<string, string> = {
  'Direct Support Professional': 'DSP',
  'Home Health Aide':            'HHA',
  'Respite Provider':            'RSP',
  'Community Support Worker':    'CSW',
};

const ROLE_COLOR: Record<string, string> = {
  'Direct Support Professional': '#2567a4',
  'Home Health Aide':            '#35693c',
  'Respite Provider':            '#8a6424',
  'Community Support Worker':    '#6a3fa4',
};

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function avatarGradient(name: string) {
  const palettes = [
    ['#d7e8f6','#2567a4'],['#d7edd7','#35693c'],
    ['#f5e6d0','#8a6424'],['#e8d7f6','#6a3fa4'],
    ['#f6d7d7','#a44242'],
  ];
  return palettes[name.charCodeAt(0) % palettes.length];
}

function utilPct(hours: number, cap = 40) {
  return Math.min(100, Math.round((hours / cap) * 100));
}

function utilColor(pct: number) {
  return pct > 90 ? '#d56b6b' : pct > 75 ? '#c4831e' : '#2567a4';
}

export default async function CaregiversPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const { status = '', search = '' } = await searchParams;
  const data = await getCaregivers(1, 20, status, search);
  const { stats, items, total } = data;

  return (
    <ProtectedLayout>

      {/* ── Topbar ─────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Caregivers</h1>
          <p className="page-subtitle">
            Direct support professionals · weekly assignments · EVV compliance · utilization
          </p>
        </div>
        <div className="top-actions">
          <QuerySearchInput placeholder="Search by name, ID, or role..." />
          <button className="btn secondary">Export</button>
          <Link
            href="/caregivers/new"
            className="btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 1v12M1 7h12"/>
            </svg>
            Add Caregiver
          </Link>
        </div>
      </div>

      {/* ── Main layout ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 296px', gap: 16, alignItems: 'start' }}>

        {/* Table card */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div className="card-title">Caregiver Directory</div>
                <div className="card-subtitle">Weekly visit assignments, logged hours, and EVV compliance per staff member</div>
              </div>
            </div>
            <QueryTabs
              param="status"
              tabs={[
                { label: 'All', value: '' },
                { label: 'Active', value: 'Active' },
                { label: 'On Leave', value: 'On Leave' },
                { label: 'Inactive', value: 'Inactive' },
              ]}
            />
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Clients</th>
                  <th>Visits</th>
                  <th>Hours</th>
                  <th>Utilization</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>No caregivers found</div>
                      <div style={{ fontSize: 11 }}>Check API connection or add your first caregiver</div>
                    </td>
                  </tr>
                ) : (
                  items.map((c) => {
                    const [bg, fg] = avatarGradient(c.name);
                    const pct = utilPct(c.hours_this_week);
                    const uColor = utilColor(pct);
                    const roleColor = ROLE_COLOR[c.role] ?? 'var(--muted)';
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/caregivers/${c.id}`} style={{ textDecoration: 'none' }}>
                            <div className="person-cell">
                              <div
                                className="person-avatar"
                                style={{ background: `linear-gradient(135deg,${bg},${bg}bb)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: fg }}
                              >
                                {initials(c.name)}
                              </div>
                              <div>
                                <div className="person-name" style={{ color: 'var(--primary)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{c.name}</div>
                                <div className="person-meta">
                                  {c.employee_code}
                                  {c.hire_date ? ` · Since ${c.hire_date.slice(0, 7)}` : ''}
                                </div>
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 700, color: roleColor, background: roleColor + '18', padding: '3px 8px', borderRadius: 4, border: `1px solid ${roleColor}30` }}>
                            {ROLE_ABBR[c.role] ?? c.role.slice(0, 3).toUpperCase()}
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.role}</div>
                        </td>
                        <td>
                          <span className={`status ${STATUS_CLS[c.status] ?? ''}`}>{c.status}</span>
                        </td>
                        <td>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{c.clients_assigned}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>assigned</div>
                        </td>
                        <td>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{c.visits_this_week}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>this week</div>
                        </td>
                        <td>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{c.hours_this_week.toFixed(1)}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>hrs logged</div>
                        </td>
                        <td style={{ minWidth: 110 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ flex: 1, height: 8, background: '#e9eef4', borderRadius: 99, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: uColor, borderRadius: 99 }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: uColor, minWidth: 30 }}>{pct}%</span>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>of 40h cap</div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <Link href={`/schedule?caregiver=${c.id}`} className="action-link">Schedule</Link>
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
            <div>Showing 1–{items.length} of {total} caregivers</div>
            <div className="page-controls">
              <div className="page-btn">‹</div>
              <div className="page-btn active">1</div>
              <div className="page-btn">2</div>
              <div className="page-btn">›</div>
            </div>
          </div>
        </div>

        {/* ── Right sidebar ───────────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>

          {/* Summary stats */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Staff Summary</div>
            <div className="quick-stats">
              {[
                ['Active Staff',         String(stats.active)],
                ['On Leave',             String(stats.on_leave)],
                ['Inactive',             String(stats.inactive)],
                ['Total Hrs This Week',  stats.total_hours_this_week.toFixed(0)],
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
              {[['View Schedule', '/schedule'], ['Timesheets', '/timesheets'], ['Visits / EVV', '/visits']].map(([label, href]) => (
                <Link key={href} href={href} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
