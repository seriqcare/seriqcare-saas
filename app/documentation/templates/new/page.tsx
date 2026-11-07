import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { TemplateBuilderClient } from './template-builder-client';

export const dynamic = 'force-dynamic';

export default function NewTemplatePage() {
  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">New Template</h1>
          <p className="page-subtitle">Design a structured documentation template for your agency</p>
        </div>
        <div className="top-actions">
          <HeaderUser />
        </div>
      </div>
      <TemplateBuilderClient mode="create" />
    </ProtectedLayout>
  );
}
