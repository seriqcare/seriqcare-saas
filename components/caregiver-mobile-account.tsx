'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './auth-context';
import type { CaregiverAccountDetails } from '@/lib/queries/caregivers';
import styles from './caregiver-detail.module.css';

type MobileAccount = NonNullable<CaregiverAccountDetails['mobile_account']>;

export function CaregiverMobileAccount({ employeeId, employeeName, account, loading, loadError, onSaved }: {
  employeeId: number;
  employeeName: string;
  account: MobileAccount | null;
  loading: boolean;
  loadError: string;
  onSaved: (account: MobileAccount) => void;
}) {
  const { apiFetch } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState({ username: '', displayName: '', email: '', status: 'Active' });

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3500);
    return () => clearTimeout(timer);
  }, [success]);

  function startEdit() {
    setDraft({ username: account?.username ?? '', displayName: account?.display_name ?? employeeName,
      email: account?.email ?? '', status: account?.is_active === false ? 'Inactive' : 'Active' });
    setError('');
    setSuccess('');
    setEditing(true);
  }

  function cancel() {
    setError('');
    setEditing(false);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!draft.username.trim()) { setError('Mobile username is required.'); return; }
    setSaving(true);
    try {
      const response = await apiFetch(`/api/caregivers/${employeeId}/mobile-account`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: draft.username.trim(), display_name: draft.displayName.trim() || null,
          email: draft.email.trim() || null, is_active: draft.status === 'Active' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not save the mobile account.');
      onSaved(body as MobileAccount);
      setEditing(false);
      setSuccess(account ? 'Mobile account updated.' : 'Mobile account created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the mobile account.');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} aria-label="Employee mobile account">
      <div className={styles.sectionHeader}>
        <div className="card-title">Employee Mobile Account</div>
        {editing ? <div className={styles.accountActions}>
          <button type="button" className="btn secondary" disabled={saving} onClick={cancel}>Cancel</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div> : <button type="button" className={styles.accountEdit} disabled={loading || !!loadError} onClick={startEdit}>{account ? 'Edit' : 'Add Account'}</button>}
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {success && <div role="status" aria-atomic="true" className={styles.toast}>
        <span aria-hidden="true">✓</span>
        <span>{success}</span>
        <button type="button" aria-label="Dismiss notification" onClick={() => setSuccess('')}>×</button>
      </div>}
      {loading ? <p role="status" className={styles.note}>Loading mobile account...</p>
        : loadError ? <p role="alert" className={styles.error}>{loadError}</p>
        : editing ? <fieldset disabled={saving} className={styles.accountFields}>
          <label>Mobile Username<input className="form-input" name="username" autoComplete="off" required maxLength={100} value={draft.username} onChange={e => setDraft(current => ({ ...current, username: e.target.value }))} /></label>
          <label>Display Name<input className="form-input" name="display_name" maxLength={200} value={draft.displayName} onChange={e => setDraft(current => ({ ...current, displayName: e.target.value }))} /></label>
          <label>Account Email<input className="form-input" name="email" type="email" maxLength={200} value={draft.email} onChange={e => setDraft(current => ({ ...current, email: e.target.value }))} /></label>
          <label>Account Status<select className="form-select" value={draft.status} onChange={e => setDraft(current => ({ ...current, status: e.target.value }))}><option>Active</option><option>Inactive</option></select></label>
        </fieldset>
        : account ? <div className={styles.rows}>
          {[
            ['Mobile Username', account.username], ['Display Name', account.display_name],
            ['Account Email', account.email], ['Account Status', account.is_active ? 'Active' : 'Inactive'],
            // ['Password', account.has_password ? 'Set (hidden)' : 'Not set'],
          ].map(([label, value]) => <div key={label} className={styles.row}><div className={styles.accountLabel}>{label}</div><div className={styles.accountValue}>{value || '—'}</div></div>)}
        </div> : <p className={styles.note}>No mobile login account has been created for this employee.</p>}
      <p className={styles.note}>Set or reset passwords in <Link href="/settings?tab=security#mobile-app-users" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>Settings → Security → Mobile App Users</Link>.</p>
    </form>
  );
}
