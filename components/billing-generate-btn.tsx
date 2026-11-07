'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateClaim, type BillingClaimResponse } from '@/lib/queries/billing';

interface Props {
  visitId: number;
  billingStatus: string;
  payer?: string;
}

export function BillingGenerateBtn({ visitId, billingStatus, payer = 'sandata' }: Props) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<BillingClaimResponse | null>(null);
  const [errMsg, setErrMsg] = useState('');

  // Only show for Ready-to-bill visits that have no claim yet
  if (billingStatus !== 'Ready') return null;

  async function handleGenerate() {
    setState('loading');
    const res = await generateClaim([visitId], payer);
    if (res.success && res.claim) {
      setResult(res.claim);
      setState('done');
      // Refresh server-rendered Claims Queue so billing_status → Draft
      router.refresh();
      // Notify BillingHistoryPanel to reload its claims list
      window.dispatchEvent(new CustomEvent('billing:claim-generated'));
    } else {
      setErrMsg(res.message);
      setState('error');
    }
  }

  if (state === 'loading') {
    return <span style={{ fontSize: 11, color: 'var(--muted)' }}>Generating…</span>;
  }

  if (state === 'done' && result) {
    return (
      <span
        title={`Claim #${result.id} · ${result.payer} · ${result.total_units} units · $${result.total_amount.toFixed(2)}`}
        style={{ fontSize: 11, fontWeight: 700, color: '#35693c', cursor: 'help' }}
      >
        ✓ Claim #{result.id}
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span
        title={errMsg}
        style={{ fontSize: 11, fontWeight: 700, color: '#d56b6b', cursor: 'pointer' }}
        onClick={handleGenerate}
      >
        ✗ Retry
      </span>
    );
  }

  return (
    <button
      onClick={handleGenerate}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontSize: 12, fontWeight: 700, color: '#2567a4', textDecoration: 'underline',
      }}
    >
      Generate Claim
    </button>
  );
}
