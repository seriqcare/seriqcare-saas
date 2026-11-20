'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SettingsDialog } from './settings-dialog';
import styles from './settings-panels.module.css';
import { useAuth } from '@/components/auth-context';

type Service = { id: number; hcpcs_code: string; modifier: string | null; description: string; unit_type: string };
type Rate = Service & { service_code_id: number; rate_per_unit: number; effective_from: string; effective_to: string | null };
type Form = { service_code_id: string; rate_per_unit: string; effective_from: string; effective_to: string };
const blank: Form = { service_code_id: '', rate_per_unit: '', effective_from: '', effective_to: '' };
const label = (s: Service) => `${s.hcpcs_code}${s.modifier ? ` · ${s.modifier}` : ''} — ${s.description}`;

export function ServiceRatesSettings() {
  const { apiFetch, user } = useAuth();
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Rate | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const canEdit = user?.role === 'agency_admin';
  const selected = services.find(s => s.id === Number(form.service_code_id));

  const load = useCallback(async () => {
    const response = await apiFetch('/api/settings/service-rates', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not load service rates.');
    setServices(data.services);
    setRates(data.rates);
  }, [apiFetch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await apiFetch(`/api/settings/service-rates${editing === 'new' ? '' : `/${editing}`}`, {
        method: editing === 'new' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, service_code_id: Number(form.service_code_id), effective_to: form.effective_to || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the rate and effective dates.');
      setEditing(null);
      setForm(blank);
      setNotice('Service rate saved.');
      router.refresh();
      try { await load(); } catch { setError('Rate saved. Reload to refresh the rate list.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the service rate.');
    } finally { pending.current = false; setSaving(false); }
  }

  async function confirmDelete(event: FormEvent) {
    event.preventDefault();
    if (!deleting || pending.current) return;
    pending.current = true;
    setSaving(true); setError('');
    const rateId = deleting.id;
    try {
      const response = await apiFetch(`/api/settings/service-rates/${rateId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not delete the service rate.');
      }
      setRates(current => current.filter(rate => rate.id !== rateId));
      setDeleting(null); setNotice('Service rate deleted.'); router.refresh();
      try { await load(); } catch { setError('Rate deleted. Reload to refresh the rate list.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the service rate.'); }
    finally { pending.current = false; setSaving(false); }
  }

  return (
    <section className={styles.card} aria-label="Service Rates">
      <div className={styles.cardHeader}>
        <div><h3>Service Rates</h3><p className={styles.subtitle}>Billing rates per service unit. Visit dates determine which rate applies.</p></div>
        {canEdit && <button className="btn primary" disabled={loading || !services.length || saving} onClick={() => { setEditing('new'); setForm(blank); setError(''); }}>+ Add Rate</button>}
      </div>
      {notice && <div role="status" className={styles.toast}>{notice}</div>}
      {error && editing === null && deleting === null && <div role="alert" className="error-text">{error} <button className="btn secondary sm" onClick={() => { setError(''); load().catch(e => setError(e.message)); }}>Retry</button></div>}
      {deleting && <SettingsDialog title="Delete service rate?" description="Confirm the service rate you want to remove." onSubmit={confirmDelete} busy={saving} error={error} destructive submitLabel="Delete rate" onClose={() => { if (!saving) { setDeleting(null); setError(''); } }}>
        <dl className={styles.summary}><div><dt>Service</dt><dd>{label(deleting)}</dd></div><div><dt>Rate per unit</dt><dd>${Number(deleting.rate_per_unit).toFixed(2)} / {deleting.unit_type}</dd></div><div><dt>Effective from</dt><dd>{deleting.effective_from}</dd></div><div><dt>Effective to</dt><dd>{deleting.effective_to || 'No end date'}</dd></div></dl>
        <p className={styles.hint}>This cannot be undone. Existing claims keep their saved amounts. Visits covered by this rate may show “Rate not configured” until a replacement is added.</p>
      </SettingsDialog>}
      {editing !== null && <SettingsDialog title={editing === 'new' ? 'Add service rate' : 'Edit service rate'} description="Set the rate and dates for this service. Existing claims keep their saved amounts." onSubmit={save} busy={saving} error={error} onClose={() => { if (!saving) { setEditing(null); setForm(blank); setError(''); } }}>
          <div className={styles.fields}>
            <label className="info-field"><span className="info-label">Service Code *</span>
              <select className="form-select" required value={form.service_code_id} onChange={e => setForm(f => ({ ...f, service_code_id: e.target.value }))}>
                <option value="">Select service</option>{services.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
              </select>
            </label>
            <label className="info-field"><span className="info-label">Rate per unit ($) *</span>
              <input className="input" type="number" required min="0" max="99999999.99" step="0.01" value={form.rate_per_unit} onChange={e => setForm(f => ({ ...f, rate_per_unit: e.target.value }))} />
              {selected && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Per {selected.unit_type} unit</span>}
            </label>
            <label className="info-field"><span className="info-label">Effective From *</span><input className="input" type="date" required value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} /></label>
            <label className="info-field"><span className="info-label">Effective To</span><input className="input" type="date" min={form.effective_from} value={form.effective_to} onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))} /><span style={{ fontSize: 11, color: 'var(--muted)' }}>Blank means no end date.</span></label>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)' }}>Date ranges include both dates. For a new rate, end the previous rate the day before the new rate starts.</p>
      </SettingsDialog>}
      {loading ? <p role="status">Loading service rates...</p> : rates.length ? <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Service</th><th>Unit</th><th>Rate / Unit</th><th>Effective From</th><th>Effective To</th>{canEdit && <th className={`${styles.action} ${styles.rateActions}`}>Actions</th>}</tr></thead>
        <tbody>{rates.map(r => <tr key={r.id}><td>{label(r)}</td><td>{r.unit_type}</td><td>${Number(r.rate_per_unit).toFixed(2)}</td><td>{r.effective_from}</td><td>{r.effective_to || 'No end date'}</td>{canEdit && <td className={styles.action}><span className={styles.rowActions}><button className={styles.edit} disabled={saving} aria-label={`Edit ${r.hcpcs_code} rate`} onClick={() => { setEditing(r.id); setError(''); setForm({ service_code_id: String(r.service_code_id), rate_per_unit: String(r.rate_per_unit), effective_from: r.effective_from, effective_to: r.effective_to || '' }); }}>Edit</button><button className={`${styles.edit} ${styles.delete}`} disabled={saving} aria-label={`Delete ${r.hcpcs_code} rate`} onClick={() => { setDeleting(r); setError(''); }}>Delete</button></span></td>}</tr>)}</tbody>
      </table></div> : !error && <p className={styles.subtitle}>No service rates configured for this agency.{canEdit ? ' Add a rate to calculate billing estimates.' : ' Ask your agency administrator to configure rates.'}</p>}
    </section>
  );
}
