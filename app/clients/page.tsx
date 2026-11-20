import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { getClients } from '@/lib/queries/clients';
import { QuerySearchInput } from '@/components/query-search-input';
import { CLIENT_QUICK_ACTIONS } from '@/lib/client-quick-actions';

export const dynamic = 'force-dynamic';

const STATUS_CLS: Record<string, string> = {
  Active:     'active',
  Pending:    'pending',
  'On Hold':  'hold',
  Discharged: 'hold',
};

function carePlanCls(s: string) {
  if (s === 'Current' || s === 'Up to date') return 'active';
  if (s === 'Overdue') return 'flag';
  if (s.startsWith('Review') || s.startsWith('Review in')) return 'pending';
  return '';
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const { search = '', page: pageParam = '1' } = await searchParams;
  const page = Math.max(1, Math.floor(Number(pageParam) || 1));
  const data = await getClients(page, 20, '', search);
  const { stats, items, total } = data;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const pageHref = (value: number) => `/clients?${new URLSearchParams({ ...(search ? { search } : {}), page: String(value) })}`;

  return (
    <ProtectedLayout>
      {/* ── Topbar ─────────────────────────────────────── */}
      <div className="topbar overview-topbar">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">
            PA ODP waiver recipients · EVV authorizations · care plan management
          </p>
        </div>
        <div className="top-actions">
          <QuerySearchInput placeholder="Search name, caregiver, or MA ID..." />
          <Link href="/clients/new" prefetch={true} className="btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 1v12M1 7h12"/>
            </svg>
            Add Client
          </Link>
        </div>
      </div>

      {/* ── Main content ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 296px', gap: 16, alignItems: 'start' }}>

        {/* Client directory table */}
        <div className="card client-directory">
          <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ marginBottom: 12 }}>
              <div>
                <div className="card-title">Client Directory</div>
                <div className="card-subtitle">ODP waiver recipients — Medicaid ID, authorized services, caregiver assignments</div>
              </div>
            </div>
          </div>

          <div className="table-scroll client-directory-content" role="region" aria-label="Client directory" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Created Date</th>
                  <th>Status</th>
                  <th>Service Type</th>
                  <th>Primary Caregiver</th>
                  <th>Next Visit</th>
                  <th>Care Plan</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '36px 0' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {search ? `No clients matching "${search}"` : 'No clients found'}
                      </div>
                      <div style={{ fontSize: 11 }}>Check API connection or add your first client</div>
                    </td>
                  </tr>
                ) : (
                  items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/clients/${c.id}`} style={{ textDecoration: 'none' }}>
                          <div className="person-cell">
                            <div
                              className="person-avatar"
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#2567a4' }}
                            >
                              {initials(c.name)}
                            </div>
                            <div>
                              <div className="person-name" style={{ color: 'var(--primary)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{c.name}</div>
                              <div className="person-meta">
                                {c.client_code}
                                {c.age != null ? ` · Age ${c.age}` : ''}
                                {c.city ? ` · ${c.city}, ${c.state ?? 'PA'}` : ''}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                      <td>
                        <span className={`status ${STATUS_CLS[c.status] ?? ''}`}>{c.status}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {c.service_type
                          ? <><div style={{ fontWeight: 600 }}>{c.service_type.split('(')[0].trim()}</div><div style={{ color: 'var(--muted)', fontSize: 11 }}>{c.service_type.match(/\((.*?)\)/)?.[1] ?? ''}</div></>
                          : <span style={{ color: '#c0c8d0' }}>—</span>
                        }
                      </td>
                      <td>
                        {c.primary_caregiver
                          ? <div className="person-cell" style={{ gap: 8 }}>
                              <div className="person-avatar" style={{ width: 26, height: 26, fontSize: 10, fontWeight: 700, color: '#35693c', background: 'linear-gradient(135deg,#d7edd7,#9ecb9e)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {initials(c.primary_caregiver)}
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{c.primary_caregiver}</div>
                            </div>
                          : <span style={{ fontSize: 12, color: '#c4831e', fontWeight: 600 }}>Unassigned</span>
                        }
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {c.next_visit ? <>{c.next_visit}</> : <span style={{ color: '#c0c8d0' }}>Awaiting schedule</span>}
                      </td>
                      <td>
                        <span className={`status ${carePlanCls(c.care_plan_status)}`}>{c.care_plan_status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination" style={{ padding: '10px 18px' }}>
            <div>Showing {items.length ? (page - 1) * 20 + 1 : 0}–{items.length ? (page - 1) * 20 + items.length : 0} of {total} clients{search ? ` matching "${search}"` : ''}</div>
            <div className="page-controls">
              {page > 1 && <Link className="page-btn" href={pageHref(page - 1)} aria-label="Previous page">Previous</Link>}
              <span className="page-btn active" aria-current="page">{page}</span>
              {page < totalPages && <Link className="page-btn" href={pageHref(page + 1)} aria-label="Next page">Next</Link>}
            </div>
          </div>
        </div>

        {/* ── Right sidebar panel ─────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>

          {/* At a Glance — main KPIs */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>At a Glance</div>
            <div className="quick-stats">
              {[
                ['Total Clients',       String(stats.total_clients)],
                ['Active Care Plans',   String(stats.active_care_plans)],
                ['Assigned Caregivers', String(stats.assigned_caregivers)],
                ['Documentation Flags', String(stats.doc_flags)],
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
              {CLIENT_QUICK_ACTIONS.map(({ label, href }) => (
                <Link key={href} href={href} prefetch={href === '/clients/new' ? true : undefined} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>
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
