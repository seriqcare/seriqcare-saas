import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { QueryTabs } from '@/components/query-tabs';
import { QuerySearchInput } from '@/components/query-search-input';
import { VisitPeriodSelect } from '@/components/visit-period-select';
import { BillingGenerateBtn } from '@/components/billing-generate-btn';
import { BillingClaimsPanel } from '@/components/billing-claims-panel';
import { getBillingEntries, getAuthUtilization, getIntegrationMode, billingExportUrl, type BillingEntry, type AuthUtilizationItem } from '@/lib/queries/billing';
import { BillingHistoryPanel } from '@/components/billing-history-panel';
import { BillingGenerateAllBtn } from '@/components/billing-generate-all-btn';
import { getModeConfig, type ModeConfig } from '@/lib/billing-mode-config';

export const dynamic = 'force-dynamic';

const PER_PAGE = 20;

/* ── Status color maps ─────────────────────────────────────── */
const STATUS_COLOR: Record<string, string> = {
  Ready:     '#35693c',
  Submitted: '#2567a4',
  Paid:      '#1d5c35',
  Denied:    '#d56b6b',
  Voided:    '#8a9aaa',
  Approved:  '#35693c',
  Pending:   '#c4831e',
};
const STATUS_CLS: Record<string, string> = {
  Ready:     'active',
  Submitted: '',
  Paid:      'active',
  Denied:    'flag',
  Voided:    '',
  Approved:  'active',
  Pending:   'hold',
};
const EVV_COLOR: Record<string, string> = {
  Verified: '#35693c',
  Adjusted: '#2567a4',
  Pending:  '#c4831e',
  Failed:   '#d56b6b',
  Exempt:   '#8a9aaa',
};

/* ── Helpers ─────────────────────────────────────────────── */
function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
function fmtCurrency(n: number | null) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}
function periodLabel(period: string) {
  if (period === 'last_month') return 'Last Month';
  if (period === 'last3m')     return 'Last 3 Months';
  return 'This Month';
}
function buildPageHref(search: string, status: string, period: string, page: number) {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (status) p.set('status', status);
  if (period !== 'this_month') p.set('period', period);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  return qs ? `/billing?${qs}` : '/billing';
}

/* ── Claims Queue table (server-rendered) ─────────────────── */
function ClaimsQueueTable({
  items, total, page, totalPages, startRow, endRow, search, status, period, modeConfig,
}: {
  items: BillingEntry[];
  total: number;
  page: number;
  totalPages: number;
  startRow: number;
  endRow: number;
  search: string;
  status: string;
  period: string;
  modeConfig: ModeConfig;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--line-soft)' }}>
        <div style={{ marginBottom: 12 }}>
          <div className="card-title">Claims Queue</div>
          <div className="card-subtitle">
            {modeConfig.claimsQueueSubtitle} · {periodLabel(period)}
          </div>
        </div>
        <QueryTabs
          param="status"
          tabs={[
            { label: 'All',          value: ''          },
            { label: 'Ready to Bill',value: 'Ready',     dotColor: STATUS_COLOR.Ready     },
            { label: 'Submitted',    value: 'Submitted', dotColor: STATUS_COLOR.Submitted },
            { label: 'Paid',         value: 'Paid',      dotColor: STATUS_COLOR.Paid      },
            { label: 'Denied',       value: 'Denied',    dotColor: STATUS_COLOR.Denied    },
          ]}
          resetKeys={['page']}
        />
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Visit ID</th>
              <th>Date</th>
              <th>Client</th>
              <th>Caregiver</th>
              <th>Service Code</th>
              <th>Units</th>
              <th>Est. Amount</th>
              <th>EVV Status</th>
              <th>Approval</th>
              <th>Billing Status</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No billing records found</div>
                  <div style={{ fontSize: 11 }}>
                    {status === 'Ready'
                      ? 'No visits are Ready to Bill for this period'
                      : 'Adjust the period or status filter'}
                  </div>
                </td>
              </tr>
            ) : (
              items.map((v) => {
                const units = v.approved_units ?? v.billed_units ?? 0;
                const bsDot = STATUS_COLOR[v.billing_status] ?? '#8a9aaa';
                const bsCls = STATUS_CLS[v.billing_status]  ?? '';
                const evvDot = EVV_COLOR[v.evv_status ?? ''] ?? '#8a9aaa';
                return (
                  <tr key={v.visit_id}>
                    <td>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#2567a4' }}>
                        #{String(v.visit_id).padStart(5, '0')}
                      </div>
                      {v.claim_id && (
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          Claim #{v.claim_id}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {fmtDate(v.service_date)}
                    </td>
                    <td>
                      <div className="person-cell">
                        <div
                          className="person-avatar"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: '#2567a4',
                          }}
                        >
                          {initials(v.client_name)}
                        </div>
                        <div className="person-name">{v.client_name}</div>
                      </div>
                    </td>
                    <td>
                      <div className="person-cell">
                        <div
                          className="person-avatar"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: '#35693c',
                            background: 'linear-gradient(135deg,#d7edd7,#9ecb9e)',
                          }}
                        >
                          {initials(v.employee_name)}
                        </div>
                        <div className="person-name">{v.employee_name}</div>
                      </div>
                    </td>
                    <td>
                      {v.service_code
                        ? <span style={{ fontSize: 11, fontWeight: 600, background: '#eef5fb', color: '#2567a4', padding: '2px 8px', borderRadius: 4, border: '1px solid #c8dff0' }}>{v.service_code}</span>
                        : <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                      }
                    </td>
                    <td>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{units.toFixed(2)}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {v.approved_units != null ? 'approved' : 'billed'}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>
                        {fmtCurrency(v.estimated_amount)}
                      </div>
                      {v.default_rate != null && (
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          Estimated · ${v.default_rate.toFixed(2)}/unit
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: evvDot, flexShrink: 0, display: 'inline-block' }} />
                        <span style={{ fontSize: 12 }}>{v.evv_status ?? '—'}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{v.approval_status ?? '—'}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: bsDot, flexShrink: 0, display: 'inline-block' }} />
                        <span className={`status ${bsCls}`}>{v.billing_status}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <BillingGenerateBtn
                          visitId={v.visit_id}
                          billingStatus={v.billing_status}
                          payer={
                            v.sandata_status != null ? 'sandata'
                              : v.hhax_status != null ? 'hhax'
                              : 'sandata'
                          }
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination" style={{ padding: '10px 18px' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {total === 0
            ? 'No records'
            : `Showing ${startRow}–${endRow} of ${total} visit records`}
          {search ? ` matching "${search}"` : ''}
          {status ? ` · ${status}` : ''}
        </div>
        <div className="page-controls">
          {page > 1
            ? <Link href={buildPageHref(search, status, period, page - 1)} className="page-btn">‹</Link>
            : <div className="page-btn" style={{ opacity: 0.35, cursor: 'default' }}>‹</div>}

          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const p = start + i;
            if (p < 1 || p > totalPages) return null;
            return (
              <Link key={p} href={buildPageHref(search, status, period, p)} className={`page-btn${p === page ? ' active' : ''}`}>
                {p}
              </Link>
            );
          })}

          {page < totalPages
            ? <Link href={buildPageHref(search, status, period, page + 1)} className="page-btn">›</Link>
            : <div className="page-btn" style={{ opacity: 0.35, cursor: 'default' }}>›</div>}
        </div>
      </div>
    </div>
  );
}


