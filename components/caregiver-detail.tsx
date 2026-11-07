'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CaregiverSummary } from '@/lib/queries/caregivers';
import { getCaregiverPayroll, getPayrollSettings, saveCaregiverPayroll, type PayrollGroup } from '@/lib/queries/payroll';

const STATUS_CLS: Record<string, string> = {
  Active: 'active', 'On Leave': 'pending', Inactive: 'hold',
};
const ROLE_COLOR: Record<string, string> = {
  'Direct Support Professional': '#2567a4',
  'Home Health Aide':            '#35693c',
  'Respite Provider':            '#8a6424',
  'Community Support Worker':    '#6a3fa4',
  DSP:                           '#2567a4',
};

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}
function avatarGradient(name: string) {
  const p = [['#d7e8f6','#2567a4'],['#d7edd7','#35693c'],['#f5e6d0','#8a6424'],['#e8d7f6','#6a3fa4'],['#f6d7d7','#a44242']];
  return p[name.charCodeAt(0) % p.length];
}
function utilPct(h: number, cap = 40) { return Math.min(100, Math.round((h / cap) * 100)); }
function utilColor(p: number) { return p > 90 ? '#d56b6b' : p > 75 ? '#c4831e' : '#2567a4'; }

interface EditRowProps {
  label: string;
  value: string;
  editing: boolean;
  type?: string;
  options?: string[];
  onChange: (v: string) => void;
}
function EditRow({ label, value, editing, type = 'text', options, onChange }: EditRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      {editing ? (
        options ? (
          <select className="form-select" style={{ padding: '4px 8px', fontSize: 12 }} value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input className="form-input" style={{ padding: '4px 8px', fontSize: 12 }} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      ) : (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{value || '—'}</div>
      )}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}
function SectionHeader({ title, editing, onEdit, onSave, onCancel }: SectionHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <div className="card-title">{title}</div>
      {editing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" style={{ fontSize: 11, height: 28, padding: '0 10px' }} onClick={onCancel}>Cancel</button>
          <button className="btn" style={{ fontSize: 11, height: 28, padding: '0 10px' }} onClick={onSave}>Save</button>
        </div>
      ) : (
        <button
          onClick={onEdit}
          style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', background: 'var(--primary-soft)', border: '1px solid var(--primary)30', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
        >
          Edit
        </button>
      )}
    </div>
  );
}

