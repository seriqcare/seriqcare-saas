import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';

export default function ReportsPage() {
  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Operational, compliance, and financial reports for PA-DHS and internal review.</p>
        </div>
        <div className="top-actions">
          <HeaderUser />
        </div>
      </div>
      <div className="card">
        <div className="coming-soon-wrap" style={{ minHeight: 260 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b0bec5" strokeWidth="1.5">
            <path d="M3 22V3"/><path d="M3 22h21"/><path d="M6 17V13M9 17V9M12 17V11M15 17V6M18 17V4"/>
          </svg>
          <div className="coming-soon-label">Reports — Coming Soon</div>
          <div className="coming-soon-sub">EVV compliance reports · Payroll exports · PA-DHS audit readiness</div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
