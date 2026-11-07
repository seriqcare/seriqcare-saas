import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';

export default function ClaimsPage() {
  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">Claims</h1>
          <p className="page-subtitle">Track claim status, denials, resubmissions, and payer adjudications.</p>
        </div>
        <div className="top-actions">
          <HeaderUser />
        </div>
      </div>
      <div className="card">
        <div className="coming-soon-wrap" style={{ minHeight: 260 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b0bec5" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8L14 2z"/><path d="M14 2v6h6"/><path d="M8 10h8M8 14h8M8 18h5"/>
          </svg>
          <div className="coming-soon-label">Claims — Coming Soon</div>
          <div className="coming-soon-sub">Phase 6 · 837P submission · Denial management · ERA reconciliation</div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