/* ── Page ─────────────────────────────────────────────────── */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    period?: string;
    page?: string;
  }>;
}) {
  const { search = '', status = '', period = 'this_month', page: pageStr = '1' } = await searchParams;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);

  const [data, authUtil, integrationMode] = await Promise.all([
    getBillingEntries(page, PER_PAGE, period, status, search),
    getAuthUtilization(10),
    getIntegrationMode(),
  ]);
  const modeConfig = getModeConfig(integrationMode);
  const { stats, items, total } = data;

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const startRow   = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const endRow     = Math.min(page * PER_PAGE, total);

  // Billing alerts derived from this page of data
  const deniedItems   = items.filter((v) => v.billing_status === 'Denied');
  const pendingEVV    = items.filter((v) => v.evv_status === 'Pending' || v.evv_status === 'Failed');

  // Auth utilization alerts
  const expiringAuths = authUtil.filter((a) => a.days_until_expiry >= 0 && a.days_until_expiry <= 30);
  const overUtilized  = authUtil.filter((a) => a.utilization_pct >= 90);

  return (
    <ProtectedLayout>
      {/* ── Topbar ───────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="page-title">Billing</h1>
            <span
              style={{
                fontSize: 11, fontWeight: 700,
                background: integrationMode === 'HHAX' ? '#eef5fb' : '#f0f7f1',
                color:      integrationMode === 'HHAX' ? '#2567a4' : '#35693c',
                border:     integrationMode === 'HHAX' ? '1px solid #c8dff0' : '1px solid #b2d9b4',
                padding: '3px 10px', borderRadius: 12,
              }}
            >
              {modeConfig.badgeLabel}
            </span>
          </div>
          <p className="page-subtitle">
            PA Medicaid · ODP Consolidated Waiver · PDA / MA · Pilot Estimates
          </p>
        </div>
        <div className="top-actions">
          <QuerySearchInput placeholder="Search visit ID, client, or caregiver…" />
          <VisitPeriodSelect current={period} />
          <BillingGenerateAllBtn readyCount={stats.ready_to_bill} period={period} modeConfig={modeConfig} />
          <a
            href={billingExportUrl(period)}
            className="btn secondary"
            style={{ textDecoration: 'none' }}
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* ── KPI row ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          {
            label: 'Est. Billed This Month',
            value: `$${stats.total_estimated_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            sub: `${stats.total_units.toFixed(0)} units · ${stats.total_visits} visits`,
            color: '#35693c',
          },
          {
            label: 'Pending Claims',
            value: String(stats.pending_claims),
            sub: 'Draft · Ready · Submitted',
            color: '#2567a4',
          },
          {
            label: 'Ready to Bill',
            value: String(stats.ready_to_bill),
            sub: 'Approved + EVV verified',
            color: '#c4831e',
          },
          {
            label: 'Paid / Approved',
            value: String(stats.approved),
            sub: 'Claims paid this period',
            color: '#1d5c35',
          },
          {
            label: 'Denials',
            value: String(stats.denied),
            sub: 'Requires resubmission',
            color: stats.denied > 0 ? '#d56b6b' : '#8a9aaa',
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Main grid ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 16, alignItems: 'start' }}>

        {/* Left column */}
        <BillingClaimsPanel
          queue={
            <ClaimsQueueTable
              items={items}
              total={total}
              page={page}
              totalPages={totalPages}
              startRow={startRow}
              endRow={endRow}
              search={search}
              status={status}
              period={period}
              modeConfig={modeConfig}
            />
          }
          history={<BillingHistoryPanel modeConfig={modeConfig} />}
        />

        {/* Right sidebar */}
        <div style={{ display: 'grid', gap: 14 }}>

          {/* This Month summary */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>{periodLabel(period)}</div>
            <div className="quick-stats">
              {[
                ['Total Visits',   String(stats.total_visits)],
                ['Total Units',    stats.total_units.toFixed(0)],
                ['Est. Amount',    `$${stats.total_estimated_amount.toFixed(2)}`],
                ['Ready to Bill',  String(stats.ready_to_bill)],
              ].map(([label, value]) => (
                <div className="quick-stat" key={label}>
                  <div className="quick-stat-label">{label}</div>
                  <div className="quick-stat-value">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Auth Utilization */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 2 }}>Auth Utilization</div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>Top clients by units used</div>
            {authUtil.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                No active authorizations found
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {authUtil.slice(0, 5).map((a) => {
                  const pct = Math.min(a.utilization_pct, 100);
                  const barColor = pct >= 100 ? '#d56b6b' : pct >= 90 ? '#c4831e' : '#2567a4';
                  const isExpiringSoon = a.days_until_expiry >= 0 && a.days_until_expiry <= 30;
                  return (
                    <div key={a.auth_id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.client_name}
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: barColor }}>
                          {a.utilization_pct.toFixed(0)}%
                        </div>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {a.service_code ?? '—'} · {a.used_units.toFixed(0)}/{a.authorized_units.toFixed(0)} units
                        </div>
                        {isExpiringSoon && (
                          <div style={{ fontSize: 10, color: '#c4831e', fontWeight: 600 }}>
                            {a.days_until_expiry === 0 ? 'Expires today' : `${a.days_until_expiry}d left`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Billing Alerts */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Billing Alerts</div>
            <div className="alert-list">
              {stats.ready_to_bill > 0 && (
                <div className="alert-item">
                  <div className="alert-dot warning" />
                  <div className="alert-body">
                    <div className="alert-title">{stats.ready_to_bill} Ready to Bill</div>
                    <div className="alert-sub">Approved + EVV verified — generate claims</div>
                  </div>
                </div>
              )}
              {deniedItems.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot urgent" />
                  <div className="alert-body">
                    <div className="alert-title">{stats.denied} Claim Denial{stats.denied > 1 ? 's' : ''}</div>
                    <div className="alert-sub">Resubmission required</div>
                  </div>
                </div>
              )}
              {pendingEVV.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot urgent" />
                  <div className="alert-body">
                    <div className="alert-title">{pendingEVV.length} Unapproved Visit{pendingEVV.length > 1 ? 's' : ''}</div>
                    <div className="alert-sub">EVV Pending or Failed — cannot bill</div>
                  </div>
                </div>
              )}
              {expiringAuths.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot warning" />
                  <div className="alert-body">
                    <div className="alert-title">{expiringAuths.length} Auth{expiringAuths.length > 1 ? 's' : ''} Expiring Soon</div>
                    <div className="alert-sub">Within 30 days — review utilization</div>
                  </div>
                </div>
              )}
              {overUtilized.length > 0 && (
                <div className="alert-item">
                  <div className="alert-dot urgent" />
                  <div className="alert-body">
                    <div className="alert-title">{overUtilized.length} Auth{overUtilized.length > 1 ? 's' : ''} Near/Over Limit</div>
                    <div className="alert-sub">90%+ utilized — contact payer</div>
                  </div>
                </div>
              )}
              {stats.ready_to_bill === 0 && stats.denied === 0 && pendingEVV.length === 0 && expiringAuths.length === 0 && overUtilized.length === 0 && (
                <div className="alert-item">
                  <div className="alert-dot info" />
                  <div className="alert-body">
                    <div className="alert-title">No billing alerts</div>
                    <div className="alert-sub">All records in good standing</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                ['Visits',      '/visits'],
                ['EVV',         '/evv'],
                ['Timesheets',  '/timesheets'],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: 'block', padding: '9px 12px',
                    border: '1px solid var(--line)', borderRadius: 6,
                    fontSize: 12, fontWeight: 600,
                    color: 'var(--primary)', background: 'var(--primary-soft)',
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
