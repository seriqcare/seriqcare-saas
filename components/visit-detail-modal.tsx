'use client';

import { useState } from 'react';
import type { VisitEntry } from '@/lib/queries/timesheets';
import { useAuth } from '@/components/auth-context';

const EVV_COLOR: Record<string, string> = {
  Ready:      '#35693c',
  Submitted:  '#2567a4',
  Incomplete: '#d56b6b',
  Omit:       '#c4831e',
};

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/* ── View Modal ─────────────────────────────────────── */
function ViewModal({ visit, onClose }: { visit: VisitEntry; onClose: () => void }) {
  const evvColor = EVV_COLOR[visit.evv_status] ?? '#2567a4';
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>VISIT RECORD</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
            #{String(visit.id).padStart(5, '0')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(visit.service_date)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: evvColor,
            background: evvColor + '18', padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${evvColor}30`,
          }}>
            {visit.evv_status}
          </span>
          <CloseBtn onClose={onClose} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <InfoCard title="Caregiver">
          <Row label="Name" value={visit.employee_name} />
          <Row label="Code" value={visit.employee_code} />
        </InfoCard>
        <InfoCard title="Client">
          <Row label="Name" value={visit.client_name} />
          <Row label="Date" value={visit.service_date} />
        </InfoCard>
        <InfoCard title="Clock Times">
          <Row label="Clock In"  value={visit.clock_in  ?? '—'} flag={!visit.clock_in} />
          <Row label="Clock Out" value={visit.clock_out ?? '—'} flag={!visit.clock_out} />
          <Row label="Total Hours" value={visit.total_hours.toFixed(2) + 'h'} />
        </InfoCard>
        <InfoCard title="GPS Coordinates">
          <Row label="In Lat"  value={visit.clock_in_lat  != null ? visit.clock_in_lat.toFixed(6)  : '—'} flag={visit.clock_in_lat == null} />
          <Row label="In Lon"  value={visit.clock_in_lon  != null ? visit.clock_in_lon.toFixed(6)  : '—'} flag={visit.clock_in_lon == null} />
          <Row label="Out Lat" value={visit.clock_out_lat != null ? visit.clock_out_lat.toFixed(6) : '—'} flag={visit.clock_out_lat == null} />
          <Row label="Out Lon" value={visit.clock_out_lon != null ? visit.clock_out_lon.toFixed(6) : '—'} flag={visit.clock_out_lon == null} />
        </InfoCard>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </Overlay>
  );
}

/* ── Fix / Edit Modal ───────────────────────────────── */
function FixModal({ visit, onClose, editMode = false }: { visit: VisitEntry; onClose: () => void; editMode?: boolean }) {
  const { apiFetch } = useAuth();
  const [clockIn,  setClockIn]  = useState(visit.clock_in  ?? '');
  const [clockOut, setClockOut] = useState(visit.clock_out ?? '');
  const [reason,   setReason]   = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [errMsg,   setErrMsg]   = useState('');
  const [notes,    setNotes]    = useState('');

  async function handleSave() {
    setSaving(true);
    setErrMsg('');
    try {
      const res = await apiFetch(`/api/visits/${visit.id}/fix`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          notes: notes || undefined,
          clock_in:  clockIn  || undefined,
          clock_out: clockOut || undefined,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => { window.location.reload(); }, 900);
      } else {
        const body = await res.json().catch(() => ({}));
        setErrMsg(body.detail || 'Save failed');
      }
    } catch {
      setErrMsg('Could not reach server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: editMode ? '#2567a4' : '#d56b6b', fontWeight: 700, marginBottom: 2 }}>{editMode ? 'EDIT VISIT RECORD' : 'FIX VISIT RECORD'}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
            #{String(visit.id).padStart(5, '0')} — {visit.client_name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(visit.service_date)}</div>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      {/* Issues summary — shown only in Fix mode when there are issues */}
      {!editMode && (!visit.clock_in || !visit.clock_out || visit.clock_in_lat == null || visit.clock_out_lat == null) && (
        <div style={{ background: '#fdf4f4', border: '1px solid #e6baba', borderRadius: 8, padding: '10px 14px', marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#d56b6b', marginBottom: 4 }}>Issues detected on this visit:</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {!visit.clock_in  && <div style={{ fontSize: 11, color: '#944949' }}>· Clock-in time is missing (ESC 902)</div>}
            {!visit.clock_out && <div style={{ fontSize: 11, color: '#944949' }}>· Clock-out time is missing (ESC 902)</div>}
            {visit.clock_in_lat  == null && <div style={{ fontSize: 11, color: '#944949' }}>· Clock-in GPS coordinates missing (ESC 901)</div>}
            {visit.clock_out_lat == null && <div style={{ fontSize: 11, color: '#944949' }}>· Clock-out GPS coordinates missing (ESC 901)</div>}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-field">
            <label className="form-label">Clock In Time <span className="req">*</span></label>
            <input className="form-input" type="text" placeholder="e.g. 09:00 AM" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Clock Out Time <span className="req">*</span></label>
            <input className="form-input" type="text" placeholder="e.g. 11:00 AM" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Correction Reason <span className="req">*</span></label>
          <select className="form-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select reason…</option>
            <option value="caregiver_forgot">Caregiver forgot to clock in/out</option>
            <option value="device_issue">Device or app issue</option>
            <option value="no_signal">No cellular signal at location</option>
            <option value="supervisor_correction">Supervisor data correction</option>
            <option value="other">Other — see notes</option>
          </select>
        </div>

        <div className="form-field">
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={2} placeholder="Optional additional context for this correction…" style={{ resize: 'vertical', lineHeight: 1.5 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
        This correction will be logged with your user ID and timestamp for audit purposes.
        GPS coordinates will be marked as supervisor-entered.
      </div>

      {errMsg && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fdf4f4', border: '1px solid #e6baba', borderRadius: 6, fontSize: 12, color: '#d56b6b', fontWeight: 600 }}>
          {errMsg}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn"
          onClick={handleSave}
          disabled={saving || !reason}
          style={{ minWidth: 100, background: saving || !reason ? undefined : '#d56b6b', borderColor: '#d56b6b' }}
        >
          {saving ? 'Saving…' : saved ? 'Saved!' : editMode ? 'Save' : 'Save Fix'}
        </button>
      </div>
    </Overlay>
  );
}

/* ── Shared overlay wrapper ─────────────────────────── */
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28,
        width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      }}>
        {children}
      </div>
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', padding: 4, lineHeight: 1 }}>✕</button>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--line-soft)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, flag }: { label: string; value: string; flag?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, color: flag ? '#d56b6b' : 'var(--text)' }}>{value}</span>
    </div>
  );
}

/* ── Exported action buttons for each table row ─────── */
export function VisitRowActions({ visit }: { visit: VisitEntry }) {
  const [modal, setModal] = useState<'view' | 'fix' | 'edit' | null>(null);

  return (
    <>
      {visit.evv_status === 'Incomplete' && (
        <button
          onClick={() => setModal('fix')}
          className="action-link"
          style={{ color: '#d56b6b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
        >
          Fix
        </button>
      )}
      <button
        onClick={() => setModal('edit')}
        className="action-link"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
      >
        Edit
      </button>
      <button
        onClick={() => setModal('view')}
        className="action-link"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
      >
        View
      </button>

      {modal === 'view' && <ViewModal visit={visit} onClose={() => setModal(null)} />}
      {modal === 'fix'  && <FixModal  visit={visit} onClose={() => setModal(null)} />}
      {modal === 'edit' && <FixModal  visit={visit} onClose={() => setModal(null)} editMode />}
    </>
  );
}
