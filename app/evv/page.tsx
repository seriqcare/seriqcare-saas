import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { EvvAggregatorPanel } from '@/components/evv-aggregator-panel';
import { AggregatorTabs } from '@/components/aggregator-tabs';
import styles from './evv.module.css';
import {
  getAggregatorQueue,
  getAggregatorSubmissions,
} from '@/lib/queries/aggregator';

export const dynamic = 'force-dynamic';

const SUBTITLES: Record<string, string> = {
  sandata: 'Sandata PA-DHS v1.4 · ODP Consolidated Waiver EVV Submission',
  hhax:    'HHAeXchange PA · PDA / MA EVV Submission',
  '':      'Sandata PA-DHS v1.4 · HHAeXchange PA · ODP / PDA / MA EVV Submission',
};

export default async function EVVPage({
  searchParams,
}: {
  searchParams: Promise<{ aggregator?: string; tab?: string; history_page?: string }>;
}) {
  const { aggregator = '', tab, history_page = '1' } = await searchParams;
  const historyPage = Math.max(1, parseInt(history_page, 10) || 1);

  const [queueResult, submissionsResult] = await Promise.allSettled([
    getAggregatorQueue(aggregator),
    getAggregatorSubmissions(historyPage, 5, '', aggregator),
  ]);
  if (queueResult.status === 'rejected' || submissionsResult.status === 'rejected') {
    const retry = `/evv?${new URLSearchParams({ aggregator, tab: tab === 'history' ? 'history' : 'queue', history_page: String(historyPage) })}`;
    return <ProtectedLayout className={styles.workspace}>
      <div className="topbar overview-topbar">
        <h1 className="page-title">EVV Aggregator</h1>
        <div className="top-actions"><AggregatorTabs compact /></div>
      </div>
      <div className="card" role="alert">
        <div className="card-title">Unable to load submission data</div>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Please reload the page and try again.</p>
        <a href={retry} className="action-link">Reload history</a>
        <span style={{ margin: '0 10px' }}>·</span>
        <Link href="/visits" className="action-link">Back to Visits</Link>
      </div>
    </ProtectedLayout>;
  }
  const queue = queueResult.value;
  const submissions = submissionsResult.value;

  // Derive stats from submission history
  const accepted = submissions.items.filter(s => s.status === 'Accepted').length;
  const rejected = submissions.items.filter(s => s.status === 'Rejected' || s.status === 'Error').length;
  const pending  = submissions.items.filter(s => s.status === 'Pending').length;

  const modeColor = queue.mode === 'live' ? '#35693c' : '#2567a4';

  const subtitle = SUBTITLES[aggregator] ?? SUBTITLES[''];
  const aggLabel = aggregator === 'hhax' ? 'HHAeXchange' : aggregator === 'sandata' ? 'Sandata' : 'EVV';

  return (
    <ProtectedLayout className={styles.workspace}>
      {/* ── Top bar ── */}
      <div className="topbar overview-topbar">
        <div className="topbar-left">
          <div className="page-title">{aggLabel} Aggregator</div>
          <div className="page-subtitle">{subtitle}</div>
        </div>
        <div className="top-actions"><AggregatorTabs compact /></div>
      </div>

      {/* ── Aggregator tabs ── */}

      {/* ── Stats row ── */}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <div className={styles.value} style={{ color: modeColor }}>{queue.total}</div>
          <div className={styles.label}>Queued</div>
          <div className={styles.sub}>Ready to submit</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.value}>{submissions.total}</div>
          <div className={styles.label}>Total Submissions</div>
          <div className={styles.sub}>{aggregator ? `${aggLabel} all time` : 'All aggregators'}</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.value} style={{ color: '#35693c' }}>{accepted}</div>
          <div className={styles.label}>Accepted</div>
          <div className={styles.sub}>On this history page</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.value} style={{ color: rejected > 0 ? '#d56b6b' : 'inherit' }}>{rejected}</div>
          <div className={styles.label}>Rejected / Error</div>
          <div className={styles.sub}>On this history page</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.value} style={{ color: pending > 0 ? '#c4831e' : 'inherit' }}>{pending}</div>
          <div className={styles.label}>Pending</div>
          <div className={styles.sub}>On this history page</div>
        </div>
      </div>

      {/* ── Always-visible ESC code reference ── */}
      <section className={styles.reference} aria-label="ESC Code Reference">
        <div className={styles.referenceHeading}>ESC Code Reference</div>
        <div className={styles.referenceBody}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            {aggLabel} ESC Codes
          </div>
          {[
            { code: 'ESC 927', label: 'Payer/Waiver Mismatch',    cls: 'red',   desc: 'Visit payer or waiver does not match client enrollment. Denied.' },
            { code: 'ESC 928', label: 'Client/Provider Not Found', cls: 'red',   desc: 'Client or provider record not found. Verify enrollment.' },
            { code: 'ESC 902', label: 'Clock-In/Out Missing',      cls: 'red',   desc: 'Visit has no valid clock-in/out timestamp. Cannot bill.' },
            { code: 'ESC 5000', label: 'Duplicate Modifier',       cls: 'blue',  desc: 'Duplicate modifier — informational, review before billing.' },
          ].map(e => (
            <div key={e.code} className="alert-item" style={{ alignItems: 'flex-start' }}>
              <span className={`alert-dot ${e.cls}`} />
              <div>
                <strong style={{ fontSize: 12 }}>{e.code} — {e.label}</strong>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{e.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Interactive queue + history panel ── */}
      <div className={`card ${styles.panel}`}>
        <EvvAggregatorPanel
          initialQueue={queue.items}
          initialHistory={submissions.items}
          historyTotal={submissions.total}
          mode={queue.mode}
          aggregator={aggregator}
          initialTab={tab === 'history' || historyPage > 1 ? 'history' : 'queue'}
          historyPage={historyPage}
        />
      </div>
    </ProtectedLayout>
  );
}
