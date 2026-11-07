'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-context';
import { createSchedule, updateSchedule } from '@/lib/queries/schedule';

interface ShiftDraft {
  id: number;
  client_id: number;
  employee_id: number | null;
  service_code: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  notes?: string | null;
}

interface Props {
  defaultDate?: string;
  clients: { id: number; name: string }[];
  caregivers: { id: number; name: string }[];
  serviceCodes: { id: number; code: string; description: string }[];
  compact?: boolean;
  linkLabel?: string;
  shift?: ShiftDraft;
}

function parseDateTime(value: string) {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'));
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toInputTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function NewShiftButton({ defaultDate = '', clients, caregivers, serviceCodes, compact = false, linkLabel, shift }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const isEdit = Boolean(shift);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [clientId, setClientId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  function hydrateForm() {
    if (shift) {
      const start = parseDateTime(shift.scheduled_start);
      const end = parseDateTime(shift.scheduled_end);
      setDate(toInputDate(start));
      setStartTime(toInputTime(start));
      setEndTime(toInputTime(end));
      setClientId(String(shift.client_id));
      setEmployeeId(shift.employee_id ? String(shift.employee_id) : '');
      setServiceType(shift.service_code ?? '');
    } else {
      setDate(defaultDate);
      setStartTime('09:00');
      setEndTime('11:00');
      setClientId('');
      setEmployeeId('');
      setServiceType('');
    }
    setSaved(false);
    setSaveError('');
  }

  useEffect(() => {
    if (open) {
      hydrateForm();
    }
  }, [open, defaultDate, shift]);

  async function handleSave() {
    setSaveError('');
    if (!clientId || !date) {
      setSaveError('Client and date are required.');
      return;
    }
    if (!serviceType) {
      setSaveError('Please select a service type.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        client_id: Number(clientId),
        employee_id: employeeId ? Number(employeeId) : undefined,
        service_code: serviceType || undefined,
        scheduled_start: `${date}T${startTime}:00`,
        scheduled_end: `${date}T${endTime}:00`,
      };

      if (shift) {
        await updateSchedule(shift.id, payload, user?.token);
      } else {
        await createSchedule(payload, user?.token);
      }

      setSaved(true);
      router.refresh();
      setTimeout(() => {
        setOpen(false);
      }, 350);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save shift.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={isEdit ? 'Edit shift' : 'Add shift'}
          style={{
            width: '100%',
            padding: '5px 0',
            background: 'var(--primary-soft)',
            border: '1px dashed var(--primary)50',
            borderRadius: 5,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--primary)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M7 1v12M1 7h12" />
          </svg>
          {isEdit ? 'Edit' : 'Add'}
        </button>
      ) : linkLabel ? (
        <button
          type="button"
          className="action-link"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          onClick={() => setOpen(true)}
        >
          {linkLabel}
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setOpen(true)}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M7 1v12M1 7h12" />
          </svg>
          {isEdit ? 'Edit Shift' : 'New Shift'}
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 28,
              width: 480,
              maxWidth: '92vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{isEdit ? 'Edit Shift' : 'New Shift'}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{isEdit ? 'Update an existing caregiver visit' : 'Schedule a new caregiver visit'}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <div className="form-field">
                <label className="form-label">Client <span className="req">*</span></label>
                <select className="form-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Select client…</option>
                  {clients.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Caregiver</label>
                <select className="form-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">Unassigned / Open shift</option>
                  {caregivers.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Date <span className="req">*</span></label>
                <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-field">
                  <label className="form-label">Start Time <span className="req">*</span></label>
                  <input className="form-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label">End Time <span className="req">*</span></label>
                  <input className="form-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Service Type <span className="req">*</span></label>
                <select className="form-select" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                  <option value="">Select service type…</option>
                  {serviceCodes.map((sc) => (
                    <option key={sc.id} value={sc.code}>{sc.code} — {sc.description}</option>
                  ))}
                </select>
              </div>

              {saveError ? (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    borderRadius: 7,
                    padding: '10px 14px',
                    fontSize: 12,
                    color: '#b91c1c',
                    fontWeight: 600,
                  }}
                >
                  {saveError}
                </div>
              ) : null}
              {saved ? (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #86efac',
                    borderRadius: 7,
                    padding: '10px 14px',
                    fontSize: 12,
                    color: '#166534',
                    fontWeight: 600,
                  }}
                >
                  {isEdit ? 'Shift updated successfully!' : 'Shift saved successfully!'}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button
                type="button"
                className="btn"
                onClick={handleSave}
                disabled={saving || !clientId || !date || !serviceType}
                style={{ minWidth: 110 }}
              >
                {saving ? 'Saving…' : saved ? 'Saved!' : isEdit ? 'Save Changes' : 'Save Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
