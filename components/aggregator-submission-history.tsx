import Link from 'next/link';
import { getAggregatorSubmissions } from '@/lib/queries/aggregator';

const STATUS_CLASS: Record<string, string> = { Accepted: 'active', Rejected: 'flag', Failed: 'flag', Pending: 'hold', Submitted: 'pending' };

export async function AggregatorSubmissionHistory() {
  const result = await getAggregatorSubmissions(1, 5, '', 'sandata').then(
    data => ({ data, error: false }),
    () => ({ data: null, error: true }),
  );
  return <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
    <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div className="card-title">Sandata Aggregator Submission History</div>
        <div className="card-subtitle">Recent visit submissions for this agency</div>
      </div>
      <Link href="/evv?aggregator=sandata&tab=history" className="action-link">View full history</Link>
    </div>
    {result.error ? <p role="alert" style={{ padding: '16px 18px', color: 'var(--danger-text)', fontSize: 12 }}>Unable to load submission history. Please try again.</p>
      : result.data?.items.length === 0 ? <p style={{ padding: '16px 18px', color: 'var(--muted)', fontSize: 12 }}>No Sandata submissions for this agency yet.</p>
        : <div className="table-scroll"><table>
          <thead><tr><th>Transaction ID</th><th>Type</th><th>Submitted</th><th>Client</th><th>Status</th><th>Response</th></tr></thead>
          <tbody>{result.data?.items.map(submission => <tr key={submission.id}>
            <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--primary)' }}>{submission.transaction_id || '—'}</td>
            <td>{submission.submission_type}</td>
            <td>{submission.submitted_at || '—'}</td>
            <td>{submission.client_name || '—'}</td>
            <td><span className={`status ${STATUS_CLASS[submission.status] || ''}`}>{submission.status}</span></td>
            <td style={{ fontSize: 12, maxWidth: 260, overflowWrap: 'anywhere' }}>{submission.response_message || '—'}</td>
          </tr>)}</tbody>
        </table></div>}
  </div>;
}
