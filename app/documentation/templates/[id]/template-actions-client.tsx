'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth-context';
import type { TemplateSummary } from '@/lib/queries/documentation';

interface Props {
  template: TemplateSummary;
}

export function TemplateActions({ template }: Props) {
  const router = useRouter();
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);

  async function doAction(action: 'publish' | 'archive' | 'duplicate') {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/documentation/templates/${template.id}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.detail ?? `${action} failed.`);
        return;
      }
      if (action === 'duplicate') {
        const data = await res.json();
        router.push(`/documentation/templates/${data.id}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {template.status === 'draft' && (
        <button
          className="btn"
          onClick={() => doAction('publish')}
          disabled={busy}
        >
          Publish
        </button>
      )}
      {template.status !== 'archived' && (
        <button
          className="btn secondary"
          onClick={() => doAction('archive')}
          disabled={busy}
        >
          Archive
        </button>
      )}
      <button
        className="btn secondary"
        onClick={() => doAction('duplicate')}
        disabled={busy}
      >
        Duplicate
      </button>
    </div>
  );
}
