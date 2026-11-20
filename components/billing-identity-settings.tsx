'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { SettingsDialog } from './settings-dialog';
import s from './settings-panels.module.css';

type Identity = { npi: string; taxonomy: string; ein: string; medicaid: string };
const blank: Identity = { npi: '', taxonomy: '', ein: '', medicaid: '' };
const fields: [keyof Identity, string][] = [['npi', 'National Provider ID (NPI)'], ['taxonomy', 'Taxonomy Code'], ['ein', 'Federal Tax ID (EIN)'], ['medicaid', 'Medicaid Provider Number']];

export function BillingIdentitySettings() {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [identity, setIdentity] = useState(blank);
  const [draft, setDraft] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/settings/agency', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not load billing identity.');
      setIdentity({ ...blank, ...data.billing_identity });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load billing identity.'); }
    finally { setLoading(false); }
  }
  // This workspace is keyed by agency in Settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const next = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as Identity;
    try {
      const response = await apiFetch('/api/settings/agency', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billing_identity: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the billing identifiers. NPI must contain 10 digits.');
      setIdentity(next); setEditing(false); setDraft(blank); setNotice('Billing identity saved.'); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save billing identity.'); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className={s.card} aria-label="Provider Billing Identity">
    <div className={s.cardHeader}><div><h3>Provider Billing Identity</h3><p className={s.subtitle}>Identifiers used when preparing claims.</p></div><button className="btn secondary" disabled={loading || !!error && !editing} onClick={() => { setDraft({ ...identity }); setError(''); setEditing(true); }}>Edit</button></div>
    {loading ? <p className={s.subtitle} role="status">Loading billing identity...</p> : <dl className={s.summary}>{fields.map(([key, title]) => <div key={key}><dt>{title}</dt><dd>{identity[key] ? key === 'ein' ? `•••${identity[key].slice(-4)}` : identity[key] : 'Not configured'}</dd></div>)}</dl>}
    {error && !editing && <div role="alert" className="error-text">{error} <button className="btn secondary sm" onClick={() => void load()}>Retry</button></div>}
    {notice && <div className={s.toast} role="status">{notice}</div>}
    {editing && <SettingsDialog title="Edit billing identity" description="Update the billing identifiers for this agency." onSubmit={save} busy={busy} error={error} onClose={() => { if (!busy) { setEditing(false); setDraft(blank); setError(''); } }}>
      <div className={s.fields}>{fields.map(([key, title]) => <label key={key}><span className={s.label}>{title}</span><input value={draft[key]} inputMode={key === 'npi' ? 'numeric' : undefined} pattern={key === 'npi' ? '[0-9]{10}' : undefined} maxLength={key === 'npi' || key === 'taxonomy' ? 10 : key === 'ein' ? 20 : 50} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} /></label>)}</div>
    </SettingsDialog>}
  </section>;
}
