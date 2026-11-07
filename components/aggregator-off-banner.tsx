'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export const AGGREGATOR_SANDATA_KEY = 'seriqcare-aggregator-sandata';
export const AGGREGATOR_HHAX_KEY    = 'seriqcare-aggregator-hhax';

/** True when at least one aggregator is enabled. */
function anyAggregatorEnabled(): boolean {
  try {
    const s = localStorage.getItem(AGGREGATOR_SANDATA_KEY);
    if (s && JSON.parse(s).sandata_enabled) return true;
    const h = localStorage.getItem(AGGREGATOR_HHAX_KEY);
    if (h && JSON.parse(h).hhax_enabled) return true;
  } catch { /* ignore */ }
  return false;
}

export function AggregatorOffBanner() {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(!anyAggregatorEnabled());
  }, []);

  if (!show) return null;

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(15,30,48,0.55)',
        zIndex: 9998, backdropFilter: 'blur(2px)',
      }} />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        zIndex: 9999, width: 420, maxWidth: 'calc(100vw - 32px)',
        background: '#fff', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(15,30,48,0.25)',
        padding: '28px 28px 24px',
      }}>
        {/* Icon */}
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: '#fff6e7', border: '1px solid #eed6a6',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c4831e" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        <div style={{ fontSize: 16, fontWeight: 700, color: '#24343f', marginBottom: 8 }}>
          EVV Aggregator Not Configured
        </div>
        <div style={{ fontSize: 13, color: '#6a7a86', lineHeight: 1.7, marginBottom: 20 }}>
          No EVV aggregator is enabled for this agency. Visit submissions
          to Sandata or HHAeXchange will not work until at least one
          aggregator is configured and turned on.
        </div>

        <div style={{ background: '#f4f6f9', borderRadius: 8, padding: '12px 14px', marginBottom: 20, fontSize: 12, color: '#4a6070', lineHeight: 1.6 }}>
          <strong style={{ display: 'block', marginBottom: 4, color: '#24343f' }}>To enable:</strong>
          Go to <strong>Settings → Integrations → HR</strong>, enter credentials for
          Sandata PA (ODP services) and/or HHAeXchange PA (PDA/MA services),
          and toggle each one on independently.
        </div>

        <button
          onClick={() => router.push('/settings?tab=integrations')}
          style={{
            width: '100%', height: 42, borderRadius: 8, border: 'none',
            background: '#2567a4', color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Go to Aggregator Settings
        </button>
      </div>
    </>
  );
}
