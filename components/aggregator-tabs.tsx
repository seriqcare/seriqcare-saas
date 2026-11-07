'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AGGREGATOR_SANDATA_KEY, AGGREGATOR_HHAX_KEY } from './aggregator-off-banner';

interface AggregatorConfig {
  sandataEnabled: boolean;
  hhaxEnabled: boolean;
}

function readAggregatorConfig(): AggregatorConfig {
  try {
    const s = localStorage.getItem(AGGREGATOR_SANDATA_KEY);
    const h = localStorage.getItem(AGGREGATOR_HHAX_KEY);
    return {
      sandataEnabled: !!(s && JSON.parse(s).sandata_enabled),
      hhaxEnabled:    !!(h && JSON.parse(h).hhax_enabled),
    };
  } catch {
    return { sandataEnabled: false, hhaxEnabled: false };
  }
}

export function AggregatorTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get('aggregator') ?? '';

  const [cfg, setCfg] = useState<AggregatorConfig>({ sandataEnabled: false, hhaxEnabled: false });

  useEffect(() => {
    setCfg(readAggregatorConfig());
  }, []);

  if (!cfg.sandataEnabled && !cfg.hhaxEnabled) return null;

  function setAggregator(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set('aggregator', value);
    } else {
      next.delete('aggregator');
    }
    // Reset status filter and page when switching aggregator tabs
    next.delete('status');
    next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const tabs = [
    { label: 'All Visits', value: '' },
    ...(cfg.sandataEnabled ? [{ label: 'Sandata', value: 'sandata', dot: '#2567a4' }] : []),
    ...(cfg.hhaxEnabled    ? [{ label: 'HHAeXchange', value: 'hhax', dot: '#35693c' }] : []),
  ];

  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
      {tabs.map((tab) => {
        const active = tab.value === '' ? !current : current === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => setAggregator(tab.value)}
            style={{
              padding: '7px 16px',
              borderRadius: 7,
              border: active ? '1px solid #2567a4' : '1px solid var(--line)',
              background: active ? '#2567a4' : 'var(--surface)',
              color: active ? '#fff' : 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {'dot' in tab && tab.dot && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: active ? 'rgba(255,255,255,0.8)' : tab.dot,
                flexShrink: 0,
                display: 'inline-block',
              }} />
            )}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
