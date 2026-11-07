'use client';

import { useState } from 'react';
import {
  submitSingleVisit,
  batchSubmit,
  retrySubmission,
  type AggregatorQueueItem,
  type SubmissionRecord,
  type VisitSubmitResult,
  type BatchSubmitResult,
} from '@/lib/queries/aggregator';

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------
const STATUS_COLOR: Record<string, string> = {
  Accepted:  '#35693c',
  Rejected:  '#d56b6b',
  Error:     '#d56b6b',
  Pending:   '#c4831e',
  Submitted: '#2567a4',
  Ready:     '#35693c',
  Draft:     '#8a9aaa',
};
const STATUS_BG: Record<string, string> = {
  Accepted:  '#f0faf1',
  Rejected:  '#fdf4f4',
  Error:     '#fdf4f4',
  Pending:   '#fdf6ec',
  Submitted: '#eef5fb',
  Ready:     '#f0faf1',
  Draft:     '#f4f6f9',
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      color: STATUS_COLOR[status] ?? '#555',
      background: STATUS_BG[status] ?? '#f4f4f4',
    }}>
      {status}
    </span>
  );
}

function AggregatorBadge({ agg }: { agg: string | null }) {
  if (!agg) return <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>;
  const isSandata = agg.toLowerCase() === 'sandata';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
      color: isSandata ? '#2567a4' : '#35693c',
      background: isSandata ? '#eef5fb' : '#f0faf1',
      border: `1px solid ${isSandata ? '#c8dff0' : '#b7e0bc'}`,
      letterSpacing: '0.3px',
    }}>
      {isSandata ? 'Sandata' : 'HHAeXchange'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Single-visit submit button
// ---------------------------------------------------------------------------
function SingleSubmitBtn({
  item,
  aggregator,
  onDone,
}: {
  item: AggregatorQueueItem;
  aggregator: string;
  onDone: (r: VisitSubmitResult) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<VisitSubmitResult | null>(null);

  // HHAeXchange submission not yet implemented
  if (aggregator === 'hhax') {
    return (
      <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
        Coming soon
      </span>
    );
  }

  async function handle() {
    setState('loading');
    const r = await submitSingleVisit(item.visit_id);
    setResult(r);
    setState(r.success ? 'done' : 'error');
    onDone(r);
  }

  if (state === 'loading') return <span style={{ fontSize: 11, color: 'var(--muted)' }}>Submitting…</span>;

  if (state === 'done') return (
    <span title={result?.message} style={{ fontSize: 11, fontWeight: 700, color: '#35693c', cursor: 'help' }}>
      ✓ Accepted
    </span>
  );

  if (state === 'error') return (
    <span title={result?.message} onClick={handle}
      style={{ fontSize: 11, fontWeight: 700, color: '#d56b6b', cursor: 'pointer', textDecoration: 'underline' }}>
      ✗ Retry
    </span>
  );

  return (
    <button onClick={handle} style={{
      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
      fontSize: 12, fontWeight: 700, color: '#35693c', textDecoration: 'underline',
    }}>
      Submit
    </button>
  );
}

// ---------------------------------------------------------------------------
// Retry submission button
// ---------------------------------------------------------------------------
function RetryBtn({ id, onDone }: { id: number; onDone: (r: VisitSubmitResult) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');

  async function handle() {
    setState('loading');
    const r = await retrySubmission(id);
    onDone(r);
    setState('done');
  }

  if (state === 'loading') return <span style={{ fontSize: 11, color: 'var(--muted)' }}>Retrying…</span>;
  if (state === 'done') return <span style={{ fontSize: 11, color: '#35693c', fontWeight: 700 }}>✓ Done</span>;

  return (
    <button onClick={handle} style={{
      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
      fontSize: 12, fontWeight: 700, color: '#2567a4', textDecoration: 'underline',
    }}>
      Retry
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main panel (tabs + batch submit)
// ---------------------------------------------------------------------------
interface Props {
  initialQueue: AggregatorQueueItem[];
  initialHistory: SubmissionRecord[];
  historyTotal: number;
  mode: 'simulate' | 'live';
  aggregator: string;  // '' | 'sandata' | 'hhax'
}

export function EvvAggregatorPanel({ initialQueue, initialHistory, historyTotal, mode, aggregator }: Props) {
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [queue, setQueue] = useState(initialQueue);
  const [history, setHistory] = useState(initialHistory);
  const [batchState, setBatchState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [batchResult, setBatchResult] = useState<BatchSubmitResult | null>(null);
  const [batchError, setBatchError] = useState('');
  const [notifications, setNotifications] = useState<string[]>([]);

  const isHhax = aggregator === 'hhax';
  const aggLabel = isHhax ? 'HHAeXchange' : 'Sandata';

  function notify(msg: string) {
    setNotifications(prev => [msg, ...prev].slice(0, 5));
  }

  function onSingleDone(result: VisitSubmitResult) {
    if (result.success) {
      setQueue(q => q.filter(i => i.visit_id !== result.visit_id));
      notify(`✓ Visit ${result.visit_id} accepted (${result.transaction_id})`);
    } else {
      notify(`✗ Visit ${result.visit_id} failed: ${result.message}`);
    }
  }

  async function handleBatch() {
    setBatchState('loading');
    setBatchError('');
    try {
      const r = await batchSubmit(50);
      setBatchResult(r);
      setBatchState('done');
      const accepted = r.results.filter(x => x.success).map(x => x.visit_id);
      setQueue(q => q.filter(i => !accepted.includes(i.visit_id)));
      notify(`Batch complete — ${r.accepted} accepted, ${r.rejected} rejected, ${r.errors} errors`);
    } catch (e: unknown) {
      setBatchState('error');
      setBatchError(e instanceof Error ? e.message : 'Batch failed');
    }
  }

  const modeColor = mode === 'live' ? '#35693c' : '#2567a4';
  const modeBg   = mode === 'live' ? '#f0faf1'  : '#eef5fb';

  return (
    <div>
      {/* Mode badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
          color: modeColor, background: modeBg, letterSpacing: '0.5px',
        }}>
          MODE: {mode.toUpperCase()}
        </span>
        {mode === 'simulate' && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Set SANDATA_MODE=live in .env to enable real Sandata submissions
          </span>
        )}
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {notifications.map((n, i) => (
            <div key={i} style={{
              fontSize: 12, padding: '6px 12px', borderRadius: 6, marginBottom: 4,
              background: n.startsWith('✓') ? '#f0faf1' : n.startsWith('Batch') ? '#eef5fb' : '#fdf4f4',
              color: n.startsWith('✓') ? '#35693c' : n.startsWith('Batch') ? '#2567a4' : '#d56b6b',
              fontWeight: 600,
            }}>
              {n}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        <button className={`tab-btn${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>
          Submission Queue ({queue.length})
        </button>
        <button className={`tab-btn${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
          History ({historyTotal})
        </button>
      </div>

      {/* ── QUEUE TAB ── */}
      {tab === 'queue' && (
        <div>
          {/* Batch submit */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {queue.length === 0
                ? `No visits pending ${aggLabel} submission.`
                : `${queue.length} visit${queue.length !== 1 ? 's' : ''} ready for ${aggLabel} submission`}
            </span>
            {queue.length > 0 && !isHhax && (
              <button
                className="btn"
                onClick={handleBatch}
                disabled={batchState === 'loading'}
                style={{ fontSize: 13 }}
              >
                {batchState === 'loading' ? `Submitting ${queue.length}…` : `Submit All ${queue.length}`}
              </button>
            )}
            {queue.length > 0 && isHhax && (
              <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                HHAeXchange batch submission coming soon
              </span>
            )}
          </div>

          {batchState === 'error' && (
            <div style={{ color: '#d56b6b', fontSize: 12, marginBottom: 10 }}>{batchError}</div>
          )}

          {batchResult && batchState === 'done' && (
            <div style={{
              background: '#eef5fb', border: '1px solid #c8dff2', borderRadius: 8,
              padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#2567a4',
            }}>
              Batch result — {batchResult.submitted} submitted · {batchResult.accepted} accepted · {batchResult.rejected} rejected · {batchResult.errors} errors
            </div>
          )}

          {queue.length > 0 ? (
            <div className="mini-table-wrap">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Visit ID</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>DSP</th>
                    <th>Code</th>
                    <th>EVV</th>
                    <th>Sandata</th>
                    <th>HHAeXchange</th>
                    <th>Approval</th>
                    <th>Attempts</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(item => (
                    <tr key={item.visit_id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>#{item.visit_id}</td>
                      <td>{item.service_date}</td>
                      <td>{item.client_name}</td>
                      <td>{item.employee_name}</td>
                      <td><code style={{ fontSize: 11 }}>{item.service_code}</code></td>
                      <td><StatusBadge status={item.evv_status} /></td>
                      <td><StatusBadge status={item.sandata_status} /></td>
                      <td><StatusBadge status={item.hhax_status} /></td>
                      <td><StatusBadge status={item.approval_status} /></td>
                      <td style={{ textAlign: 'center', color: item.prior_attempts > 0 ? '#c4831e' : 'var(--muted)', fontSize: 12 }}>
                        {item.prior_attempts}
                      </td>
                      <td>
                        <SingleSubmitBtn item={item} aggregator={aggregator} onDone={onSingleDone} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>
              All verified visits have been submitted.
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>
              No submissions recorded yet.
            </div>
          ) : (
            <div className="mini-table-wrap">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Visit</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>DSP</th>
                    <th>Aggregator</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Transaction ID</th>
                    <th>Submitted At</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(rec => (
                    <tr key={rec.id}>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{rec.id}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>#{rec.visit_id}</td>
                      <td>{rec.service_date ?? '—'}</td>
                      <td>{rec.client_name ?? '—'}</td>
                      <td>{rec.employee_name ?? '—'}</td>
                      <td><AggregatorBadge agg={rec.aggregator} /></td>
                      <td style={{ fontSize: 11 }}>{rec.submission_type}</td>
                      <td><StatusBadge status={rec.status} /></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={rec.transaction_id ?? ''}>
                        {rec.transaction_id ?? '—'}
                      </td>
                      <td style={{ fontSize: 11 }}>{rec.submitted_at ?? '—'}</td>
                      <td>
                        {(rec.status === 'Rejected' || rec.status === 'Error') && rec.aggregator !== 'hhax' && (
                          <RetryBtn id={rec.id} onDone={(r) => {
                            if (r.success) setHistory(h => h.map(x => x.id === rec.id ? { ...x, status: 'Accepted' } : x));
                          }} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
