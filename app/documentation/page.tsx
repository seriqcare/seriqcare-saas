import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getSubmissions } from '@/lib/queries/documentation';
import type { SubmissionSummary } from '@/lib/queries/documentation';

export const dynamic = 'force-dynamic';

/* ── Status config ───────────────────────────────────────── */
const STATUS_CLS: Record<string, string> = {
  approved:  'active',
  submitted: 'pending',
  draft:     'hold',
  reviewed:  'pending',
};

const STATUS_LABEL: Record<string, string> = {
  approved:  'Approved',
  submitted: 'Submitted',
  draft:     'Draft',
  reviewed:  'Reviewed',
};

function initials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default async function DocumentationPage() {
  const { total, items } = await getSubmissions({ take: 50 });

  const drafts    = items.filter((s) => s.status === 'draft');
  const submitted = items.filter((s) => s.status === 'submitted');
  const approved  = items.filter((s) => s.status === 'approved');
  const reviewed  = items.filter((s) => s.status === 'reviewed');

  return (
    <ProtectedLayout>

      {/* ── Topbar ─────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Documentation</h1>
          <p className="page-subtitle">
            Clinical notes · progress reports · incident management · audit trail · PA ODP compliance
          </p>
        </div>
        <div className="top-actions">
          <div className="search">Search notes, clients, or caregivers…</div>
          <button className="btn secondary">Export</button>
          <Link
            href="/documentation/templates"
            className="btn secondary"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            Templates
          </Link>
          <Link
            href="/documentation/templates"
            className="btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 1v12M1 7h12" />
            </svg>
            New Note
          </Link>
          <HeaderUser />
        </div>
      </div>

      {/* ── Main layout ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 288px', gap: 16, alignItems: 'start' }}>

        {/* ── Submissions table ─────────────────────────── */}
        <div style={{ display: 'grid', gap: 16 }}>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div className="card-title">Clinical Notes Directory</div>
                  <div className="card-subtitle">All note types · service documentation · incident records · supervisor notes</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div className="filter">All Caregivers</div>
                  <div className="filter">All Clients</div>
                </div>
              </div>
            </div>

            {items.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No submissions yet</div>
                <div style={{ fontSize: 12, marginBottom: 16 }}>Create a template and fill it out to see submissions here.</div>
                <Link href="/documentation/templates" className="btn" style={{ display: 'inline-flex', gap: 6 }}>
                  Go to Templates
                </Link>
              </div>
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Template</th>
                        <th>Staff</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((s: SubmissionSummary) => (
                        <tr key={s.id}>
                          <td>
                            <div className="person-cell">
                              <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#2567a4' }}>
                                {initials(s.patient_name)}
                              </div>
                              <div className="person-name">{s.patient_name ?? '—'}</div>
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{s.template_name}</span>
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>v{s.template_version_number}</div>
                          </td>
                          <td>
                            {s.staff_name ? (
                              <div className="person-cell">
                                <div className="person-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#35693c', background: 'linear-gradient(135deg,#d7edd7,#9ecb9e)' }}>
                                  {initials(s.staff_name)}
                                </div>
                                <div className="person-name">{s.staff_name}</div>
                              </div>
                            ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(s.created_at)}</td>
                          <td>
                            <span className={`status ${STATUS_CLS[s.status] ?? ''}`}>
                              {STATUS_LABEL[s.status] ?? s.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <Link href={`/documentation/submissions/${s.id}`} className="action-link">View</Link>
                              <Link href={`/documentation/fill/${s.template_id}?submission_id=${s.id}`} className="action-link">
                                {s.status === 'draft' ? 'Continue' : 'Edit'}
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pagination" style={{ padding: '10px 18px' }}>
                  <div>Showing 1–{items.length} of {total} notes</div>
                  <div className="page-controls">
                    <div className="page-btn">‹</div>
                    <div className="page-btn active">1</div>
                    <div className="page-btn">›</div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Upload / Attach document */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 14 }}>
              <div>
                <div className="card-title">Attach Supporting Document</div>
                <div className="card-subtitle">Upload PDFs, photos, or signed forms to attach to a note or client record</div>
              </div>
            </div>
            <div style={{ border: '2px dashed var(--line)', borderRadius: 8, padding: '28px 24px', textAlign: 'center', background: 'var(--surface-soft)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b0bec5" strokeWidth="1.5" style={{ marginBottom: 10 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Drop files here or click to upload</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>Supports PDF, JPG, PNG, DOCX · Max 10 MB per file</div>
              <button className="btn secondary" style={{ fontSize: 12 }}>Browse Files</button>
            </div>
          </div>
        </div>

        {/* ── Right sidebar ───────────────────────────── */}
        <div style={{ display: 'grid', gap: 14 }}>

          {/* Status breakdown */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Notes by Status</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { label: 'Approved',  count: approved.length,  color: '#35693c', bg: '#edf7ee' },
                { label: 'Submitted', count: submitted.length, color: '#2567a4', bg: '#eef5fb' },
                { label: 'Reviewed',  count: reviewed.length,  color: '#6a3fa4', bg: '#f5eeff' },
                { label: 'Draft',     count: drafts.length,    color: '#c4831e', bg: '#fdf6ec' },
              ].map(({ label, count, color, bg }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: bg, border: `1px solid ${color}25`, borderRadius: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color }}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pending items */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Pending Action</div>
            <div className="alert-list">
              {drafts.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot warning" />
                  <div className="alert-body">
                    <div className="alert-title">{drafts.length} Draft Note{drafts.length > 1 ? 's' : ''}</div>
                    <div className="alert-sub">Not yet submitted for approval</div>
                  </div>
                </div>
              )}
              {submitted.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot info" />
                  <div className="alert-body">
                    <div className="alert-title">{submitted.length} Awaiting Review</div>
                    <div className="alert-sub">Supervisor review required</div>
                  </div>
                </div>
              )}
              {drafts.length === 0 && submitted.length === 0 && (
                <div className="alert-item">
                  <div className="alert-dot info" />
                  <div className="alert-body">
                    <div className="alert-title">All notes in good standing</div>
                    <div className="alert-sub">No pending actions</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                ['Templates', '/documentation/templates'],
                ['Clients', '/clients'],
                ['Care Plans', '/care-plans'],
                ['Visits / EVV', '/visits'],
              ].map(([l, h]) => (
                <Link key={h} href={h} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>{l}</Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
