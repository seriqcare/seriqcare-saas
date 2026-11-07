'use client';
import { useState } from 'react';

interface Props {
  /** Server-rendered Claims Queue section */
  queue: React.ReactNode;
  /** Server-rendered Billing History section */
  history: React.ReactNode;
}

/**
 * Top-level toggle between the Claims Queue and Billing History sections.
 * Both sections are server-rendered (passed as children); this component
 * only manages the active-tab state locally.
 */
export function BillingClaimsPanel({ queue, history }: Props) {
  const [active, setActive] = useState<'queue' | 'history'>('queue');

  return (
    <div>
      {/* Section toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(
          [
            { key: 'queue',   label: 'Claims Queue' },
            { key: 'history', label: 'Billing History' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: active === key ? '1px solid #2567a4' : '1px solid var(--line)',
              background: active === key ? '#2567a4' : '#fff',
              color: active === key ? '#fff' : 'var(--text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {active === 'queue' ? queue : history}
    </div>
  );
}
