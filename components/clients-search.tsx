'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

export function ClientsSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get('search') ?? '');

  const commit = useCallback(
    (v: string) => {
      const params = new URLSearchParams(sp.toString());
      if (v.trim()) params.set('search', v.trim());
      else params.delete('search');
      params.delete('page');
      router.push(`/clients?${params.toString()}`);
    },
    [router, sp],
  );

  return (
    <input
      className="search"
      placeholder="Search name, caregiver, or MA ID…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit(value)}
      onBlur={() => commit(value)}
      style={{ cursor: 'text', color: 'var(--text)' }}
    />
  );
}
