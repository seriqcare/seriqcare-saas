'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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

  return (
    <section className="form-section-card" aria-label="Service Rates">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="form-section-heading">Service Rates</div>
        {canEdit && editing === null && <button className="btn primary sm" disabled={loading || !services.length} onClick={() => { setEditing('new'); setForm(blank); setError(''); }}>+ Add Rate</button>}
      </div>
      <div className="form-section-sub">Billing rates for your agency, per service unit. Visit dates determine which rate applies. Existing claims keep their saved amounts.</div>
      {notice && <div role="status" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1100, padding: '12px 18px', borderRadius: 6, background: '#1b5e20', color: 'white', boxShadow: '0 3px 12px #0002' }}>{notice}</div>}
      {error && <div role="alert" className="error-text">{error} {editing === null && <button className="btn secondary sm" onClick={() => { setError(''); load().catch(e => setError(e.message)); }}>Retry</button>}</div>}
      {editing !== null && <form onSubmit={save} style={{ margin: '12px 0 18px' }}>
        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
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
          <div style={{ display: 'flex', gap: 8 }}><button className="btn primary sm" type="submit">{saving ? 'Saving…' : 'Save Rate'}</button><button type="button" className="btn secondary sm" onClick={() => { setEditing(null); setError(''); }}>Cancel</button></div>
        </fieldset>
      </form>}
      {loading ? <p role="status">Loading service rates…</p> : rates.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}>
        <thead><tr><th>Service</th><th>Unit</th><th>Rate / Unit</th><th>Effective From</th><th>Effective To</th>{canEdit && <th>Actions</th>}</tr></thead>
        <tbody>{rates.map(r => <tr key={r.id}><td>{label(r)}</td><td>{r.unit_type}</td><td>${Number(r.rate_per_unit).toFixed(2)}</td><td>{r.effective_from}</td><td>{r.effective_to || 'No end date'}</td>{canEdit && <td><button className="btn secondary sm" disabled={saving} onClick={() => { setEditing(r.id); setError(''); setForm({ service_code_id: String(r.service_code_id), rate_per_unit: String(r.rate_per_unit), effective_from: r.effective_from, effective_to: r.effective_to || '' }); }}>Edit</button></td>}</tr>)}</tbody>
      </table></div> : !error && <p style={{ color: 'var(--muted)', fontSize: 12 }}>No service rates configured for this agency.{canEdit ? ' Add a rate to calculate billing estimates.' : ' Ask your agency administrator to configure rates.'}</p>}
    </section>
  );
}
