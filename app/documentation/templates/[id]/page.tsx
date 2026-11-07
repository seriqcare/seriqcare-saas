import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getTemplate } from '@/lib/queries/documentation';
import { TemplateBuilderClient } from '../new/template-builder-client';
import { TemplateActions } from './template-actions-client';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; edit?: string }>;
}

export default async function TemplateDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { version, edit } = await searchParams;
  const templateId = Number(id);
  const template = await getTemplate(templateId, version ? Number(version) : undefined);

  if (!template) notFound();

  // draft → always editable
  // published + ?edit=1 → open builder (backend will create new version on save)
  // published without edit → read-only view
  // archived → always read-only
  const isEditable = template.status === 'draft' || (template.status === 'published' && edit === '1');
  const statusLabel: Record<string, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
  const statusCls: Record<string, string>   = { draft: 'hold', published: 'active', archived: 'flag' };

  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">{template.name}</h1>
          <p className="page-subtitle">
            <span className={`status ${statusCls[template.status]}`} style={{ marginRight: 8 }}>
              {statusLabel[template.status]}
            </span>
            Version {template.current_version}
            {template.category && ` · ${template.category.replace(/_/g, ' ')}`}
          </p>
        </div>
        <div className="top-actions">
          <Link href="/documentation/templates" className="btn secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>← Templates</Link>
          {template.status === 'published' && (
            <Link href={`/documentation/fill/${template.id}`} className="btn secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Fill Form
            </Link>
          )}
          <TemplateActions template={template} />
          <HeaderUser />
        </div>
      </div>

      {template.status === 'published' && edit === '1' && (
        <div style={{ padding: '10px 14px', background: '#eef5fb', border: '1px solid #b8d4ee', borderRadius: 6, fontSize: 13, color: '#1a4f82', marginBottom: 4 }}>
          Editing a published template will create a new version (v{template.current_version + 1}). Existing submissions remain tied to their original version.
        </div>
      )}

      {isEditable ? (
        <TemplateBuilderClient mode="edit" initial={template} />
      ) : (
        <TemplateReadOnly template={template} />
      )}
    </ProtectedLayout>
  );
}

// ---------------------------------------------------------------------------
// Read-only view for published / archived templates
// ---------------------------------------------------------------------------

function TemplateReadOnly({ template }: { template: Awaited<ReturnType<typeof getTemplate>> }) {
  if (!template) return null;
  const sections = template.template_schema?.sections ?? [];

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      {template.description && (
        <div className="card" style={{ fontSize: 13, color: 'var(--muted)' }}>
          {template.description}
        </div>
      )}
      {sections.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--muted)', padding: '32px' }}>
          This template has no sections defined.
        </div>
      )}
      {sections.map((s, i) => (
        <div key={i} className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.title}</div>
          {s.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{s.description}</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {s.fields.filter((f) => f.is_active).map((f, j) => (
              <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
                  {f.required && <span style={{ color: '#d56b6b', marginLeft: 4, fontSize: 11 }}>*</span>}
                  {f.help_text && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{f.help_text}</div>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-soft)', padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                  {f.type.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
