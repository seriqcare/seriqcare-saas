'use client';

import { useState } from 'react';
import Link from 'next/link';

type Caregiver = { id: number; name: string };

function buildHref(cgId: string, mode: string, dateStr: string, search: string) {
  const p = new URLSearchParams();
  if (mode) p.set('mode', mode);
  if (dateStr) p.set('date', dateStr);
  if (search) p.set('search', search);
  if (cgId) p.set('caregiver', cgId);
  const q = p.toString();
  return q ? `/schedule?${q}` : '/schedule';
}

export function CaregiverSidebar({
  caregivers,
  filterCaregiver,
  mode,
  dateStr,
  search: searchParam,
}: {
  caregivers: Caregiver[];
  filterCaregiver: string;
  mode: string;
  dateStr: string;
  search: string;
}) {
  const [search, setSearch] = useState('');

  const filtered = caregivers.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  function initials(name: string) {
    return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  }

  const AVATAR_COLORS = [
    '#e97c3a', '#2567a4', '#35693c', '#7a3ab0', '#c4831e',
    '#1F8C8A', '#d56b6b', '#3a6ae9',
  ];
  function avatarColor(id: number) {
    return AVATAR_COLORS[id % AVATAR_COLORS.length];
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 20 }}>
      {/* Search */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)', background: '#f8fafc' }}>
        <input
          className="input"
          style={{ fontSize: 11, padding: '5px 9px' }}
          placeholder="Search by team, staff or client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Caregiver list */}
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {/* All row */}
        <Link
          href={buildHref('', mode, dateStr, searchParam)}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px',
            borderBottom: '1px solid var(--line-soft)', textDecoration: 'none',
            background: !filterCaregiver ? 'var(--primary-soft)' : 'transparent',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: !filterCaregiver ? 'var(--primary)' : '#e9eef4',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 800,
            color: !filterCaregiver ? '#fff' : 'var(--muted)',
          }}>ALL</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: !filterCaregiver ? 'var(--primary)' : 'var(--text)' }}>
              All Caregivers
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{caregivers.length} staff</div>
          </div>
        </Link>

        {filtered.map((c) => {
          const isActive = filterCaregiver === String(c.id);
          const color = avatarColor(c.id);
          return (
            <Link
              key={c.id}
              href={buildHref(String(c.id), mode, dateStr, searchParam)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px',
                borderBottom: '1px solid var(--line-soft)', textDecoration: 'none',
                background: isActive ? 'var(--primary-soft)' : 'transparent',
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: color, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 800,
              }}>
                {initials(c.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? 'var(--primary)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--primary)', marginTop: 1 }}>View Availability</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>0.00 Hours · $0.00</div>
              </div>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ padding: '16px 12px', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
            No matches
          </div>
        )}
      </div>

      {/* Add Caregiver */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line-soft)', background: '#f8fafc' }}>
        <Link
          href="/caregivers"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 0', borderRadius: 7, border: '1.5px dashed var(--primary)',
            fontSize: 12, fontWeight: 700, color: 'var(--primary)', textDecoration: 'none',
            background: 'var(--primary-soft)',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Caregiver
        </Link>
      </div>
    </div>
  );
}