export function CaregiverDetail({ caregiver }: { caregiver: CaregiverSummary }) {
  const [bg, fg] = avatarGradient(caregiver.name);
  const pct = utilPct(caregiver.hours_this_week);
  const uColor = utilColor(pct);
  const roleColor = ROLE_COLOR[caregiver.role] ?? '#2567a4';

  // Employment section state
  const [editingEmployment, setEditingEmployment] = useState(false);
  const [employment, setEmployment] = useState({
    employeeCode: caregiver.employee_code,
    role: caregiver.role,
    status: caregiver.status,
    hireDate: caregiver.hire_date ? caregiver.hire_date.slice(0, 10) : '',
    employmentType: 'Full-time',
    weeklyHourCap: '40',
  });
  const [empSnapshot, setEmpSnapshot] = useState(employment);

  // Personal section state
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [personal, setPersonal] = useState({
    firstName: caregiver.name.split(' ')[0] ?? '',
    lastName: caregiver.name.split(' ').slice(1).join(' ') ?? '',
    gender: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'PA',
    zip: '',
  });
  const [personalSnapshot, setPersonalSnapshot] = useState(personal);

  // EVV section state
  const [editingEvv, setEditingEvv] = useState(false);
  const [evv, setEvv] = useState({
    sandataId: '',
    npi: '',
    clearanceExpiry: '',
    trainingExpiry: '',
  });
  const [evvSnapshot, setEvvSnapshot] = useState(evv);

  const [editingPayroll, setEditingPayroll] = useState(false);
  const [payrollGroups, setPayrollGroups] = useState<PayrollGroup[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [payrollError, setPayrollError] = useState('');
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [payroll, setPayroll] = useState({
    pay_group_id: '',
    pay_group_rate_id: '',
    pay_group_name: '',
    pay_rate_name: '',
    pay_type: '',
    pay_rate: '',
  });
  const [payrollSnapshot, setPayrollSnapshot] = useState(payroll);

  useEffect(() => {
    let active = true;

    Promise.all([
      getPayrollSettings(),
      getCaregiverPayroll(caregiver.id),
    ])
      .then(([groups, settings]) => {
        if (!active) return;
        setPayrollGroups(groups.groups);
        setPayroll({
          pay_group_id: settings.pay_group_id ? String(settings.pay_group_id) : '',
          pay_group_rate_id: settings.pay_group_rate_id ? String(settings.pay_group_rate_id) : '',
          pay_group_name: settings.pay_group_name ?? '',
          pay_rate_name: settings.pay_rate_name ?? '',
          pay_type: settings.pay_type ?? '',
          pay_rate: settings.pay_rate != null ? settings.pay_rate.toFixed(2) : '',
        });
        setPayrollSnapshot({
          pay_group_id: settings.pay_group_id ? String(settings.pay_group_id) : '',
          pay_group_rate_id: settings.pay_group_rate_id ? String(settings.pay_group_rate_id) : '',
          pay_group_name: settings.pay_group_name ?? '',
          pay_rate_name: settings.pay_rate_name ?? '',
          pay_type: settings.pay_type ?? '',
          pay_rate: settings.pay_rate != null ? settings.pay_rate.toFixed(2) : '',
        });
      })
      .catch((error: Error) => {
        if (!active) return;
        setPayrollError(error.message);
      })
      .finally(() => {
        if (active) setPayrollLoading(false);
      });

    return () => {
      active = false;
    };
  }, [caregiver.id]);

  const selectedGroup = useMemo(
    () => payrollGroups.find((group) => String(group.id) === payroll.pay_group_id) ?? null,
    [payGroupsKey(payrollGroups), payroll.pay_group_id],
  );
  const availableRates = selectedGroup?.items ?? [];

  function handlePayrollGroupChange(value: string) {
    const group = payrollGroups.find((entry) => String(entry.id) === value) ?? null;
    const baseRate = group?.items.find((item) => item.is_base_rate) ?? group?.items[0] ?? null;
    setPayroll((current) => ({
      ...current,
      pay_group_id: value,
      pay_group_name: group?.name ?? '',
      pay_group_rate_id: baseRate?.id ? String(baseRate.id) : '',
      pay_rate_name: baseRate?.name ?? '',
      pay_type: baseRate?.pay_type ?? '',
      pay_rate: baseRate?.rate != null ? baseRate.rate.toFixed(2) : '',
    }));
  }

  function handlePayrollRateChange(value: string) {
    const rate = availableRates.find((entry) => String(entry.id) === value) ?? null;
    setPayroll((current) => ({
      ...current,
      pay_group_rate_id: value,
      pay_rate_name: rate?.name ?? '',
      pay_type: rate?.pay_type ?? '',
      pay_rate: rate?.rate != null ? rate.rate.toFixed(2) : '',
    }));
  }

  async function handlePayrollSave() {
    setPayrollSaving(true);
    setPayrollError('');
    try {
      await saveCaregiverPayroll(caregiver.id, {
        pay_group_id: payroll.pay_group_id ? Number(payroll.pay_group_id) : null,
        pay_group_rate_id: payroll.pay_group_rate_id ? Number(payroll.pay_group_rate_id) : null,
      });
      setPayrollSnapshot(payroll);
      setEditingPayroll(false);
    } catch (error) {
      setPayrollError(error instanceof Error ? error.message : 'Failed to save caregiver payroll settings.');
    } finally {
      setPayrollSaving(false);
    }
  }

  return (
    <>
      {/* ── Hero card ───────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg,${bg},${bg}bb)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: fg,
          }}>
            {initials(caregiver.name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{caregiver.name}</div>
              <span className={`status ${STATUS_CLS[employment.status] ?? ''}`}>{employment.status}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: roleColor, background: roleColor + '18', padding: '3px 8px', borderRadius: 4, border: `1px solid ${roleColor}30` }}>
                {employment.role}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {employment.employeeCode}
              {employment.hireDate ? ` · Hired ${employment.hireDate.slice(0, 7)}` : ''}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--line-soft)' }}>
          {[
            { label: 'Clients Assigned', value: String(caregiver.clients_assigned) },
            { label: 'Visits This Week',  value: String(caregiver.visits_this_week) },
            { label: 'Hours This Week',   value: caregiver.hours_this_week.toFixed(1) + 'h' },
            { label: 'Utilization',       value: pct + '%' },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: label === 'Utilization' ? uColor : 'var(--text)' }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, background: '#e9eef4', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: uColor, borderRadius: 99 }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Weekly utilization — {pct}% of 40h cap</div>
        </div>
      </div>

      {/* ── Detail sections ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

        {/* Employment Details + Payroll Settings */}
        <div className="card">
          <SectionHeader
            title="Employment Details"
            editing={editingEmployment}
            onEdit={() => { setEmpSnapshot(employment); setEditingEmployment(true); }}
            onSave={() => setEditingEmployment(false)}
            onCancel={() => { setEmployment(empSnapshot); setEditingEmployment(false); }}
          />
          <div style={{ display: 'grid', gap: 12 }}>
            <EditRow label="Employee Code" value={employment.employeeCode} editing={editingEmployment} onChange={(v) => setEmployment((e) => ({ ...e, employeeCode: v }))} />
            <EditRow label="Role / Position" value={employment.role} editing={editingEmployment} options={['Direct Support Professional','Home Health Aide','Respite Provider','Community Support Worker']} onChange={(v) => setEmployment((e) => ({ ...e, role: v }))} />
            <EditRow label="Employment Type" value={employment.employmentType} editing={editingEmployment} options={['Full-time','Part-time','Per Diem','Contract']} onChange={(v) => setEmployment((e) => ({ ...e, employmentType: v }))} />
            <EditRow label="Status" value={employment.status} editing={editingEmployment} options={['Active','On Leave','Inactive']} onChange={(v) => setEmployment((e) => ({ ...e, status: v }))} />
            <EditRow label="Hire Date" value={employment.hireDate} editing={editingEmployment} type="date" onChange={(v) => setEmployment((e) => ({ ...e, hireDate: v }))} />
            <EditRow label="Weekly Hour Cap" value={employment.weeklyHourCap} editing={editingEmployment} type="number" onChange={(v) => setEmployment((e) => ({ ...e, weeklyHourCap: v }))} />
          </div>

          {/* Payroll Settings — nested under Employment Details */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line-soft)' }}>
            <SectionHeader
              title="Payroll Settings"
              editing={editingPayroll}
              onEdit={() => { setPayrollSnapshot(payroll); setEditingPayroll(true); }}
              onSave={handlePayrollSave}
              onCancel={() => { setPayroll(payrollSnapshot); setPayrollError(''); setEditingPayroll(false); }}
            />
            {payrollLoading ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading payroll settings...</div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <EditRow label="Pay Group" value={payroll.pay_group_name || 'Not assigned'} editing={false} onChange={() => undefined} />
                {editingPayroll ? (
                  <>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div className="info-field">
                        <div className="info-label">Pay Group</div>
                        <select className="form-select" style={{ padding: '8px 10px', fontSize: 12 }} value={payroll.pay_group_id} onChange={(event) => handlePayrollGroupChange(event.target.value)}>
                          <option value="">Select pay group</option>
                          {payrollGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                      </div>
                      <div className="info-field">
                        <div className="info-label">Pay Rate</div>
                        <select className="form-select" style={{ padding: '8px 10px', fontSize: 12 }} value={payroll.pay_group_rate_id} onChange={(event) => handlePayrollRateChange(event.target.value)} disabled={!payroll.pay_group_id}>
                          <option value="">Select pay rate</option>
                          {availableRates.map((rate) => (
                            <option key={rate.id} value={rate.id}>{rate.name} · {rate.pay_type} · ${rate.rate.toFixed(2)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Resolved Rate</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{payroll.pay_type ? `${payroll.pay_type} · $${payroll.pay_rate || '0.00'}` : '—'}</div>
                    </div>
                  </>
                ) : (
                  <EditRow label="Pay Rate" value={payroll.pay_rate_name ? `${payroll.pay_rate_name} · ${payroll.pay_type} · $${payroll.pay_rate}` : 'Not assigned'} editing={false} onChange={() => undefined} />
                )}
                {payrollError && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{payrollError}</div>}
                {editingPayroll && payrollSaving && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Saving payroll settings...</div>}
              </div>
            )}
          </div>
        </div>

        {/* Personal Info */}
        <div className="card">
          <SectionHeader
            title="Personal Information"
            editing={editingPersonal}
            onEdit={() => { setPersonalSnapshot(personal); setEditingPersonal(true); }}
            onSave={() => setEditingPersonal(false)}
            onCancel={() => { setPersonal(personalSnapshot); setEditingPersonal(false); }}
          />
          <div style={{ display: 'grid', gap: 12 }}>
            <EditRow label="First Name" value={personal.firstName} editing={editingPersonal} onChange={(v) => setPersonal((p) => ({ ...p, firstName: v }))} />
            <EditRow label="Last Name" value={personal.lastName} editing={editingPersonal} onChange={(v) => setPersonal((p) => ({ ...p, lastName: v }))} />
            <EditRow label="Gender" value={personal.gender} editing={editingPersonal} options={['', 'Male', 'Female', 'Non-binary', 'Prefer not to say']} onChange={(v) => setPersonal((p) => ({ ...p, gender: v }))} />
            <EditRow label="Phone" value={personal.phone} editing={editingPersonal} type="tel" onChange={(v) => setPersonal((p) => ({ ...p, phone: v }))} />
            <EditRow label="Email" value={personal.email} editing={editingPersonal} type="email" onChange={(v) => setPersonal((p) => ({ ...p, email: v }))} />
            <EditRow label="Address" value={personal.address} editing={editingPersonal} onChange={(v) => setPersonal((p) => ({ ...p, address: v }))} />
            <EditRow label="City" value={personal.city} editing={editingPersonal} onChange={(v) => setPersonal((p) => ({ ...p, city: v }))} />
            <EditRow label="State" value={personal.state} editing={editingPersonal} options={['PA','NJ','DE','MD']} onChange={(v) => setPersonal((p) => ({ ...p, state: v }))} />
            <EditRow label="Zip" value={personal.zip} editing={editingPersonal} onChange={(v) => setPersonal((p) => ({ ...p, zip: v }))} />
          </div>
        </div>

        {/* EVV & Credentials */}
        <div className="card">
          <SectionHeader
            title="EVV & Credentials"
            editing={editingEvv}
            onEdit={() => { setEvvSnapshot(evv); setEditingEvv(true); }}
            onSave={() => setEditingEvv(false)}
            onCancel={() => { setEvv(evvSnapshot); setEditingEvv(false); }}
          />
          <div style={{ display: 'grid', gap: 12 }}>
            <EditRow label="Sandata Employee ID" value={evv.sandataId} editing={editingEvv} onChange={(v) => setEvv((e) => ({ ...e, sandataId: v }))} />
            <EditRow label="NPI Number" value={evv.npi} editing={editingEvv} onChange={(v) => setEvv((e) => ({ ...e, npi: v }))} />
            <EditRow label="Clearance Expiry" value={evv.clearanceExpiry} editing={editingEvv} type="date" onChange={(v) => setEvv((e) => ({ ...e, clearanceExpiry: v }))} />
            <EditRow label="Training Cert. Expiry" value={evv.trainingExpiry} editing={editingEvv} type="date" onChange={(v) => setEvv((e) => ({ ...e, trainingExpiry: v }))} />
          </div>
        </div>


        {/* Quick Actions */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Quick Actions</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              ['View Schedule',  `/schedule?employee=${caregiver.id}`],
              ['View Visits',    `/visits?employee=${caregiver.id}`],
              ['Timesheets',     `/timesheets?employee=${caregiver.id}`],
            ].map(([label, href]) => (
              <Link key={href} href={href} style={{ display: 'block', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)', textDecoration: 'none' }}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function payGroupsKey(groups: PayrollGroup[]) {
  return groups.map((group) => `${group.id ?? group.name}:${group.items.length}`).join('|');
}
