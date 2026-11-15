import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { getCaregivers } from '@/lib/queries/caregivers';
import { CaregiverDetail } from '@/components/caregiver-detail';
import intakeStyles from '@/components/intake-wizard.module.css';
import styles from '@/components/caregiver-detail.module.css';

export const dynamic = 'force-dynamic';

export default async function CaregiverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);

  const data = await getCaregivers(1, 100);
  const caregiver = data.items.find((c) => c.id === numericId);

  if (!caregiver) {
    return (
      <ProtectedLayout>
        <div className="topbar">
          <Link href="/caregivers" className="action-link" style={{ fontSize: 13 }}>
            ← Back to Caregivers
          </Link>
        </div>
        <div className="card" style={{ marginTop: 20 }}>
          <div className="coming-soon-wrap" style={{ minHeight: 200 }}>
            <div className="coming-soon-label">Caregiver #{id} not found</div>
            <div className="coming-soon-sub">
              <Link href="/caregivers" style={{ color: 'var(--primary)' }}>Return to caregiver directory</Link>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout className={intakeStyles.shell}>
      <div className={styles.page}>
      {/* ── Breadcrumb topbar ────────────────────────── */}
      <div className={`topbar ${styles.topbar}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <Link href="/caregivers" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Caregivers</Link>
          <span>›</span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{caregiver.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            href={`/schedule?caregiver=${caregiver.id}`}
            className="btn secondary"
            style={{ fontSize: 11, height: 26, padding: '0 9px', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            View Schedule
          </Link>
        </div>
      </div>

      <CaregiverDetail caregiver={caregiver} />
      </div>
    </ProtectedLayout>
  );
}
