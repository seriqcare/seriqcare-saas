'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-context';
import {
  getClaimGroups,
  generateBulkClaims,
  type ClaimGroupPreview,
  type BulkGenerateResponse,
} from '@/lib/queries/billing';
import type { ModeConfig } from '@/lib/billing-mode-config';

interface Props {
  readyCount: number;
  period: string;
  modeConfig: ModeConfig;
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}
function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function payerLabel(p: string) {
  if (p === 'sandata') return 'Sandata';
  if (p === 'hhax')    return 'HHAeXchange';
  return 'Private';
}

type Step = 'idle' | 'loading' | 'preview' | 'generating' | 'done' | 'error';

export function BillingGenerateAllBtn({ readyCount, period, modeConfig }: Props) {
  const router = useRouter();
  const { apiFetch } = useAuth();
  const [step, setStep]       = useState<Step>('idle');
  const [preview, setPreview] = useState<ClaimGroupPreview | null>(null);
  const [result, setResult]   = useState<BulkGenerateResponse | null>(null);
  const [errMsg, setErrMsg]   = useState('');

  async function openPreview() {
    setStep('loading');
    let data: ClaimGroupPreview;
    try {
      data = await getClaimGroups(period, apiFetch);
    } catch (error) {
      setErrMsg(error instanceof Error ? error.message : 'Claim preview failed');
      setStep('error');
      return;
    }
    if (data.total_groups === 0) {
      setErrMsg('No Ready-to-bill visits found for this period.');
      setStep('error');
      return;
    }
    setPreview(data);
    setStep('preview');
  }

  async function confirmGenerate() {
    if (!preview) return;
    setStep('generating');
    const res = await generateBulkClaims(period, apiFetch);
    if (res.success && res.result) {
      setResult(res.result);
      setStep('done');
      router.refresh();
      window.dispatchEvent(new CustomEvent('billing:claim-generated'));
    } else {
      setErrMsg(res.message);
      setStep('error');
    }
  }

  function close() {
    setStep('idle');
    setPreview(null);
    setResult(null);
    setErrMsg('');
  }

  const showModal = step !== 'idle';

  return (
    <>
      <button
        className="btn primary"
        onClick={openPreview}
        disabled={readyCount === 0}
        style={{ opacity: readyCount === 0 ? 0.5 : 1 }}
      >
        Generate Claims{readyCount > 0 ? ` (${readyCount})` : ''}
      </button>

      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && step !== 'generating') close(); }}
        >
          <div
            style={{
              background: '#fff', borderRadius: 10, width: '100%', maxWidth: 780,
              maxHeight: '88vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--line-soft)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {step === 'done' ? modeConfig.previewDoneTitle : modeConfig.previewTitle}
              </div>
              {step !== 'generating' && (
                <button
                  onClick={close}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', padding: 4 }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>

              {/* Loading */}
              {(step === 'loading' || step === 'generating') && (
                <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  {step === 'loading' ? 'Analyzing Ready visits…' : 'Creating records…'}
                </div>
              )}

              {/* Error */}
              {step === 'error' && (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <div style={{ color: '#d56b6b', fontWeight: 600, marginBottom: 8 }}>Error</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{errMsg}</div>
                </div>
              )}

              {/* Done */}
              {step === 'done' && result && (
                <div style={{ padding: '32px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#35693c', marginBottom: 8 }}>
                    {result.claims_created} record{result.claims_created !== 1 ? 's' : ''} created
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {result.total_visits} visits · {result.total_units.toFixed(0)} units · {fmtCurrency(result.total_amount)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                    {modeConfig.previewDoneNote}
                  </div>
                </div>
              )}

              {/* Preview */}
              {step === 'preview' && preview && (
                <>
                  {/* Summary row */}
                  <div
                    style={{
                      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
                      padding: '16px 0', borderBottom: '1px solid var(--line-soft)',
                    }}
                  >
                    {[
                      ['Records',  String(preview.total_groups)],
                      ['Visits',   String(preview.total_visits)],
                      ['Units',    preview.total_units.toFixed(0)],
                      ['Amount',   fmtCurrency(preview.total_amount)],
                    ].map(([label, value]) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Groups table */}
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>
                      {modeConfig.previewGroupsLabel}
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Client</th>
                            <th>Payer</th>
                            <th>Auth ID</th>
                            <th>Week</th>
                            <th style={{ textAlign: 'right' }}>Visits</th>
                            <th style={{ textAlign: 'right' }}>Units</th>
                            <th style={{ textAlign: 'right' }}>Est. Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.groups.map((g, i) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 600, fontSize: 12 }}>{g.client_name}</td>
                              <td style={{ fontSize: 12 }}>{payerLabel(g.payer)}</td>
                              <td>
                                {g.service_authorization_id
                                  ? <span style={{ fontSize: 11, fontWeight: 600, background: '#eef5fb', color: '#2567a4', padding: '2px 6px', borderRadius: 4, border: '1px solid #c8dff0' }}>#{g.service_authorization_id}</span>
                                  : <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                                }
                              </td>
                              <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                                {fmtDate(g.period_start_date)} – {fmtDate(g.period_end_date)}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{g.visit_count}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{g.total_units.toFixed(2)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(g.total_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--line-soft)',
                display: 'flex', gap: 8, justifyContent: 'flex-end',
              }}
            >
              {step === 'preview' && (
                <>
                  <button
                    onClick={close}
                    style={{
                      padding: '7px 16px', borderRadius: 5,
                      border: '1px solid var(--line)', background: '#fff',
                      fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmGenerate}
                    style={{
                      padding: '7px 20px', borderRadius: 5,
                      border: '1px solid #35693c', background: '#35693c',
                      fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer',
                    }}
                  >
                    Generate {preview!.total_groups} Record{preview!.total_groups !== 1 ? 's' : ''}
                  </button>
                </>
              )}
              {(step === 'done' || step === 'error') && (
                <button
                  onClick={close}
                  style={{
                    padding: '7px 16px', borderRadius: 5,
                    border: '1px solid #2567a4', background: '#2567a4',
                    fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
