import { ProtectedLayout } from '@/components/protected-layout';

export default function Loading() {
  return <ProtectedLayout>
    <div role="status" aria-live="polite" aria-label="Loading page" style={{ display: 'grid', gap: 16 }}>
      <div className="topbar overview-topbar"><p className="page-subtitle">Loading page…</p></div>
      <div className="summary-row" aria-hidden="true">
        {[0, 1, 2, 3].map(id => <div key={id} className="summary-card" style={{ minHeight: 74 }} />)}
      </div>
      <div className="card" style={{ minHeight: 240 }} aria-hidden="true" />
    </div>
  </ProtectedLayout>;
}
