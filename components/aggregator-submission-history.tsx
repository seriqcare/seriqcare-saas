import Link from 'next/link';
import styles from '@/app/visits/visits.module.css';
import { getAggregatorSubmissions } from '@/lib/queries/aggregator';

const STATUS_CLASS: Record<string, string> = { Accepted: 'active', Rejected: 'flag', Failed: 'flag', Pending: 'hold', Submitted: 'pending' };

export async function AggregatorSubmissionHistory({ page = 1, query = {} }: { page?: number; query?: Record<string, string> } = {}) {
  const perPage = 4;
  const pageHref = (value: number) => {
    const params = new URLSearchParams(query);
    if (value > 1) params.set('historyPage', String(value)); else params.delete('historyPage');
    return `/visits${params.size ? `?${params}` : ''}`;
  };
  const result = await getAggregatorSubmissions(page, perPage, '', 'sandata').then(
    data => ({ data, error: false }),
    () => ({ data: null, error: true }),
  );
  const total = result.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const count = result.data?.items.length ?? 0;
  return <div className={`card aggregator-submission-history ${styles.historyCard}`} style={{ padding: 0, overflow: 'hidden' }}>
    <div className={styles.historyHeader} style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div className="card-title">Sandata Aggregator Submission History</div>
        <div className="card-subtitle">Recent visit submissions for this agency</div>
      </div>
      <Link href="/evv?aggregator=sandata&tab=history" className="action-link">View full history</Link>
    </div>
    <div className={styles.historyTableBody}>
    {result.error ? <p role="alert" style={{ padding: '16px 18px', color: 'var(--danger-text)', fontSize: 12 }}>Unable to load submission history. Please try again.</p>
      : result.data?.items.length === 0 ? <p style={{ padding: '16px 18px', color: 'var(--muted)', fontSize: 12 }}>No Sandata submissions for this agency yet.</p>
        : <div className="table-scroll"><table>
          <colgroup>{[18, 7, 19, 18, 12, 26].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
          <thead><tr><th>Transaction ID</th><th>Type</th><th>Submitted</th><th>Client</th><th>Status</th><th>Response</th></tr></thead>
          <tbody>{result.data?.items.map(submission => <tr key={submission.id}>
            <td title={submission.transaction_id || undefined} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--primary)' }}>{submission.transaction_id || '—'}</td>
            <td>{submission.submission_type}</td>
            <td>{submission.submitted_at || '—'}</td>
            <td title={submission.client_name || undefined}>{submission.client_name || '—'}</td>
            <td><span className={`status ${STATUS_CLASS[submission.status] || ''}`}>{submission.status}</span></td>
            <td title={submission.response_message || undefined} style={{ fontSize: 12, maxWidth: 260, overflowWrap: 'anywhere' }}><span className="submission-response">{submission.response_message || '—'}</span></td>
          </tr>)}</tbody>
        </table></div>}
    </div>
    <div className={`pagination ${styles.tableFooter}`} style={{ padding: '8px 12px' }}>
      <div>Showing {count ? (page - 1) * perPage + 1 : 0}–{count ? (page - 1) * perPage + count : 0} of {total} submissions</div>
      <nav className="page-controls" aria-label="Submission history pages">
        {page > 1
          ? <Link href={pageHref(page - 1)} className="page-btn" aria-label="Previous history page">{'\u2039'}</Link>
          : <span className="page-btn" aria-disabled="true" style={{ opacity: 0.35 }}>{'\u2039'}</span>}
        {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
          const value = Math.max(1, Math.min(page - 2, totalPages - 4)) + index;
          return <Link key={value} href={pageHref(value)} className={`page-btn${value === page ? ' active' : ''}`} aria-label={`History page ${value}`} aria-current={value === page ? 'page' : undefined}>{value}</Link>;
        })}
        {page < totalPages
          ? <Link href={pageHref(page + 1)} className="page-btn" aria-label="Next history page">{'\u203a'}</Link>
          : <span className="page-btn" aria-disabled="true" style={{ opacity: 0.35 }}>{'\u203a'}</span>}
      </nav>
    </div>
  </div>;
}
