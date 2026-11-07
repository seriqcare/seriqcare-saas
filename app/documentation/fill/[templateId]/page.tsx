import { notFound } from 'next/navigation';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getTemplateForFill, getSubmission } from '@/lib/queries/documentation';
import { FillFormClient } from './fill-form-client';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ submission_id?: string }>;
}

export default async function FillTemplatePage({ params, searchParams }: Props) {
  const { templateId } = await params;
  const { submission_id } = await searchParams;

  const [template, existingSubmission] = await Promise.all([
    getTemplateForFill(Number(templateId)),
    submission_id ? getSubmission(Number(submission_id)) : Promise.resolve(null),
  ]);

  if (!template) notFound();

  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">{template.name}</h1>
          <p className="page-subtitle">
            {template.category?.replace(/_/g, ' ')}
            {template.category ? ' · ' : ''}
            Version {template.current_version}
            {existingSubmission && (
              <span style={{ marginLeft: 8 }}>
                · Editing submission #{existingSubmission.id}
              </span>
            )}
          </p>
        </div>
        <div className="top-actions">
          <HeaderUser />
        </div>
      </div>

      <FillFormClient
        template={template}
        existingSubmission={existingSubmission ?? undefined}
      />
    </ProtectedLayout>
  );
}
