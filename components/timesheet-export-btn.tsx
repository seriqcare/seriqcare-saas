'use client';

import { useState, useEffect } from 'react';
import { ProviderId, getProvider, PAYROLL_PROVIDER_KEY } from '@/lib/payroll/providers';
import { generateCsv, toUniversalRecord, triggerDownload, validateExport } from '@/lib/payroll/export';
import type { TimesheetEntry } from '@/lib/queries/timesheets';
import { useAuth } from '@/components/auth-context';

export function TimesheetExportBtn({ period = 'pay_current' }: { period?: string }) {
  const { apiFetch } = useAuth();
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');
  const [providerId,   setProviderId]   = useState<ProviderId>('universal');

  useEffect(() => {
    const stored = localStorage.getItem(PAYROLL_PROVIDER_KEY) as ProviderId | null;
    if (stored) setProviderId(stored);

    // re-read when storage changes (e.g. user saved in Settings)
    const handler = (e: StorageEvent) => {
      if (e.key === PAYROLL_PROVIDER_KEY && e.newValue) {
        setProviderId(e.newValue as ProviderId);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const provider = getProvider(providerId);

  async function fetchApprovedTimesheets(): Promise<TimesheetEntry[]> {
    try {
      const query = new URLSearchParams({ page: '1', per_page: '500', week: period, status: 'Approved' });
      const res = await apiFetch(`/api/timesheets?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        return data.items ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  async function handleExport() {
    setBusy(true);
    setError('');
    try {
      const items = await fetchApprovedTimesheets();
      if (items.length === 0) { setError('No approved timesheets to export.'); return; }

      const records = items.map((v) => toUniversalRecord(v));
      const errs    = validateExport(records, providerId);
      if (errs.length > 0) { setError(errs[0]); return; }

      const csv  = generateCsv(records, providerId);
      const date = new Date().toISOString().split('T')[0];
      triggerDownload(csv, `seriqcare_timesheets_${provider.id}_${date}.csv`);
    } catch {
      setError('Export failed — check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="btn secondary" onClick={handleExport} disabled={busy}>
          {busy ? 'Exporting…' : 'Export Payroll'}
        </button>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--primary)',
          background: 'var(--primary-light, #eef2ff)',
          border: '1px solid var(--primary)',
          borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap',
        }}>
          {provider.name}
        </span>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: '#dc2626', maxWidth: 260, textAlign: 'right' }}>
          {error}
        </div>
      )}
    </div>
  );
}
