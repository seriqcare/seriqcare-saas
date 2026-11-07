import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getTemplates, TEMPLATE_CATEGORIES } from '@/lib/queries/documentation';
import type { TemplateSummary } from '@/lib/queries/documentation';

export const dynamic = 'force-dynamic';

const STATUS_CLS: Record<string, string> = {
  draft:     'hold',
  published: 'active',
  archived:  'flag',
};

const STATUS_LABEL: Record<string, string> = {
  draft:     'Draft',
  published: 'Published',
  archived:  'Archived',
};

function categoryLabel(cat: string | null): string {
  if (!cat) return '—';
  return TEMPLATE_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function TemplatesPage() {
  const { total, items } = await getTemplates({ take: 100 });

  const byStatus = {
    draft:     items.filter((t) => t.status === 'draft').length,
    published: items.filter((t) => t.status === 'published').length,
    archived:  items.filter((t) => t.status === 'archived').length,
  };

  return (
    <ProtectedLayout>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <h1 className="page-title">Documentation Templates</h1>
          <p className="page-subtitle">
            Build structured documentation templates · publish · manage versions
          </p>
        </div>
        <div className="top-actions">
          <Link href="/documentation" className="btn secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>← Submissions</Link>
          <Link
            href="/documentation/templates/new"
            className="btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 1v12M1 7h12" />
            </svg>
            New Template
          </Link>
          <HeaderUser />
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Draft',     count: byStatus.draft,     color: '#c4831e', bg: '#fdf6ec' },
          { label: 'Published', count: byStatus.published, color: '#35693c', bg: '#edf7ee' },
          { label: 'Archived',  count: byStatus.archived,  color: '#888',    bg: '#f5f5f5' },
        ].map(({ label, count, color, bg }) => (
          <div key={label} className="card" style={{ background: bg, border: `1px solid ${color}22`, padding: '14px 18px' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{count}</div>
            <div style={{ fontSize: 12, color, fontWeight: 600 }}>{label} Templates</div>
          </div>
        ))}
      </div>

      {/* Templates table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="card-title">All Templates</div>
            <div className="card-subtitle">{total} template{total !== 1 ? 's' : ''} in your agency</div>
          </div>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No templates yet</div>
            <div style={{ fontSize: 12, marginBottom: 16 }}>Create your first documentation template to get started.</div>
            <Link href="/documentation/templates/new" className="btn" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M7 1v12M1 7h12" />
              </svg>
              New Template
            </Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Last Updated</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t: TemplateSummary) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      {t.description && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                          {t.description}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{categoryLabel(t.category)}</td>
                    <td>
                      <span className={`status ${STATUS_CLS[t.status] ?? ''}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>v{t.current_version}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(t.updated_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        {t.status === 'draft' && (
                          <Link href={`/documentation/templates/${t.id}`} className="action-link">Edit</Link>
                        )}
                        {t.status === 'published' && (<>
                          <Link href={`/documentation/templates/${t.id}`} className="action-link">View</Link>
                          <Link href={`/documentation/templates/${t.id}?edit=1`} className="action-link">Edit</Link>
                          <Link href={`/documentation/fill/${t.id}`} className="action-link">Fill</Link>
                        </>)}
                        {t.status === 'archived' && (
                          <Link href={`/documentation/templates/${t.id}`} className="action-link" style={{ color: 'var(--muted)' }}>View</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}
