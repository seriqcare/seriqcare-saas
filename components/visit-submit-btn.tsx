'use client';
import { useState } from 'react';
import { submitVisit, type VisitSubmitResult } from '@/lib/queries/timesheets';

interface Props {
  visitId: number;
  evvStatus: string;
}

export function VisitSubmitBtn({ visitId, evvStatus }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<VisitSubmitResult | null>(null);

  // Show submit button when EVV is verified/adjusted/exempt and not yet submitted
  const SUBMITTABLE = new Set(['Verified', 'Adjusted', 'Exempt']);
  if (!SUBMITTABLE.has(evvStatus)) return null;

  async function handleSubmit() {
    setState('loading');
    const res = await submitVisit(visitId);
    setResult(res);
    setState(res.success ? 'done' : 'error');
  }

  if (state === 'loading') {
    return <span style={{ fontSize: 11, color: 'var(--muted)' }}>Submitting…</span>;
  }

  if (state === 'done' && result) {
    return (
      <span
        title={`${result.transaction_id}\n${result.message}`}
        style={{ fontSize: 11, fontWeight: 700, color: '#35693c', cursor: 'help' }}
      >
        ✓ Sent
      </span>
    );
  }

  if (state === 'error' && result) {
    return (
      <span
        title={result.message}
        style={{ fontSize: 11, fontWeight: 700, color: '#d56b6b', cursor: 'help' }}
        onClick={handleSubmit}
      >
        ✗ Retry
      </span>
    );
  }

  return (
    <button
      onClick={handleSubmit}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontSize: 12, fontWeight: 700, color: '#35693c', textDecoration: 'underline',
      }}
    >
      Submit
    </button>
  );
}
