'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { TimesheetEntry } from '@/lib/queries/timesheets';
import { useAuth } from '@/components/auth-context';

interface Props {
  entry: TimesheetEntry;
}

export function TimesheetApproveBtn({ entry }: Props) {
  const router = useRouter();
  const { apiFetch } = useAuth();
  const [busy,   setBusy]   = useState(false);
  const [done,   setDone]   = useState(false);
  const [error,  setError]  = useState('');
  const [editing, setEditing] = useState(false);

  const { visit_id: visitId, approval_status: approvalStatus } = entry;

  if (approvalStatus !== 'Pending') {
    return <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>;
  }

  async function handleApprove() {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`/api/timesheets/${visitId}/approve`, { method: 'PATCH' });
      if (res.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? 'Approval failed.');
    } catch {
      setError('Could not reach server.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>✓ Approved</span>;
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="action-link"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            className="action-link"
            style={{ background: 'none', border: 'none', padding: 0, cursor: busy ? 'not-allowed' : 'pointer' }}
            disabled={busy}
            onClick={handleApprove}
          >
            {busy ? '…' : 'Approve'}
          </button>
        </div>
        {error && (
          <span style={{ fontSize: 10, color: '#dc2626' }}>{error}</span>
        )}
      </div>

      {editing && <EditTimesheetModal entry={entry} onClose={() => setEditing(false)} />}
    </>
  );
}

function EditTimesheetModal({ entry, onClose }: { entry: TimesheetEntry; onClose: () => void }) {
  const router = useRouter();
  const { apiFetch } = useAuth();
  const [scheduledStart, setScheduledStart] = useState(toTimeValue(entry.scheduled_start));
  const [scheduledEnd, setScheduledEnd] = useState(toTimeValue(entry.scheduled_end));
  const [clockIn, setClockIn] = useState(toTimeValue(entry.clock_in));
  const [clockOut, setClockOut] = useState(toTimeValue(entry.clock_out));
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function isInFuture(timeValue: string): boolean {
    if (!timeValue || !entry.service_date) return false;
    const [year, month, day] = entry.service_date.split('-').map(Number);
    const [hours, minutes] = timeValue.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes) > new Date();
  }

  async function handleSave() {
    if (!notes.trim()) {
      setError('Notes are required to edit a timesheet.');
      return;
    }
    if (clockOut && isInFuture(clockOut)) {
      setError('Clock Out cannot be set to a future time.');
      return;
    }
    if (clockIn && isInFuture(clockIn)) {
      setError('Clock In cannot be set to a future time.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/api/timesheets/${entry.visit_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduled_start: scheduledStart || undefined,
          scheduled_end: scheduledEnd || undefined,
          clock_in: clockIn || undefined,
          clock_out: clockOut || undefined,
          notes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? 'Update failed.');
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError('Could not reach server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 520, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 2 }}>EDIT PAYROLL ENTRY</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{entry.client_name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{entry.first_name} {entry.last_name} · {entry.service_date}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Scheduled Start</label>
              <input className="form-input" type="time" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Scheduled End</label>
              <input className="form-input" type="time" value={scheduledEnd} onChange={(event) => setScheduledEnd(event.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Clock In</label>
              <input className="form-input" type="time" value={clockIn} onChange={(event) => setClockIn(event.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Clock Out</label>
              <input
                className="form-input"
                type="time"
                value={clockOut}
                onChange={(event) => { setClockOut(event.target.value); setError(''); }}
                style={clockOut && isInFuture(clockOut) ? { borderColor: '#dc2626' } : undefined}
              />
              {clockOut && isInFuture(clockOut) && (
                <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>Cannot be a future time.</div>
              )}
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Notes <span style={{ color: '#dc2626' }}>*</span></label>
            <textarea className="form-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} style={{ minHeight: 86 }} required />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>A note is required whenever a payroll entry is edited.</div>
          </div>
        </div>

        {error ? <div style={{ marginTop: 12, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{error}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={handleSave} disabled={saving || !clockIn || !clockOut || !notes.trim() || isInFuture(clockOut) || isInFuture(clockIn)}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function toTimeValue(value: string | null): string {
  if (!value) return '';
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return '';
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}
