'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  getClaimsList,
  getClaimDetail,
  updateClaimStatus,
  claimExportUrl,
  type BillingClaimListItem,
  type BillingClaimDetail,
} from '@/lib/queries/billing';
import type { ModeConfig } from '@/lib/billing-mode-config';

/* ── Helpers ──────────────────────────────────────────────── */
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
function fmtCurrency(n: number) {
  return `$${n.toFixed(2)}`;
}
function payerLabel(payer: string) {
  if (payer === 'sandata') return 'Sandata';
  if (payer === 'hhax')    return 'HHAeXchange';
  return 'Private';
}
function statusDotColor(status: string, modeConfig: ModeConfig): string {
  return modeConfig.statusColors[status] ?? '#8a9aaa';
}

/* ── Detail Drawer ────────────────────────────────────────── */
function ClaimDetailModal({
  claimId,
  modeConfig,
  onClose,
}: {
  claimId: number;
  modeConfig: ModeConfig;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BillingClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getClaimDetail(claimId)
      .then((d) => {
        if (!d) setError('Claim not found');
        else setDetail(d);
      })
      .catch(() => setError('Failed to load claim detail'))
      .finally(() => setLoading(false));
  }, [claimId]);

  const statusColor = detail ? (statusDotColor(detail.status, modeConfig)) : '#8a9aaa';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 10, width: '100%', maxWidth: 760,
          maxHeight: '90vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        }}
      >
        {/* Modal header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--line-soft)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              Claim #{String(claimId).padStart(5, '0')}
              {detail && (
                <span
                  style={{
                    marginLeft: 10, fontSize: 11, fontWeight: 600,
                    color: statusColor,
                    background: `${statusColor}18`,
                    padding: '2px 8px', borderRadius: 4,
                    border: `1px solid ${statusColor}44`,
                  }}
                >
                  {detail.status}
                </span>
              )}
            </div>
            {detail && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {fmtDate(detail.claim_date)} · {payerLabel(detail.payer)} · Created {fmtDate(detail.created_at.slice(0, 10))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 18, color: 'var(--muted)', lineHeight: 1, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
          {loading && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#d56b6b', fontSize: 13 }}>
              {error}
            </div>
          )}
          {detail && !loading && (
            <>
              {/* Summary row */}
              <div
                style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
                  padding: '16px 0', borderBottom: '1px solid var(--line-soft)',
                }}
              >
                {[
                  ['Visits',      String(detail.line_items.length)],
                  ['Total Units', detail.total_units.toFixed(2)],
                  ['Est. Amount', fmtCurrency(detail.total_amount)],
                ].map(([label, value]) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Line items table */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Visit Line Items</div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Visit ID</th>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Caregiver</th>
                        <th>Code</th>
                        <th style={{ textAlign: 'right' }}>Units</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.line_items.map((li) => (
                        <tr key={li.line_id}>
                          <td>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#2567a4' }}>
                              #{String(li.visit_id).padStart(5, '0')}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(li.service_date)}</td>
                          <td style={{ fontSize: 12 }}>{li.client_name}</td>
                          <td style={{ fontSize: 12 }}>{li.employee_name}</td>
                          <td>
                            {li.service_code
                              ? <span style={{ fontSize: 11, fontWeight: 600, background: '#eef5fb', color: '#2567a4', padding: '2px 6px', borderRadius: 4, border: '1px solid #c8dff0' }}>{li.service_code}</span>
                              : <span style={{ color: 'var(--muted)' }}>—</span>
                            }
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{li.units.toFixed(2)}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmtCurrency(li.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', paddingTop: 8 }}>
                          TOTAL
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, paddingTop: 8 }}>
                          {detail.total_units.toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, paddingTop: 8 }}>
                          {fmtCurrency(detail.total_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Mode-specific detail section */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line-soft)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                  {modeConfig.detailSectionTitle}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
                  {modeConfig.detailFields.map(({ key, label }) => {
                    const value = (detail as unknown as Record<string, unknown>)[key];
                    return (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 12, color: value ? 'var(--text)' : 'var(--muted)' }}>
                          {value != null ? String(value) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--line-soft)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
          }}
        >
          {detail && modeConfig.mode === 'SANDATA' && (
            <a
              href={claimExportUrl(detail.id, 'csv')}
              style={{
                padding: '7px 14px', borderRadius: 5,
                border: '1px solid #2567a4', background: '#2567a4',
                fontSize: 12, fontWeight: 600, color: '#fff',
                textDecoration: 'none', cursor: 'pointer',
              }}
            >
              Export CSV
            </a>
          )}
          {detail && modeConfig.mode === 'HHAX' && (
            <button
              style={{
                padding: '7px 14px', borderRadius: 5,
                border: '1px solid #2567a4', background: '#2567a4',
                fontSize: 12, fontWeight: 600, color: '#fff',
                cursor: 'not-allowed', opacity: 0.7,
              }}
              disabled
              title="HHAX export not yet implemented"
            >
              Export to HHAX
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px', borderRadius: 5,
              border: '1px solid var(--line)', background: '#fff',
              fontSize: 12, fontWeight: 600, color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Row action button helpers ────────────────────────────── */
function actionBtnStyle(style: 'primary' | 'secondary' | 'danger'): React.CSSProperties {
  if (style === 'primary') return {
    padding: '4px 10px', borderRadius: 4,
    border: '1px solid #2567a4', background: '#eef5fb',
    fontSize: 11, fontWeight: 600, color: '#2567a4', cursor: 'pointer',
  };
  if (style === 'danger') return {
    padding: '4px 10px', borderRadius: 4,
    border: '1px solid #d56b6b', background: '#fdf0f0',
    fontSize: 11, fontWeight: 600, color: '#d56b6b', cursor: 'pointer',
  };
  return {
    padding: '4px 10px', borderRadius: 4,
    border: '1px solid var(--line)', background: '#fff',
    fontSize: 11, fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
  };
}

/* ── Billing History Panel ────────────────────────────────── */
export function BillingHistoryPanel({ modeConfig }: { modeConfig: ModeConfig }) {
  const [claims, setClaims] = useState<BillingClaimListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const PER_PAGE = 20;

  const load = useCallback((p: number) => {
    setLoading(true);
    getClaimsList(p, PER_PAGE)
      .then((res) => {
        setClaims(res.items);
        setTotal(res.total);
        setPage(p);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(1); }, [load]);

  useEffect(() => {
    const handler = () => load(1);
    window.addEventListener('billing:claim-generated', handler);
    return () => window.removeEventListener('billing:claim-generated', handler);
  }, [load]);

  async function handleStatusChange(claimId: number, newStatus: string) {
    setUpdatingId(claimId);
    const res = await updateClaimStatus(claimId, newStatus);
    if (res.success && res.updated) {
      setClaims((prev) => prev.map((c) => c.id === claimId ? res.updated! : c));
      window.dispatchEvent(new CustomEvent('billing:claim-generated'));
    }
    setUpdatingId(null);
  }

  function handleRowAction(key: string, claim: BillingClaimListItem) {
    switch (key) {
      case 'view':
        setSelectedId(claim.id);
        break;
      case 'export_csv':
        window.open(claimExportUrl(claim.id, 'csv'), '_blank');
        break;
      case 'mark_submitted':
        handleStatusChange(claim.id, 'Manually Submitted');
        break;
      // HHAX actions — stubs until backend endpoints are ready
      case 'export_hhax':
      case 're_export':
        alert('HHAX export not yet implemented. This action will trigger SFTP submission in a future release.');
        break;
      case 'view_response':
        alert('HHAX response viewer not yet implemented.');
        break;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <>
      {selectedId !== null && (
        <ClaimDetailModal
          claimId={selectedId}
          modeConfig={modeConfig}
          onClose={() => setSelectedId(null)}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--line-soft)' }}>
          <div className="card-title">Billing History</div>
          <div className="card-subtitle">{modeConfig.historySubtitle}</div>
        </div>

        {loading ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Loading…
          </div>
        ) : claims.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No records generated yet</div>
            <div style={{ fontSize: 11 }}>{modeConfig.historyEmptyNote}</div>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Claim ID</th>
                    <th>Date</th>
                    <th>Payer</th>
                    <th>Visits</th>
                    <th>Units</th>
                    <th>Est. Amount</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => {
                    const dotColor = statusDotColor(c.status, modeConfig);
                    const nextSts  = modeConfig.nextStatuses[c.status];
                    return (
                      <tr key={c.id}>
                        <td>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#2567a4' }}>
                            #{String(c.id).padStart(5, '0')}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                            Created {fmtDate(c.created_at)}
                          </div>
                        </td>
                        <td style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {fmtDate(c.claim_date)}
                        </td>
                        <td style={{ fontSize: 12 }}>{payerLabel(c.payer)}</td>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{c.visit_count}</td>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{c.total_units.toFixed(2)}</td>
                        <td style={{ fontSize: 13, fontWeight: 700 }}>{fmtCurrency(c.total_amount)}</td>
                        <td>
                          {nextSts ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                              <select
                                value={c.status}
                                disabled={updatingId === c.id}
                                onChange={(e) => handleStatusChange(c.id, e.target.value)}
                                style={{
                                  fontSize: 11, fontWeight: 600, border: '1px solid var(--line)',
                                  borderRadius: 4, padding: '2px 4px', background: '#fff',
                                  cursor: 'pointer', color: 'var(--text)',
                                  opacity: updatingId === c.id ? 0.5 : 1,
                                }}
                              >
                                <option value={c.status}>{c.status}</option>
                                {nextSts.map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                              <span style={{ fontSize: 12 }}>{c.status}</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {modeConfig.historyActions.map((action) => (
                              <button
                                key={action.key}
                                onClick={() => handleRowAction(action.key, c)}
                                style={actionBtnStyle(action.style)}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination" style={{ padding: '10px 18px' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {total} record{total !== 1 ? 's' : ''}
                </div>
                <div className="page-controls">
                  <button
                    className="page-btn"
                    style={{ opacity: page <= 1 ? 0.35 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}
                    onClick={() => page > 1 && load(page - 1)}
                    disabled={page <= 1}
                  >
                    ‹
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                    const p = start + i;
                    if (p < 1 || p > totalPages) return null;
                    return (
                      <button
                        key={p}
                        className={`page-btn${p === page ? ' active' : ''}`}
                        onClick={() => p !== page && load(p)}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    className="page-btn"
                    style={{ opacity: page >= totalPages ? 0.35 : 1, cursor: page >= totalPages ? 'default' : 'pointer' }}
                    onClick={() => page < totalPages && load(page + 1)}
                    disabled={page >= totalPages}
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
