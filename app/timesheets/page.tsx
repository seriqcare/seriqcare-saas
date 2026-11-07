import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getTimesheetEntries } from '@/lib/queries/timesheets';
import { TimesheetExportBtn } from '@/components/timesheet-export-btn';
import { TimesheetApproveBtn } from '@/components/timesheet-approve-btn';
import { VisitPeriodSelect } from '@/components/visit-period-select';

export const dynamic = 'force-dynamic';
const PER_PAGE = 20;
const TIMESHEET_PERIOD_OPTIONS = [
  { value: 'pay_current', label: 'Current Pay Period' },
  { value: 'pay_previous', label: 'Previous Pay Period' },
  { value: 'current', label: 'This Week' },
  { value: 'last2', label: 'Last 2 Weeks' },
  { value: 'last4', label: 'Last 4 Weeks' },
];

const APPROVAL_CLS: Record<string, string> = {
  Approved:  'approved',
  Pending:   'pending',
  Rejected:  'flag',
};

// ─── Service code labels ───────────────────────────────────────────────────────
const SERVICE_LABEL: Record<string, string> = {
  W7076: 'Companion',
  W7060: 'In-Home Support',
  W9494: 'Respite',
  W9495: 'Respite Day',
  S5130: 'Homemaker',
  W9783: 'Community Support',
};

// ─── Hours cell — regular + OT ────────────────────────────────────────────────
function HoursCell({ regular, ot }: { regular: number; ot: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {regular.toFixed(1)} h
      </span>
      {ot > 0 && (
        <span style={{ fontSize: 10, fontWeight: 600, color: '#b45309',
          background: '#fef3c7', borderRadius: 3, padding: '1px 5px' }}>
          +{ot.toFixed(1)} OT
        </span>
      )}
    </div>
  );
}

// ─── Time range ────────────────────────────────────────────────────────────────
function TimeRange({ clockIn, clockOut }: { clockIn: string | null; clockOut: string | null }) {
  if (!clockIn && !clockOut) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      <span>{clockIn ?? '—'}</span>
      <span style={{ color: 'var(--muted)', margin: '0 4px' }}>→</span>
      <span>{clockOut ?? '—'}</span>
    </div>
  );
}

function periodLabel(week: string) {
  if (week === 'pay_current') return 'Current Pay Period';
  if (week === 'pay_previous') return 'Previous Pay Period';
  if (week === 'last2') return 'Last 2 Weeks';
  if (week === 'last4') return 'Last 4 Weeks';
  return 'This Week';
}

