'use client';

import { useState } from 'react';

const ESC_CODES = [
  { code: 'ESC 927',  label: 'Payer/Waiver Mismatch',    severity: 'deny',          desc: 'Visit payer or waiver does not match client enrollment. Denied by aggregator.' },
  { code: 'ESC 928',  label: 'Client/Provider Not Found', severity: 'deny',          desc: 'Client or provider record not found in Sandata. Verify enrollment and resubmit.' },
  { code: 'ESC 5000', label: 'Duplicate Modifier',        severity: 'informational', desc: 'Duplicate service modifier detected on visit. Informational — review before billing.' },
  { code: 'ESC 901',  label: 'Missing GPS Coordinates',   severity: 'warning',       desc: 'Clock-in or clock-out location data missing. Required for PA-DHS EVV compliance.' },
  { code: 'ESC 902',  label: 'Clock-In/Out Missing',      severity: 'deny',          desc: 'Visit has no valid clock-in or clock-out timestamp. Cannot process or bill.' },
];

const SEV_COLOR: Record<string, string> = {
  deny:          '#d56b6b',
  warning:       '#c4831e',
  informational: '#2567a4',
};
const SEV_BG: Record<string, string> = {
  deny:          '#fdf4f4',
  warning:       '#fdf6ec',
  informational: '#eef5fb',
};

export function EscCodePanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      {/* Header — always visible, click to toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', background: 'none', border: 'none',
          cursor: 'pointer', padding: 0, textAlign: 'left',
        }}
      >
        <div>
          <div className="card-title">Sandata ESC Exception Code Reference</div>
          <div className="card-subtitle">PA-DHS EVV aggregator response codes · denial and informational reasons</div>
        </div>
        <div style={{
          width: 24, height: 24, borderRadius: 4, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'var(--primary-soft)',
          border: '1px solid var(--primary)30', flexShrink: 0, marginLeft: 12,
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 6" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l4 4 4-4" />
          </svg>
        </div>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {ESC_CODES.map((e) => (
            <div
              key={e.code}
              style={{
                display: 'flex', gap: 14, padding: '12px 14px',
                border: `1px solid ${SEV_COLOR[e.severity]}30`,
                borderRadius: 6, background: SEV_BG[e.severity],
              }}
            >
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: SEV_COLOR[e.severity] }}>{e.code}</div>
                <div style={{ marginTop: 3 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: SEV_COLOR[e.severity],
                    background: SEV_COLOR[e.severity] + '20', padding: '2px 6px',
                    borderRadius: 3, textTransform: 'uppercase',
                  }}>
                    {e.severity}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{e.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{e.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
