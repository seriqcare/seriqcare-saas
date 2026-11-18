'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { refreshClientRecords } from '@/app/clients/actions';
import styles from './client-record-editor.module.css';
import { notifyClientDataChanged, useClientTabRevision } from './client-tab-refresh';

type Kind = 'goals' | 'insurance' | 'authorizations';
type RecordRow = Record<string, string | number | boolean | null>;
type Option = { id: number; name?: string; code?: string; description?: string; modifier?: string | null };
type Options = { services: Option[]; providers: Option[]; waivers: Option[] };
type Field = { key: string; label: string; type?: 'number' | 'date' | 'textarea' | 'checkbox' | 'select'; options?: keyof Options; choices?: string[]; required?: boolean; maxLength?: number; min?: number; max?: number; step?: string };

const config: Record<Kind, { title: string; singular: string; fields: Field[]; columns: string[]; defaults: RecordRow }> = {
  goals: {
    title: 'Goals & Progress', singular: 'Goal',
    fields: [
      { key: 'title', label: 'Goal', required: true, maxLength: 200 },
      { key: 'description', label: 'Description', type: 'textarea', maxLength: 4000 },
      { key: 'target_date', label: 'Target Date', type: 'date' },
      { key: 'progress', label: 'Progress (%)', type: 'number', min: 0, max: 100, required: true },
      { key: 'status', label: 'Status', type: 'select', choices: ['Not Started', 'In Progress', 'Completed', 'On Hold'], required: true },
      { key: 'notes', label: 'Progress Notes', type: 'textarea', maxLength: 4000 },
    ], columns: ['title', 'description', 'target_date', 'progress', 'status', 'notes'],
    defaults: { title: '', description: '', target_date: '', progress: 0, status: 'Not Started', notes: '' },
  },
  insurance: {
    title: 'Payer & Program', singular: 'Insurance',
    fields: [
      { key: 'payer_id', label: 'Payer ID', required: true, maxLength: 20 },
      { key: 'program', label: 'Program', required: true, maxLength: 20 },
      { key: 'waiver_id', label: 'Waiver', type: 'select', options: 'waivers' },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { key: 'end_date', label: 'End Date', type: 'date' },
      { key: 'is_active', label: 'Active', type: 'checkbox' },
    ], columns: ['payer_id', 'program', 'waiver_id', 'effective_date', 'end_date', 'is_active'],
    defaults: { payer_id: '', program: '', waiver_id: '', effective_date: '', end_date: '', is_active: true },
  },
  authorizations: {
    title: 'Service Authorizations', singular: 'Authorization',
    fields: [
      { key: 'service_code_id', label: 'Service', type: 'select', options: 'services', required: true },
      { key: 'provider_id', label: 'Provider', type: 'select', options: 'providers', required: true },
      { key: 'auth_number', label: 'Authorization Number', maxLength: 50 },
      { key: 'authorized_units', label: 'Authorized Units', type: 'number', min: 0.01, max: 99999999.99, step: '0.01', required: true },
      { key: 'service_start_date', label: 'Start Date', type: 'date', required: true },
      { key: 'service_end_date', label: 'End Date', type: 'date', required: true },
      { key: 'is_active', label: 'Active', type: 'checkbox' },
    ], columns: ['service_code_id', 'provider_id', 'auth_number', 'authorized_units', 'used_units', 'remaining_units', 'service_start_date', 'service_end_date', 'is_active'],
    defaults: { service_code_id: '', provider_id: '', auth_number: '', authorized_units: '', service_start_date: '', service_end_date: '', is_active: true },
  },
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail)
      ? data.detail.map((item: { msg: string }) => item.msg).join(' ') : `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  return data;
}

function optionLabel(option: Option) {
  return [option.code, option.modifier, option.description || option.name].filter(Boolean).join(' · ');
}

export function ClientRecordEditor({ clientId, kind }: { clientId: number; kind: Kind }) {
  const revision = useClientTabRevision();
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [options, setOptions] = useState<Options>({ services: [], providers: [], waivers: [] });
  const [draft, setDraft] = useState<RecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [medicaidId, setMedicaidId] = useState<string | null>(null);
  const current = config[kind];
  const endpoint = `/api/clients/${clientId}/${kind}`;
  const formId = `client-record-${kind}-${clientId}`;

  const load = useCallback(async () => {
    const [records, choices] = await Promise.all([
      apiFetch(endpoint, { cache: 'no-store' }).then(readResponse),
      kind === 'goals' ? Promise.resolve({ services: [], providers: [], waivers: [] })
        : apiFetch(`/api/clients/${clientId}/edit-options`, { cache: 'no-store' }).then(readResponse),
    ]);
    setRows(records);
    setOptions(choices);
  }, [apiFetch, clientId, endpoint, kind]);

  useEffect(() => {
    setError('');
    load().catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [load, revision]);

  useEffect(() => {
    if (kind !== 'insurance') return;
    apiFetch(`/api/clients/${clientId}`, { cache: 'no-store' }).then(readResponse)
      .then(detail => setMedicaidId(detail.medicaid_id)).catch(() => setMedicaidId(null));
  }, [apiFetch, clientId, kind, revision]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function startEdit(row?: RecordRow) {
    setError('');
    const next = { ...current.defaults, ...row };
    if (kind === 'authorizations' && !next.provider_id && options.providers.length === 1) next.provider_id = options.providers[0].id;
    setDraft(next);
  }

  async function refreshEmptyProviders() {
    if (options.providers.length > 0) return;
    try {
      const choices: Options = await apiFetch(`/api/clients/${clientId}/edit-options`, { cache: 'no-store' }).then(readResponse);
      setOptions(choices);
      if (choices.providers.length === 1) setDraft(value => value && !value.provider_id ? { ...value, provider_id: choices.providers[0].id } : value);
    } catch { setError('Unable to refresh providers. Please try again.'); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const payload: RecordRow = {};
    for (const field of current.fields) {
      const value = draft[field.key];
      payload[field.key] = field.type === 'checkbox' ? Boolean(value)
        : field.type === 'number' || field.options ? (value === '' || value == null ? null : Number(value))
        : typeof value === 'string' ? value.trim() || null : value ?? null;
    }
    if (kind === 'goals') {
      payload.description ??= '';
      payload.notes ??= '';
      if (payload.status === 'Completed') payload.progress = 100;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch(`${endpoint}${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }).then(readResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save.');
      setSaving(false);
      return;
    }
    setDraft(null);
    notifyClientDataChanged(clientId);
    setNotice(`${current.singular} saved.`);
    try {
      await Promise.all([load(), refreshClientRecords(clientId)]);
      router.refresh();
    } catch {
      setError('Saved successfully, but the latest data could not be loaded. Reload this page.');
    } finally { setSaving(false); }
  }

  function display(row: RecordRow, key: string) {
    const value = row[key];
    if (key === 'is_active') return <span className={`status ${value ? 'active' : 'hold'}`}>{value ? 'Active' : 'Inactive'}</span>;
    if (key === 'progress') return <div className={styles.progress}><progress max={100} value={Number(value)} aria-label={`${row.title}: ${value}%`} /><span>{value}%</span></div>;
    const field = current.fields.find(f => f.key === key);
    if (field?.options) {
      const match = options[field.options].find(o => o.id === Number(value));
      return match ? optionLabel(match) : key === 'service_code_id' ? String(row.service_code || '—') : key === 'waiver_id' ? String(row.waiver_name || row.waiver_code || '—') : '—';
    }
    return value == null || value === '' ? '—' : typeof value === 'number' ? value.toLocaleString() : String(value);
  }

  return <div className="detail-section">
    <div className={styles.header}>
      <div className="detail-section-title">{current.title}</div>
      {draft ? <div className={styles.actions}>
        <button type="submit" form={formId} className={styles.save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className={styles.cancel} disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
      </div> : <button className={styles.edit} disabled={loading || saving || Boolean(error)} onClick={() => startEdit()}>+ Add {current.singular}</button>}
    </div>
    {kind === 'insurance' && <p className={styles.hint}>Medicaid ID (MA): {medicaidId || 'Not on file'}. Update this in Address &amp; Personal.</p>}
    {loading ? <p>Loading {kind}…</p> : <>
      {draft && <form id={formId} onSubmit={save} className={styles.editor} aria-label={`${draft.id ? 'Edit' : 'Add'} ${current.singular}`}>
        <fieldset disabled={saving} className={`detail-grid ${styles.fields}`}>
          {current.fields.map(field => <label key={field.key} className={`info-field${field.type === 'textarea' ? ` ${styles.wide}` : ''}`}>
            <span className="info-label">{field.label}{field.required ? ' *' : ''}</span>
            {field.type === 'select' ? <select className="form-select" required={field.required} value={String(draft[field.key] ?? '')} onFocus={field.options === 'providers' ? refreshEmptyProviders : undefined} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })}>
              <option value="">Select…</option>
              {field.options ? options[field.options].map(o => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)
                : field.choices?.map(choice => <option key={choice}>{choice}</option>)}
              {field.options && draft[field.key] && !options[field.options].some(o => o.id === Number(draft[field.key]))
                ? <option value={String(draft[field.key])}>Unavailable selection — choose an active option</option> : null}
            </select> : field.type === 'textarea' ? <textarea className="form-textarea" maxLength={field.maxLength} value={String(draft[field.key] ?? '')} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} />
              : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(draft[field.key])} onChange={e => setDraft({ ...draft, [field.key]: e.target.checked })} />
                : <input className="form-input" type={field.type || 'text'} required={field.required} maxLength={field.maxLength} min={field.min} max={field.max} step={field.step} value={String(draft[field.key] ?? '')} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} />}
          </label>)}
        </fieldset>
        {kind === 'authorizations' && <p className={styles.hint}>Used units: {draft.used_units ?? 0} (read-only).{options.providers.length === 0 ? ' No active provider is configured for this agency. A provider must be configured before an authorization can be saved.' : ''}</p>}
      </form>}
      {rows.length === 0 ? <p className={styles.hint}>No {kind} on file for this client.</p> : <div className="mini-table-wrap"><table className="mini-table"><thead><tr>
        {current.columns.map(key => <th key={key}>{current.fields.find(f => f.key === key)?.label || (key === 'used_units' ? 'Used Units' : 'Remaining Units')}</th>)}<th>Actions</th>
      </tr></thead><tbody>{rows.map(row => <tr key={String(row.id)}>
        {current.columns.map(key => <td key={key} className={styles.cell}>{display(row, key)}</td>)}
        <td><button className={styles.edit} disabled={Boolean(draft) || saving} onClick={() => startEdit(row)}>Edit</button></td>
      </tr>)}</tbody></table></div>}
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <div role="status" className={styles.toast}>{notice}</div>}
  </div>;
}
