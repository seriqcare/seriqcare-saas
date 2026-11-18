'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { submitVisit, type VisitSubmitResult } from '@/lib/queries/timesheets';

interface Props {
  visitId: number;
  evvStatus: string;
  submissionStatus?: string | null;
  submissionCount?: number;
}

export function VisitSubmitBtn({ visitId, evvStatus, submissionStatus, submissionCount = 0 }: Props) {
  const router = useRouter();
  const pending = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'attempted'>('idle');
  const [result, setResult] = useState<VisitSubmitResult | null>(null);
  const status = ['Accepted', 'Submitted', 'Pending'].includes(submissionStatus || '') ? submissionStatus : result?.status || submissionStatus;
  const hasAttempt = submissionCount > 0 || state === 'attempted'
    || Boolean(status && !['Draft', 'Ready'].includes(status));
  const rejected = ['Rejected', 'Failed', 'Error'].includes(status || '');
  const eligible = ['Verified', 'Adjusted', 'Exempt'].includes(evvStatus);
  if (!eligible && !hasAttempt) return null;

  async function handleSubmit() {
    if (pending.current || hasAttempt || !eligible) return;
    pending.current = true;
    setState('loading');
    try {
      const response = await submitVisit(visitId);
      setResult(response);
    } catch {
      setResult({ success: false, visit_id: visitId, transaction_id: '', status: 'Error', message: 'Submission result is unavailable. Check History before retrying.' });
    } finally {
      setState('attempted');
      pending.current = false;
      router.refresh();
    }
  }

  const disabled = state === 'loading' || hasAttempt;
  const label = state === 'loading' ? 'Submitting?' : status === 'Accepted' ? 'Accepted' : hasAttempt ? 'Submitted' : 'Submit';
  return <>
    <button type="button" disabled={disabled} onClick={handleSubmit}
      title={result?.message || (hasAttempt ? 'This visit already has a submission attempt. Rejected attempts can be retried from History.' : 'Submit this visit')}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? 'var(--muted)' : '#35693c', textDecoration: disabled ? 'none' : 'underline' }}>
      {label}
    </button>
    {rejected && <Link className="action-link" href="/evv?aggregator=sandata&tab=history">Retry in History</Link>}
  </>;
}
