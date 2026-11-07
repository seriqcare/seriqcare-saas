import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { EvvAggregatorPanel } from '@/components/evv-aggregator-panel';
import { AggregatorTabs } from '@/components/aggregator-tabs';
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
  searchParams: Promise<{ aggregator?: string }>;
}) {
  const { aggregator = '' } = await searchParams;

  const [queue, submissions] = await Promise.all([
    getAggregatorQueue(aggregator),
    getAggregatorSubmissions(1, 50, '', aggregator),
  ]);

  // Derive stats from submission history
  const accepted = submissions.items.filter(s => s.status === 'Accepted').length;
  const rejected = submissions.items.filter(s => s.status === 'Rejected' || s.status === 'Error').length;
  const pending  = submissions.items.filter(s => s.status === 'Pending').length;

  const modeColor = queue.mode === 'live' ? '#35693c' : '#2567a4';

  const subtitle = SUBTITLES[aggregator] ?? SUBTITLES[''];
  const aggLabel = aggregator === 'hhax' ? 'HHAeXchange' : aggregator === 'sandata' ? 'Sandata' : 'EVV';

  return (
    <ProtectedLayout>
      {/* ── Top bar ── */}
      <div className="topbar">
        <div className="topbar-left">
          <div className="page-title">{aggLabel} Aggregator</div>
          <div className="page-subtitle">{subtitle}</div>
        </div>
        <div className="topbar-right"><HeaderUser /></div>
      </div>

      {/* ── Aggregator tabs ── */}
      <AggregatorTabs />

      {/* ── Stats row ── */}
      <div className="kpi-row" style={{ marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: modeColor }}>{queue.total}</div>
          <div className="kpi-label">Queued</div>
          <div className="kpi-sub">Ready to submit</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{submissions.total}</div>
          <div className="kpi-label">Total Submissions</div>
          <div className="kpi-sub">{aggregator ? `${aggLabel} all time` : 'All aggregators'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: '#35693c' }}>{accepted}</div>
          <div className="kpi-label">Accepted</div>
          <div className="kpi-sub">Successfully processed</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: rejected > 0 ? '#d56b6b' : 'inherit' }}>{rejected}</div>
          <div className="kpi-label">Rejected / Error</div>
          <div className="kpi-sub">Require attention</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: pending > 0 ? '#c4831e' : 'inherit' }}>{pending}</div>
          <div className="kpi-label">Pending</div>
          <div className="kpi-sub">Awaiting response</div>
        </div>
      </div>

      {/* ── ESC Code reference (only when there are rejections) ── */}
      {rejected > 0 && (
        <div className="alert-list" style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            {aggLabel} ESC Codes — Action Required
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
      )}

      {/* ── Interactive queue + history panel ── */}
      <div className="detail-section">
        <EvvAggregatorPanel
          initialQueue={queue.items}
          initialHistory={submissions.items}
          historyTotal={submissions.total}
          mode={queue.mode}
          aggregator={aggregator}
        />
      </div>
    </ProtectedLayout>
  );
}
