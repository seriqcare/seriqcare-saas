'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ClientCareTask, ClientCareTaskInput, ClientDetail, ClientSummary, ClientVisitItem } from '@/lib/queries/clients';
import { useAuth } from '@/components/auth-context';
import { ClientRecordEditor } from '@/components/client-record-editor';
import recordStyles from '@/components/client-record-editor.module.css';
import { ClientTabRevisionProvider, notifyClientDataChanged, useClientTabRevision } from '@/components/client-tab-refresh';
import { getClientDetail, getClientVisits, updateClient } from '@/lib/queries/clients';

/* ── Helpers ─────────────────────────────────────────── */

/* ── Reusable editable section wrapper ───────────────── */
function EditSection({
  title, children, onEdit, onSave, onCancel, editing, saving = false,
}: {
  title: string;
  children: React.ReactNode;
  onEdit: () => void;
  onSave: () => void;
  onCancel?: () => void;
  editing: boolean;
  saving?: boolean;
}) {
  return (
    <div className="detail-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <div className="detail-section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>{title}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
          {editing ? (
            <>
              <button
                onClick={onSave}
                disabled={saving}
                style={{ fontSize: 11, fontWeight: 700, background: '#2567a4', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onCancel ?? onSave}
                disabled={saving}
                style={{ fontSize: 11, fontWeight: 600, background: 'none', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={onEdit}
              disabled={saving}
              style={{ fontSize: 11, fontWeight: 600, background: 'none', color: 'var(--primary)', border: '1px solid #c8dff0', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9.5 1.5l3 3-8 8H1.5v-3l8-8z"/>
              </svg>
              Edit
            </button>
          )}
        </div>
      </div>
      <div style={{ borderBottom: '1px solid var(--line-soft)', marginBottom: 14, marginTop: 10 }} />
      {children}
    </div>
  );
}

function CareTaskFields({ draft, onChange, disabled }: {
  draft: ClientCareTaskInput;
  onChange: (field: keyof ClientCareTaskInput, value: string) => void;
  disabled: boolean;
}) {
  return <fieldset disabled={disabled} className={`detail-grid ${recordStyles.fields}`}>
    {[
      ['title', 'Task Title'], ['specific_time', 'Specific Time'], ['recurrence_text', 'Recurrence'],
    ].map(([field, label]) => <label className="info-field" key={field}>
      <span className="info-label">{label}</span>
      <input className="form-input" value={String(draft[field as keyof ClientCareTaskInput] ?? '')}
        onChange={event => onChange(field as keyof ClientCareTaskInput, event.target.value)} />
    </label>)}
    <label className={`info-field ${recordStyles.wide}`}>
      <span className="info-label">Description</span>
      <textarea className="form-textarea" value={draft.description ?? ''} onChange={event => onChange('description', event.target.value)} />
    </label>
  </fieldset>;
}

function TaskActionIcon({ action }: { action: 'edit' | 'delete' }) {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {action === 'edit' ? <path d="M10.5 2.5l3 3M2 14l3.5-.5 8-8a2.1 2.1 0 0 0-3-3l-8 8L2 14z" /> : <path d="M4 4l8 8M12 4l-8 8" />}
  </svg>;
}

function toTaskDraft(task: ClientCareTask, index: number): ClientCareTaskInput {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    specific_time: task.specific_time ?? '',
    recurrence_text: task.recurrence_text ?? '',
    sort_order: task.sort_order || index + 1,
  };
}

/* ── Editable field ───────────────────────────────────── */
function EField({
  label, fieldKey, vals, onChange, editing, placeholder = 'Not on file', textarea = false, options, type = 'text',
}: {
  label: string;
  fieldKey: string;
  vals: Record<string, string>;
  onChange: (k: string, v: string) => void;
  editing: boolean;
  placeholder?: string;
  textarea?: boolean;
  options?: string[];
  type?: string;
}) {
  const val = vals[fieldKey] ?? '';
  const isEmpty = !val || val === 'Not on file';
  return (
    <div className="info-field">
      <div className="info-label">{label}</div>
      {editing ? (
        options ? (<select className="form-select" value={val} onChange={e => onChange(fieldKey, e.target.value)}><option value="">Select...</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select>) : textarea ? (
          <textarea
            className="form-textarea"
            value={val}
            placeholder={placeholder}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            style={{ minHeight: 68, fontSize: 12 }}
          />
        ) : (
          <input
            className="form-input"
            type={type}
            value={val}
            placeholder={placeholder}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            style={{ fontSize: 12, padding: '7px 10px' }}
          />
        )
      ) : (
        <div className={`info-value${isEmpty ? ' empty' : ''}`}>{isEmpty ? 'Not on file' : val}</div>
      )}
    </div>
  );
}

/* ── Tab: Profile ─────────────────────────────────────── */
function ProfileTab({ c, clientId }: { c: ClientSummary; clientId: number }) {
  const revision = useClientTabRevision();
  const router = useRouter();
  const { user, apiFetch } = useAuth();
  const init = {
    name:       c.name ?? '',
    client_code: c.client_code ?? '',
    age:        c.age != null ? String(c.age) : '',
    dob:        '',
    gender:     '',
    language:   '',
    phone:      '',
    email:      '',
    address:    c.city && c.state ? `${c.city}, ${c.state}` : '',
    emergency_contact: '',
    emergency_phone:   '',
    relationship:      '',
    service_type:      c.service_type ?? '',
    caregiver:         c.primary_caregiver ?? '',
    next_visit:        c.next_visit ?? '',
    account_status:    c.status ?? '',
    care_plan_status:  c.care_plan_status ?? '',
  };
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (Object.values(editing).some(Boolean)) return;
    setVals(current => ({ ...current,
      name: c.name ?? '', client_code: c.client_code ?? '', age: c.age != null ? String(c.age) : '',
      service_type: c.service_type ?? '', caregiver: c.primary_caregiver ?? '',
      next_visit: c.next_visit ?? '', account_status: c.status ?? '', care_plan_status: c.care_plan_status ?? '',
    }));
  }, [c]);

  const [detailError, setDetailError] = useState('');
  useEffect(() => {
    if (!user?.token || Object.values(editing).some(Boolean)) return;
    let alive = true;
    getClientDetail(clientId, user.token).then(detail => {
      if (!alive) return;
      if (!detail) throw new Error('Could not load client details.');
      setDetailError('');
      setVals(current => ({ ...current,
        name: [detail.first_name, detail.middle_name, detail.last_name].filter(Boolean).join(' '),
        dob: detail.date_of_birth ?? '', gender: detail.gender ?? '', language: detail.primary_language ?? '',
        phone: detail.phone ?? '', email: detail.email ?? '',
        address: [detail.street_address, detail.city, detail.state, detail.zip_code].filter(Boolean).join(', '),
        emergency_contact: detail.emergency_contact_name ?? '', emergency_phone: detail.emergency_contact_phone ?? '',
        relationship: detail.emergency_contact_relationship ?? '',
      }));
    }).catch(error => { if (alive) setDetailError(error.message); });
    return () => { alive = false; };
  }, [clientId, user?.token, revision]);

  function set(k: string, v: string) { setVals((p) => ({ ...p, [k]: v })); }
  function startEdit(section: string) { setEditing((p) => ({ ...p, [section]: true })); }

  async function save(section: string) {
    setSaving(true);
    const sectionFields: Record<string, string[]> = {
      personal: ['name', 'dob', 'gender', 'language'],
      contact:  ['phone', 'email', 'emergency_contact', 'emergency_phone', 'relationship'],
      service:  ['service_type', 'account_status'],
    };
    const fieldsToSave = sectionFields[section] ?? [];
    const payload: Record<string, string> = {};
    // Map frontend field names to backend field names
    const fieldMap: Record<string, string> = {
      dob:               'date_of_birth',
      language:          'primary_language',
      phone:             'phone',
      email:             'email',
      emergency_contact: 'emergency_contact_name',
      emergency_phone:   'emergency_contact_phone',
      relationship:      'emergency_contact_relationship',
      account_status:    'status',
    };
    for (const f of fieldsToSave) {
      if (vals[f] !== undefined && vals[f] !== '') {
        payload[fieldMap[f] ?? f] = vals[f];
      }
    }
    // Handle name split
    if (section === 'personal' && vals.name) {
      const parts = vals.name.trim().split(' ');
      payload.first_name = parts[0];
      payload.last_name = parts.at(-1) || parts[0];
      payload.middle_name = parts.slice(1, -1).join(' ');
      delete payload.name;
    }
    try {
      await updateClient(clientId, payload, apiFetch);
      setEditing((p) => ({ ...p, [section]: false }));
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update client.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {detailError && <p role="alert">{detailError}</p>}
      <EditSection title="Personal Information" editing={!!editing.personal} onEdit={() => startEdit('personal')} onSave={() => save('personal')}>
        <div className="detail-grid">
          <EField label="Full Name"       fieldKey="name"        vals={vals} onChange={set} editing={!!editing.personal} />
          <EField label="Client ID"       fieldKey="client_code" vals={vals} onChange={set} editing={!!editing.personal} />
          <EField label="Age"             fieldKey="age"         vals={vals} onChange={set} editing={!!editing.personal} />
          <EField label="Date of Birth"   fieldKey="dob"         vals={vals} onChange={set} editing={!!editing.personal} />
          <EField label="Gender"          fieldKey="gender"      vals={vals} onChange={set} editing={!!editing.personal} />
          <EField label="Primary Language" fieldKey="language"   vals={vals} onChange={set} editing={!!editing.personal} />
        </div>
      </EditSection>

      <EditSection title="Contact Information" editing={!!editing.contact} onEdit={() => startEdit('contact')} onSave={() => save('contact')}>
        <div className="detail-grid">
          <EField label="Phone"            fieldKey="phone"             vals={vals} onChange={set} editing={!!editing.contact} />
          <EField label="Email"            fieldKey="email"             vals={vals} onChange={set} editing={!!editing.contact} />
          <EField label="Address"          fieldKey="address"           vals={vals} onChange={set} editing={!!editing.contact} />
          <EField label="Emergency Contact" fieldKey="emergency_contact" vals={vals} onChange={set} editing={!!editing.contact} />
          <EField label="Emergency Phone"  fieldKey="emergency_phone"   vals={vals} onChange={set} editing={!!editing.contact} />
          <EField label="Relationship"     fieldKey="relationship"      vals={vals} onChange={set} editing={!!editing.contact} />
        </div>
      </EditSection>

      <EditSection title="Service Assignment" editing={!!editing.service} onEdit={() => startEdit('service')} onSave={() => save('service')}>
        <div className="detail-grid">
          <EField label="Service Type"      fieldKey="service_type"     vals={vals} onChange={set} editing={!!editing.service} />
          <EField label="Primary Caregiver" fieldKey="caregiver"        vals={vals} onChange={set} editing={!!editing.service} />
          <EField label="Next Visit"        fieldKey="next_visit"       vals={vals} onChange={set} editing={!!editing.service} />
          <EField label="Account Status"    fieldKey="account_status"   vals={vals} onChange={set} editing={!!editing.service} />
          <EField label="Care Plan Status"  fieldKey="care_plan_status" vals={vals} onChange={set} editing={!!editing.service} />
        </div>
      </EditSection>
    </div>
  );
}

/* ── Tab: Address & Personal ──────────────────────────── */
function AddressTab({ c, clientId }: { c: ClientSummary; clientId: number }) {
  const revision = useClientTabRevision();
  const router = useRouter();
  const { user, apiFetch } = useAuth();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user?.token || Object.values(editing).some(Boolean)) return;
    setDetailError('');
    getClientDetail(clientId, user.token)
      .then((data) => {
        if (!data) {
          setDetailError('Could not load client details. Please refresh or try again shortly.');
          return;
        }
        setDetail(data);
      })
      .catch(() => {
        setDetailError('Could not load client details. Please refresh or try again shortly.');
      });
  }, [clientId, user?.token, revision]);

  const vals = detail ? {
    street:      detail.street_address ?? '',
    city:        detail.city ?? '',
    state:       detail.state ?? 'PA',
    zip:         detail.zip_code ?? '',
    county:      detail.county ?? '',
    pos:         detail.place_of_service ?? '',
    ssn4:        detail.ssn_last4 ? `****${detail.ssn_last4.slice(-4)}` : '****',
    medicaid_id: detail.medicaid_id ?? '',
    dob:         detail.date_of_birth ?? '',
    gender:      detail.gender ?? '',
    race:        detail.race_ethnicity ?? '',
    marital:     detail.marital_status ?? '',
    language:    detail.primary_language ?? '',
    language2:   detail.secondary_language ?? '',
    comm_needs:  detail.communication_needs ?? '',
    guardian:    detail.legal_guardian ?? '',
    guardian_phone: detail.guardian_phone ?? '',
    poa:         detail.power_of_attorney ?? '',
    rep_payee:   detail.representative_payee ?? '',
  } : {
    street: '', city: c.city ?? '', state: c.state ?? 'PA', zip: '',
    county: '', pos: '',
    ssn4: '****', medicaid_id: '', dob: '', gender: '',
    race: '', marital: '', language: '', language2: '',
    comm_needs: '',
    guardian: '', guardian_phone: '', poa: '', rep_payee: '',
  };

  const [localVals, setLocalVals] = useState<Record<string, string>>(vals);

  useEffect(() => {
    setLocalVals(vals);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  function set(k: string, v: string) { setLocalVals((p) => ({ ...p, [k]: v })); }
  function startEdit(s: string) { setEditing((p) => ({ ...p, [s]: true })); }

  async function save(s: string) {
    const addrFieldMap: Record<string, string> = {
      street: 'street_address',
      city: 'city',
      state: 'state',
      zip: 'zip_code',
      county: 'county',
      pos: 'place_of_service',
    };
    const personalFieldMap: Record<string, string> = {
      medicaid_id: 'medicaid_id',
      dob: 'date_of_birth',
      gender: 'gender',
      race: 'race_ethnicity',
      marital: 'marital_status',
      language: 'primary_language',
      language2: 'secondary_language',
      comm_needs: 'communication_needs',
    };
    const guardianFieldMap: Record<string, string> = {
      guardian: 'legal_guardian',
      guardian_phone: 'guardian_phone',
      poa: 'power_of_attorney',
      rep_payee: 'representative_payee',
    };
    const sectionMap: Record<string, Record<string, string>> = {
      addr: addrFieldMap,
      personal: personalFieldMap,
      guardian: guardianFieldMap,
    };
    const fieldMap = sectionMap[s] ?? {};
    const payload: Record<string, string> = {};
    for (const [localKey, apiKey] of Object.entries(fieldMap)) {
      if (localVals[localKey] !== undefined && localVals[localKey] !== '') {
        payload[apiKey] = localVals[localKey];
      }
    }
    try {
      if (Object.keys(payload).length > 0) {
        await updateClient(clientId, payload, apiFetch);
      }
      setEditing((p) => ({ ...p, [s]: false }));
      if (user?.token) {
        getClientDetail(clientId, user.token).then(setDetail).catch(() => {});
      }
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update client.');
    }
  }

  if (!detail) {
    if (detailError) {
      return (
        <div style={{ padding: '20px 0', fontSize: 12, color: '#d56b6b' }}>
          {detailError}
        </div>
      );
    }
    return (
      <div style={{ padding: '20px 0', fontSize: 12, color: 'var(--muted)' }}>
        Loading client details…
      </div>
    );
  }

  return (
    <div>
      <EditSection title="Residential Address" editing={!!editing.addr} onEdit={() => startEdit('addr')} onSave={() => save('addr')} onCancel={() => setEditing((p) => ({ ...p, addr: false }))}>
        <div className="detail-grid">
          <EField label="Street Address"  fieldKey="street"  vals={localVals} onChange={set} editing={!!editing.addr} />
          <EField label="City"            fieldKey="city"    vals={localVals} onChange={set} editing={!!editing.addr} />
          <EField label="State"           fieldKey="state"   vals={localVals} onChange={set} editing={!!editing.addr} />
          <EField label="ZIP Code"        fieldKey="zip"     vals={localVals} onChange={set} editing={!!editing.addr} />
          <EField label="County"          fieldKey="county"  vals={localVals} onChange={set} editing={!!editing.addr} />
          <EField label="Place of Service" fieldKey="pos"   vals={localVals} onChange={set} editing={!!editing.addr} options={['12', '99']} />
        </div>
      </EditSection>

      <EditSection title="Additional Personal Information" editing={!!editing.personal} onEdit={() => startEdit('personal')} onSave={() => save('personal')} onCancel={() => setEditing((p) => ({ ...p, personal: false }))}>
        <div className="detail-grid">
          <EField label="Social Security (last 4)" fieldKey="ssn4"       vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Medicaid ID"              fieldKey="medicaid_id" vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Date of Birth"            fieldKey="dob"         vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Gender"                   fieldKey="gender"      vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Race / Ethnicity"         fieldKey="race"        vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Marital Status"           fieldKey="marital"     vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Primary Language"         fieldKey="language"    vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Secondary Language"       fieldKey="language2"   vals={localVals} onChange={set} editing={!!editing.personal} />
          <EField label="Communication Needs"      fieldKey="comm_needs"  vals={localVals} onChange={set} editing={!!editing.personal} />
        </div>
      </EditSection>

      <EditSection title="Representative / Guardian" editing={!!editing.guardian} onEdit={() => startEdit('guardian')} onSave={() => save('guardian')} onCancel={() => setEditing((p) => ({ ...p, guardian: false }))}>
        <div className="detail-grid">
          <EField label="Legal Guardian"      fieldKey="guardian"       vals={localVals} onChange={set} editing={!!editing.guardian} />
          <EField label="Guardian Phone"      fieldKey="guardian_phone" vals={localVals} onChange={set} editing={!!editing.guardian} />
          <EField label="Power of Attorney"   fieldKey="poa"            vals={localVals} onChange={set} editing={!!editing.guardian} />
          <EField label="Representative Payee" fieldKey="rep_payee"    vals={localVals} onChange={set} editing={!!editing.guardian} />
        </div>
      </EditSection>
    </div>
  );
}

/* ── Tab: Insurance ───────────────────────────────────── */
function CarePlanTabInner({ clientId }: { clientId: number }) {
  const revision = useClientTabRevision();
  const { user, apiFetch } = useAuth();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({
    coordinator: '', physician: '', level_of_care: '',
    plan_start: '', next_review: '', notes: '',
  });
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [careTasks, setCareTasks] = useState<ClientCareTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [tasksSaving, setTasksSaving] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | 'new' | null>(null);
  const [taskDraft, setTaskDraft] = useState<ClientCareTaskInput | null>(null);
  const [carePlanSaving, setCarePlanSaving] = useState(false);
  const [carePlanError, setCarePlanError] = useState('');

  useEffect(() => {
    if (!user?.token || Object.values(editing).some(Boolean) || editingTaskId !== null) return;
    getClientDetail(clientId, user.token)
      .then((d) => {
        if (!d) return;
        setDetail(d);
        setVals({
          coordinator:   d.care_coordinator ?? '',
          physician:     d.physician ?? '',
          level_of_care: d.level_of_care ?? '',
          plan_start:    d.care_plan_start_date ?? '',
          next_review:   d.care_plan_review_date ?? '',
          notes:         d.care_plan_notes ?? '',
        });
      })
      .catch(() => {});
  }, [clientId, user?.token, revision]);

  function set(k: string, v: string) { setVals((p) => ({ ...p, [k]: v })); }
  function startEdit(s: string) { setCarePlanError(''); setEditing((p) => ({ ...p, [s]: true })); }
  async function save(s: string) {
    if (carePlanSaving) return;
    const payload: Record<string, string> = {};
    if (s === 'overview') {
      if (vals.coordinator)   payload.care_coordinator       = vals.coordinator;
      if (vals.physician)     payload.physician              = vals.physician;
      if (vals.level_of_care) payload.level_of_care          = vals.level_of_care;
      payload.care_plan_start_date = vals.plan_start;
      payload.care_plan_review_date = vals.next_review;
    }
    if (s === 'notes') payload.care_plan_notes = vals.notes;
    setCarePlanSaving(true);
    setCarePlanError('');
    try {
      if (Object.keys(payload).length > 0) await updateClient(clientId, payload, apiFetch);
      setDetail(current => current ? { ...current, ...payload } : current);
      setEditing((p) => ({ ...p, [s]: false }));
    } catch (error) {
      setCarePlanError(error instanceof Error ? error.message : 'Failed to save care plan.');
    } finally {
      setCarePlanSaving(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setTasksError('');
    apiFetch(`/api/clients/${clientId}/care-tasks`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to load care tasks.');
        const data = await res.json();
        setCareTasks(data.items ?? []);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setTasksError(error instanceof Error ? error.message : 'Failed to load care tasks.');
      })
      .finally(() => {
        if (alive) setTasksLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [clientId, revision]);

  function startTaskEdit(task: ClientCareTask) {
    setTasksError('');
    setEditingTaskId(task.id);
    setTaskDraft(toTaskDraft(task, careTasks.findIndex((item) => item.id === task.id)));
  }

  function startNewTask() {
    setTasksError('');
    setEditingTaskId('new');
    setTaskDraft({
      title: '',
      description: '',
      specific_time: '',
      recurrence_text: '',
      sort_order: careTasks.length + 1,
    });
  }

  function cancelTaskEdit() {
    setEditingTaskId(null);
    setTaskDraft(null);
    setTasksError('');
  }

  function updateTaskDraft(field: keyof ClientCareTaskInput, value: string) {
    setTaskDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveTask() {
    if (!taskDraft) return;
    setTasksSaving(true);
    setTasksError('');
    try {
      const normalizedDraft: ClientCareTaskInput = {
        ...taskDraft,
        title: taskDraft.title.trim(),
        description: taskDraft.description?.trim() ?? '',
        specific_time: taskDraft.specific_time?.trim() ?? '',
        recurrence_text: taskDraft.recurrence_text?.trim() ?? '',
      };
      if (!normalizedDraft.title) {
        setTasksError('Task title is required.');
        setTasksSaving(false);
        return;
      }

      const items = (editingTaskId === 'new'
        ? [...careTasks.map((task, index) => toTaskDraft(task, index)), normalizedDraft]
        : careTasks.map((task, index) => (
            task.id === editingTaskId
              ? { ...normalizedDraft, id: task.id, sort_order: index + 1 }
              : toTaskDraft(task, index)
          )))
        .map((task, index) => ({
          ...task,
          sort_order: index + 1,
        }));

      const res = await apiFetch(`/api/clients/${clientId}/care-tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to save care tasks.');
      const response = await res.json();
      setCareTasks(response.items);
      notifyClientDataChanged(clientId);
      setEditingTaskId(null);
      setTaskDraft(null);
    } catch (error: unknown) {
      setTasksError(error instanceof Error ? error.message : 'Failed to save care tasks.');
    } finally {
      setTasksSaving(false);
    }
  }

  async function removeTask(taskId: number) {
    if (tasksSaving) return;
    setTasksSaving(true);
    setTasksError('');
    try {
      const items = careTasks
        .filter((task) => task.id !== taskId)
        .map((task, index) => ({
          ...toTaskDraft(task, index),
          sort_order: index + 1,
        }));
      const res = await apiFetch(`/api/clients/${clientId}/care-tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Failed to remove care task.');
      const response = await res.json();
      setCareTasks(response.items);
      notifyClientDataChanged(clientId);
      if (editingTaskId === taskId) {
        setEditingTaskId(null);
        setTaskDraft(null);
      }
    } catch (error: unknown) {
      setTasksError(error instanceof Error ? error.message : 'Failed to remove care task.');
    } finally {
      setTasksSaving(false);
    }
  }

  return (
    <div>
      <EditSection title="Care Plan Overview" editing={!!editing.overview} saving={carePlanSaving} onEdit={() => startEdit('overview')} onSave={() => save('overview')} onCancel={() => setEditing(p => ({ ...p, overview: false }))}>
        <div className="detail-grid">
          <EField label="Care Coordinator"   fieldKey="coordinator"   vals={vals} onChange={set} editing={!!editing.overview} />
          <EField label="Attending Physician" fieldKey="physician"    vals={vals} onChange={set} editing={!!editing.overview} />
          <EField label="Level of Care"      fieldKey="level_of_care" vals={vals} onChange={set} editing={!!editing.overview} />
          <EField label="Plan Start Date"    fieldKey="plan_start" type="date" vals={vals} onChange={set} editing={!!editing.overview} />
          <EField label="Next Review Due"    fieldKey="next_review" type="date" vals={vals} onChange={set} editing={!!editing.overview} />
        </div>
      </EditSection>

      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
          <div className="detail-section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Client Care Tasks</div>
          <button
            type="button"
            onClick={startNewTask}
            disabled={editingTaskId === 'new' || tasksSaving}
            style={{ fontSize: 11, fontWeight: 600, background: 'none', color: 'var(--primary)', border: '1px solid #c8dff0', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 1v12M1 7h12"/>
            </svg>
            Add Task
          </button>
        </div>
        <div style={{ borderBottom: '1px solid var(--line-soft)', marginBottom: 14, marginTop: 10 }} />
        {tasksLoading ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading care tasks…</div>
        ) : careTasks.length === 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {editingTaskId === 'new' && taskDraft ? (
              <div style={{ padding: '14px 16px', border: '1px solid #c8dff0', borderRadius: 8, background: '#f8fbff' }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <CareTaskFields draft={taskDraft} onChange={updateTaskDraft} disabled={tasksSaving} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={cancelTaskEdit} disabled={tasksSaving} className={recordStyles.cancel}>Cancel</button>
                    <button type="button" onClick={saveTask} disabled={tasksSaving} className={recordStyles.save}>{tasksSaving ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </div>
            ) : null}
            <div style={{ padding: '12px 14px', background: 'var(--surface-soft)', borderRadius: 6, border: '1px solid var(--line-soft)', fontSize: 12, color: 'var(--muted)' }}>
              No client care tasks yet.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {editingTaskId === 'new' && taskDraft ? (
              <div style={{ padding: '14px 16px', border: '1px solid #c8dff0', borderRadius: 8, background: '#f8fbff' }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <CareTaskFields draft={taskDraft} onChange={updateTaskDraft} disabled={tasksSaving} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={cancelTaskEdit} disabled={tasksSaving} className={recordStyles.cancel}>Cancel</button>
                    <button type="button" onClick={saveTask} disabled={tasksSaving} className={recordStyles.save}>{tasksSaving ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </div>
            ) : null}
            {careTasks.map((task) => {
              const isEditingTask = editingTaskId === task.id && taskDraft?.id === task.id;
              return (
                <div key={task.id} style={{ padding: '14px 16px', border: '1px solid var(--line-soft)', borderRadius: 8, background: '#fff' }}>
                  {isEditingTask && taskDraft ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <CareTaskFields draft={taskDraft} onChange={updateTaskDraft} disabled={tasksSaving} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => removeTask(task.id)} disabled={tasksSaving} className="care-task-icon-button danger" title="Delete task" aria-label={`Delete task: ${task.title}`}><TaskActionIcon action="delete" /></button>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" onClick={cancelTaskEdit} disabled={tasksSaving} className={recordStyles.cancel}>Cancel</button>
                          <button type="button" onClick={saveTask} disabled={tasksSaving} className={recordStyles.save}>{tasksSaving ? 'Saving...' : 'Save'}</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{task.title}</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => startTaskEdit(task)} disabled={tasksSaving} className="care-task-icon-button" title="Edit task" aria-label={`Edit task: ${task.title}`}><TaskActionIcon action="edit" /></button>
                          <button
                            type="button"
                            onClick={() => removeTask(task.id)}
                            disabled={tasksSaving}
                            className="care-task-icon-button danger"
                            title="Delete task"
                            aria-label={`Delete task: ${task.title}`}
                          >
                            <TaskActionIcon action="delete" />
                          </button>
                        </div>
                      </div>
                      {task.description ? <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 10 }}>{task.description}</div> : null}
                      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
                        <span>{task.specific_time ? `Specific Time: ${task.specific_time}` : 'Specific Time: Not set'}</span>
                        <span>{task.recurrence_text ? task.recurrence_text : 'Recurrence: Not set'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: task.completed_today ? '#35693c' : 'var(--muted)' }}>
                        <span>{task.completed_today ? 'Status: Completed for today' : 'Status: Pending for today'}</span>
                        {task.completed_at ? <span>Completed at: {task.completed_at}</span> : null}
                        {task.completed_by ? <span>Completed by: {task.completed_by}</span> : null}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tasksError ? (
          <div className="error-text" style={{ marginTop: 12 }}>{tasksError}</div>
        ) : null}
      </div>

      <EditSection title="Coordinator Notes" editing={!!editing.notes} saving={carePlanSaving} onEdit={() => startEdit('notes')} onSave={() => save('notes')} onCancel={() => {
        set('notes', detail?.care_plan_notes ?? '');
        setEditing(p => ({ ...p, notes: false }));
        setCarePlanError('');
      }}>
        {editing.notes ? (
          <textarea
            className="form-textarea"
            value={vals.notes}
            disabled={carePlanSaving}
            onChange={(e) => set('notes', e.target.value)}
            style={{ minHeight: 100, fontSize: 12, fontFamily: 'inherit', width: '100%' }}
          />
        ) : (
          <div style={{ padding: '12px 14px', background: 'var(--surface-soft)', borderRadius: 6, border: '1px solid var(--line-soft)', fontSize: 12, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {vals.notes}
          </div>
        )}
      </EditSection>
      {carePlanError && <p role="alert" className="error-text">{carePlanError}</p>}
    </div>
  );
}

function VisitsTab({ clientId }: { clientId: number }) {
  const revision = useClientTabRevision();
  const { user } = useAuth();
  const [visits, setVisits] = useState<ClientVisitItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.token) return;
    getClientVisits(clientId, user.token)
      .then(setVisits)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId, user?.token, revision]);

  if (loading) {
    return <div style={{ padding: '20px 0', fontSize: 12, color: 'var(--muted)' }}>Loading visit history…</div>;
  }

  return (
    <div>
      <div className="detail-section">
        <div className="detail-section-title">Visit History</div>
        {visits.length === 0 ? (
          <div style={{ padding: '12px 14px', background: 'var(--surface-soft)', borderRadius: 6, border: '1px solid var(--line-soft)', fontSize: 12, color: 'var(--muted)' }}>
            No visits on record for this client.
          </div>
        ) : (
          <div className="timeline">
            {visits.map((v) => {
              const evvCls = v.evv_status === 'Verified' ? 'active' : v.evv_status === 'Processed' ? '' : 'flag';
              const dotType = evvCls === 'flag' ? 'exception' : 'completed';
              return (
                <div key={v.id} className="timeline-item">
                  <div className="timeline-date-col">
                    <span className="timeline-date">{v.service_date}</span>
                    <span className="timeline-time">{v.clock_in ?? '—'}</span>
                  </div>
                  <div className="timeline-spine">
                    <div className={`timeline-dot ${dotType}`} />
                    <div className="timeline-track" />
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-title">{v.service_description ?? v.service_code ?? 'Visit'}{v.service_code ? ` (${v.service_code})` : ''}</div>
                    <div className="timeline-sub">{v.caregiver ?? '—'} · {v.total_hours.toFixed(1)}h{v.clock_in && v.clock_out ? ` · ${v.clock_in} – ${v.clock_out}` : ''}</div>
                    {v.evv_status && (
                      <span className={`status ${evvCls}`} style={{ fontSize: 10, marginTop: 4, display: 'inline-flex' }}>EVV: {v.evv_status}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

/* ── Tab: Billing ─────────────────────────────────────── */
function BillingTab() {
  return (
    <div>
      <div className="detail-section">
        <div className="detail-section-title">Recent Claims</div>
        <div style={{ padding: '24px 14px', background: 'var(--surface-soft)', borderRadius: 6, border: '1px solid var(--line-soft)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>Billing data coming soon</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Per-client claim history will be available in a future update.</div>
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Documents ───────────────────────────────────── */
const DOC_STATUS_CLS: Record<string, string> = {
  approved: 'active', submitted: 'pending', draft: 'hold', reviewed: 'pending',
};
const DOC_STATUS_LABEL: Record<string, string> = {
  approved: 'Approved', submitted: 'Submitted', draft: 'Draft', reviewed: 'Reviewed',
};

function fmtDocDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface DocSubmission {
  id: number;
  template_id: number;
  template_name: string;
  template_version_number: number;
  staff_name: string | null;
  status: string;
  created_at: string | null;
  submitted_at: string | null;
}

function DocumentsTab({ clientId }: { clientId: number }) {
  const revision = useClientTabRevision();
  const { apiFetch } = useAuth();
  const [docs, setDocs] = useState<DocSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/documentation/submissions?patient_id=${clientId}&take=50`)
      .then((res) => res.ok ? res.json() : { total: 0, items: [] })
      .then((data) => {
        if (!alive) return;
        setDocs(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, revision]);

  return (
    <div>
      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="detail-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Clinical Notes &amp; Documents
            {total > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>{total} total</span>}
          </div>
          <Link
            href="/documentation/templates"
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-soft)', border: '1px solid #c8dff0', borderRadius: 6, padding: '5px 12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 1v12M1 7h12"/></svg>
            New Note
          </Link>
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 0' }}>Loading documents…</div>
        ) : docs.length === 0 ? (
          <div style={{ padding: '12px 14px', background: 'var(--surface-soft)', borderRadius: 6, border: '1px solid var(--line-soft)', fontSize: 12, color: 'var(--muted)' }}>
            No clinical notes or documents on file for this client.
          </div>
        ) : (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Staff</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{d.template_name}</span>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>v{d.template_version_number}</div>
                    </td>
                    <td style={{ fontSize: 12, color: d.staff_name ? 'var(--text)' : 'var(--muted)' }}>{d.staff_name ?? '—'}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDocDate(d.created_at)}</td>
                    <td>
                      <span className={`status ${DOC_STATUS_CLS[d.status] ?? ''}`}>{DOC_STATUS_LABEL[d.status] ?? d.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <Link href={`/documentation/submissions/${d.id}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>View</Link>
                        <Link href={`/documentation/fill/${d.template_id}?submission_id=${d.id}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>
                          {d.status === 'draft' ? 'Continue' : 'Edit'}</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main exported component ─────────────────────────── */
const TABS = [
  { id: 'profile',   label: 'Profile' },
  { id: 'address',   label: 'Address & Personal' },
  { id: 'careplan',  label: 'Care Plan' },
  { id: 'goals',     label: 'Goals & Progress' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'auths',     label: 'Authorizations' },
  { id: 'visits',    label: 'Visits' },
  { id: 'billing',   label: 'Billing' },
  { id: 'documents', label: 'Documents' },
];

export function ClientTabs({ client, clientId }: { client: ClientSummary; clientId: number }) {
  const { user } = useAuth();
  return <ClientTabsWorkspace key={`${user?.agency_id}:${user?.username}:${user?.role}:${clientId}`} client={client} clientId={clientId} />;
}

function ClientTabsWorkspace({ client, clientId }: { client: ClientSummary; clientId: number }) {
  const [active, setActive] = useState('profile');
  const [visited, setVisited] = useState(['profile']);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const refreshed = useRef<Record<string, number>>({ profile: Date.now() });

  function warm(id: string) {
    if (!(id in refreshed.current)) {
      refreshed.current[id] = Date.now();
      setVisited(current => current.includes(id) ? current : [...current, id]);
    }
  }
  function refresh(id: string, force = false) {
    if (document.visibilityState !== 'visible') return;
    const panel = document.getElementById(`client-panel-${id}`);
    if (panel?.querySelector('input:not([readonly]), select, textarea:not([readonly])')) return;
    if (!force && Date.now() - (refreshed.current[id] || 0) < 30000) return;
    refreshed.current[id] = Date.now();
    setVersions(current => ({ ...current, [id]: (current[id] || 0) + 1 }));
  }
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent).detail?.clientId !== clientId) return;
      Object.keys(refreshed.current).forEach(id => { refreshed.current[id] = 0; });
      refresh(active, true);
    };
    const foreground = () => refresh(active);
    const interval = window.setInterval(foreground, 30000);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('client-data-changed', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('client-data-changed', update);
    };
  }, [active, clientId]);

  const panels: Record<string, React.ReactNode> = {
    profile: <ProfileTab c={client} clientId={clientId} />,
    address: <AddressTab c={client} clientId={clientId} />,
    careplan: <CarePlanTabInner clientId={clientId} />,
    goals: <ClientRecordEditor clientId={clientId} kind="goals" />,
    insurance: <ClientRecordEditor clientId={clientId} kind="insurance" />,
    auths: <ClientRecordEditor clientId={clientId} kind="authorizations" />,
    visits: <VisitsTab clientId={clientId} />,
    billing: <BillingTab />,
    documents: <DocumentsTab clientId={clientId} />,
  };

  return (
    <>
      <div className="tab-bar" role="tablist" aria-label="Client details">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn${active === t.id ? ' active' : ''}`}
            role="tab" id={`client-tab-${t.id}`} aria-selected={active === t.id} aria-controls={`client-panel-${t.id}`}
            onMouseEnter={() => warm(t.id)}
            onFocus={() => warm(t.id)}
            onClick={() => { warm(t.id); setActive(t.id); refresh(t.id); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visited.map(id => <div key={id} id={`client-panel-${id}`} role="tabpanel" aria-labelledby={`client-tab-${id}`} hidden={active !== id}>
        <ClientTabRevisionProvider value={versions[id] || 0}>{panels[id]}</ClientTabRevisionProvider>
      </div>)}
    </>
  );
}
