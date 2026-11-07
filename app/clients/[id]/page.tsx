import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { getClients } from '@/lib/queries/clients';
import { ClientTabs } from '@/components/client-tabs';

export const dynamic = 'force-dynamic';

const STATUS_CLS: Record<string, string> = {
  Active:     'active',
  Pending:    'pending',
  'On Hold':  'hold',
  Discharged: 'hold',
};

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);

  const data = await getClients(1, 100);
  const client = data.items.find((c) => c.id === numericId);

  if (!client) {
    return (
      <ProtectedLayout>
        <div className="topbar">
          <Link href="/clients" className="action-link" style={{ fontSize: 13 }}>
            ← Back to Clients
          </Link>
          <HeaderUser />
        </div>
        <div className="card" style={{ marginTop: 20 }}>
          <div className="coming-soon-wrap" style={{ minHeight: 200 }}>
            <div className="coming-soon-label">Client #{id} not found</div>
            <div className="coming-soon-sub">
              <Link href="/clients" style={{ color: 'var(--primary)' }}>Return to client directory</Link>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout>
      {/* ── Breadcrumb topbar ────────────────────────── */}
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <Link href="/clients" style={{ color: 'var(--muted)' }}>Clients</Link>
          <span>›</span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{client.name}</span>
        </div>
        <div className="top-actions">
          <Link href="/schedule" className="btn" style={{ fontSize: 12, height: 32, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 1v12M1 7h12"/>
            </svg>
            Schedule Visit
          </Link>
          <HeaderUser />
        </div>
      </div>

      {/* ── Tab card ─────────────────────────────────── */}
      <div className="card" style={{ padding: '18px 20px' }}>
        {/* At a Glance strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20, paddingBottom: 18, borderBottom: '1px solid var(--line-soft)' }}>
          {[
            { label: 'Next Visit',    value: client.next_visit ? client.next_visit.split(' ')[0] : '—' },
            { label: 'Total Visits',  value: '47' },
            { label: 'Care Plan',     value: client.care_plan_status, flag: client.care_plan_status === 'Overdue' },
            { label: 'Active Auths',  value: '3' },
          ].map(({ label, value, flag }) => (
            <div key={label} style={{ textAlign: 'center', padding: '12px 10px', border: '1px solid var(--line-soft)', borderRadius: 8, background: 'var(--surface-soft)' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: flag ? '#d56b6b' : 'var(--text)', marginBottom: 4 }}>{value}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Client name + status header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg,#d7e8f6,#2567a4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {initials(client.name)}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{client.name}</span>
              <span className={`status ${STATUS_CLS[client.status] ?? ''}`}>{client.status}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {client.client_code}{client.age != null ? ` · Age ${client.age}` : ''}{client.city ? ` · ${client.city}, ${client.state ?? 'PA'}` : ''}
            </div>
          </div>
        </div>

        <ClientTabs client={client} clientId={numericId} />
      </div>
    </ProtectedLayout>
  );
}
