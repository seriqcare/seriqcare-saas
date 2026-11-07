import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getSubmission } from '@/lib/queries/documentation';
import { SubmissionActions } from './submission-actions-client';
import type { FieldSchema, SectionSchema, TemplateSchemaBody } from '@/lib/queries/documentation';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_CLS: Record<string, string> = { draft: 'hold', submitted: 'pending', reviewed: 'active', approved: 'active' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', reviewed: 'Reviewed', approved: 'Approved' };

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderValue(field: FieldSchema, value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (field.type === 'yes_no') return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  return String(value);
}

export default async function SubmissionDetailPage({ params }: Props) {
  const { id } = await params;
  const sub = await getSubmission(Number(id));
  if (!sub) notFound();

  const sections: SectionSchema[] = sub.template_schema?.sections ?? [];

  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">{sub.template_name}</h1>
          <p className="page-subtitle">
            <span className={`status ${STATUS_CLS[sub.status] ?? ''}`} style={{ marginRight: 8 }}>
              {STATUS_LABEL[sub.status] ?? sub.status}
            </span>
            Submission #{sub.id} · v{sub.template_version_number}
          </p>
        </div>
        <div className="top-actions">
          <Link href="/documentation" className="btn secondary">← Documentation</Link>
          {sub.status === 'draft' && (
            <Link href={`/documentation/fill/${sub.template_id}?submission_id=${sub.id}`} className="btn secondary">
              Continue Editing
            </Link>
          )}
          <SubmissionActions submission={sub} />
          <HeaderUser />
        </div>
      </div>

      {/* Metadata card */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Submission detail sections */}
          {sections.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
              No schema available for this submission version.
            </div>
          ) : (
            sections.map((section, sIdx) => (
              <div key={sIdx} className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
                  {section.title}
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {section.fields
                    .filter((f) => f.is_active && f.type !== 'instruction_block')
                    .map((field, fIdx) => {
                      const compoundKey = `${section.key}.${field.key}`;
                      const rawValue = sub.values[compoundKey];
                      return (
                        <div key={fIdx} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, alignItems: 'start', paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{field.label || field.key}</div>
                            {field.help_text && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{field.help_text}</div>}
                          </div>
                          <div style={{ fontSize: 13, color: rawValue == null || rawValue === '' ? 'var(--muted)' : 'var(--text)' }}>
                            {field.type === 'long_text'
                              ? <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {renderValue(field, rawValue)}
                                </pre>
                              : renderValue(field, rawValue)
                            }
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar: meta */}
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Submission Info</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                ['Status',    STATUS_LABEL[sub.status] ?? sub.status],
                ['Template',  sub.template_name],
                ['Version',   `v${sub.template_version_number}`],
                ['Patient',   sub.patient_name ?? '—'],
                ['Staff',     sub.staff_name ?? '—'],
                ['Created',   fmtDate(sub.created_at)],
                ['Submitted', fmtDate(sub.submitted_at)],
                ['Updated',   fmtDate(sub.updated_at)],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{label}</span>
                  <span style={{ fontWeight: 600, maxWidth: 160, textAlign: 'right' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {sub.patient_id && (
                <Link href={`/clients/${sub.patient_id}`} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>
                  View Patient Record
                </Link>
              )}
              <Link href="/documentation" style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>
                All Submissions
              </Link>
              <Link href="/documentation/templates" style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)' }}>
                Templates
              </Link>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
