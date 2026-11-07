'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const DEFAULT_OPTIONS = [
  { value: 'current', label: 'This Week' },
  { value: 'last2',   label: 'Last 2 Weeks' },
  { value: 'last4',   label: 'Last 4 Weeks' },
];

export function VisitPeriodSelect({
  current,
  options = DEFAULT_OPTIONS,
}: {
  current: string;
  options?: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('week', value);
    params.delete('page'); // reset to page 1 on period change
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 34, borderRadius: 4, fontSize: 12, fontWeight: 600,
        border: '1px solid var(--line)', background: '#fff',
        color: 'var(--text)', padding: '0 10px', cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