function formatRangeLabel(startDate: string, endDate: string) {
  if (!startDate || !endDate) return '';
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

function buildPageHref(search: string, week: string, page: number) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (week !== 'pay_current') params.set('week', week);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/timesheets?${query}` : '/timesheets';
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; week?: string; page?: string }>;
}) {
  const { search = '', week = 'pay_current', page: pageStr = '1' } = await searchParams;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const data = await getTimesheetEntries(page, PER_PAGE, week, search, '');
  const { stats, items, total, applied_period: appliedPeriod } = data;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const startRow = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const endRow = Math.min(page * PER_PAGE, total);
  const rangeLabel = formatRangeLabel(appliedPeriod.start_date, appliedPeriod.end_date);

  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">Timesheets</h1>
        </div>
        <div className="top-actions">
          <div className="search">Search caregiver or client</div>
          <VisitPeriodSelect current={week} options={TIMESHEET_PERIOD_OPTIONS} />
          <TimesheetExportBtn period={week} />
          <HeaderUser />
        </div>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, background: '#fbfcfe', borderColor: 'var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Active Payroll Window
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{appliedPeriod.label}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {rangeLabel || periodLabel(week)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Timesheets, approvals, and payroll export use this same range.
          </div>
        </div>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <section className="summary-row">
        <div className="summary-card">
          <div className="summary-label">Total Hours</div>
          <div className="summary-sub-label">{appliedPeriod.label}</div>
          <div className="summary-value">{stats.total_hours.toFixed(1)}</div>
          <div className="summary-sub-value">hrs</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Pending Approval</div>
          <div className="summary-sub-label">Awaiting Review</div>
          <div className="summary-value">{stats.pending}</div>
          <div className="summary-sub-value">entries</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Approved</div>
          <div className="summary-sub-label">Ready for Payroll</div>
          <div className="summary-value">{stats.approved}</div>
          <div className="summary-sub-value">visits</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">EVV Exceptions</div>
          <div className="summary-sub-label">Requires Review</div>
          <div className="summary-value">{stats.exceptions}</div>
          <div className="summary-sub-value">alerts</div>
        </div>
      </section>

      {/* ── Timesheet table ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Caregiver Timesheet Entries</div>
            <div className="card-subtitle">
              Payroll review · scheduled versus actual time · pay rate and gross pay · {appliedPeriod.label}{rangeLabel ? ` (${rangeLabel})` : ''}
            </div>
          </div>
        </div>

        <div className="table-wrap table-scroll">
          <table>
            <thead>
              <tr>
                <th>Caregiver</th>
                <th>Client</th>
                <th>Date</th>
                <th>Service</th>
                <th>Scheduled</th>
                <th>Time In → Out</th>
                <th>Hours</th>
                <th>Pay Rate</th>
                <th>Gross Pay</th>
                <th>Payroll</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', color: '#666', padding: '24px 0' }}>
                    No timesheet entries — check API connection
                  </td>
                </tr>
              ) : (
                items.map((v) => (
                  <tr key={v.visit_id}>
                    {/* Caregiver */}
                    <td>
                      <div className="person-cell">
                        <div className="person-avatar" />
                        <div>
                          <div className="person-name">{v.first_name} {v.last_name}</div>
                          <div className="person-meta">{v.employee_code} · {v.department_code}</div>
                        </div>
                      </div>
                    </td>

                    {/* Client */}
                    <td>
                      <div style={{ fontSize: 13 }}>{v.client_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>ID {v.client_id}</div>
                    </td>

                    {/* Date */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(v.service_date + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                      })}
                    </td>

                    {/* Service code */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
                          background: '#e0e7ff', color: '#3730a3',
                          borderRadius: 3, padding: '1px 6px', width: 'fit-content',
                        }}>{v.service_type}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {SERVICE_LABEL[v.service_type] ?? 'ODP Service'}
                        </span>
                      </div>
                    </td>

                    <td>
                      <TimeRange clockIn={v.scheduled_start} clockOut={v.scheduled_end} />
                    </td>

                    {/* Time range */}
                    <td>
                      <TimeRange clockIn={v.clock_in} clockOut={v.clock_out} />
                    </td>

                    {/* Hours (regular + OT) */}
                    <td>
                      <HoursCell regular={v.regular_hours} ot={v.ot_hours} />
                    </td>

                    {/* Pay rate */}
                    <td>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>${v.pay_rate.toFixed(2)}</span>
                    </td>

                    {/* Gross pay */}
                    <td>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>${v.gross_pay.toFixed(2)}</span>
                    </td>

                    {/* Approval / payroll status */}
                    <td>
                      <span className={`status ${APPROVAL_CLS[v.approval_status] ?? ''}`}>
                        {v.approval_status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td>
                      <TimesheetApproveBtn entry={v} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div>
            {total === 0 ? 'No records' : `Showing ${startRow}–${endRow} of ${total} entries`}
          </div>
          <div className="page-controls">
            {page > 1
              ? <Link href={buildPageHref(search, week, page - 1)} className="page-btn">‹</Link>
              : <div className="page-btn" style={{ opacity: 0.35, cursor: 'default' }}>‹</div>}

            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const currentPage = start + i;
              if (currentPage < 1 || currentPage > totalPages) return null;
              return (
                <Link
                  key={currentPage}
                  href={buildPageHref(search, week, currentPage)}
                  className={`page-btn${currentPage === page ? ' active' : ''}`}
                >
                  {currentPage}
                </Link>
              );
            })}

            {page < totalPages
              ? <Link href={buildPageHref(search, week, page + 1)} className="page-btn">›</Link>
              : <div className="page-btn" style={{ opacity: 0.35, cursor: 'default' }}>›</div>}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
