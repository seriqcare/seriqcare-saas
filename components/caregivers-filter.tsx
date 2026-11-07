'use client';
import { useRouter, useSearchParams } from 'next/navigation';

const TABS = ['All', 'Active', 'On Leave', 'Inactive'] as const;

export function CaregiversFilter() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get('status') ?? '';

  function go(s: string) {
    const params = new URLSearchParams(sp.toString());
    if (s && s !== 'All') params.set('status', s);
    else params.delete('status');
    params.delete('page');
    router.push(`/caregivers?${params.toString()}`);
  }

  return (
    <div className="status-tabs">
      {TABS.map((s) => {
        const active = s === 'All' ? !current : current === s;
        return (
          <div
            key={s}
            className={`status-tab${active ? ' active' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => go(s)}
          >
            {s}
          </div>
        );
      })}
    </div>
  );
}
