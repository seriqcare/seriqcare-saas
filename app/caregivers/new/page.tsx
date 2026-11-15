'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { useAuth } from '@/components/auth-context';
import styles from '@/components/intake-wizard.module.css';
import { refreshCaregiversAfterSave } from '../actions';

const SECTIONS = [
  { id: 'personal',   step: 1, label: 'Personal Info' },
  { id: 'employment', step: 2, label: 'Employment Details' },
  { id: 'evv',        step: 3, label: 'EVV & Credentials' },
  { id: 'documents',  step: 4, label: 'Documents' },
  { id: 'login',      step: 5, label: 'Login Account' },
];

type FormState = {
  middleName: string; dateOfBirth: string; gender: string;
  streetAddress: string; city: string; state: string; zipCode: string;
  role: string; employmentType: string; weeklyHourCap: string;
  clearanceExpiry: string; trainingExpiry: string;
  firstName: string; lastName: string;
  phone: string; email: string;
  employeeCode: string; hireDate: string; status: string;
  sandataEmployeeId: string; npi: string;
  ssnLast5: string; employeePin: string;
  username: string; initialPassword: string; confirmPassword: string;
};

const EMPTY: FormState = {
  middleName: '', dateOfBirth: '', gender: '',
  streetAddress: '', city: '', state: '', zipCode: '',
  role: '', employmentType: '', weeklyHourCap: '',
  clearanceExpiry: '', trainingExpiry: '',
  firstName: '', lastName: '',
  phone: '', email: '',
  employeeCode: '', hireDate: '', status: 'Active',
  sandataEmployeeId: '', npi: '',
  ssnLast5: '', employeePin: '',
  username: '', initialPassword: '', confirmPassword: '',
};

export default function NewCaregiverPage() {
  const router = useRouter();
  const { apiFetch, user } = useAuth();
  const [activeSection, setActiveSection] = useState('personal');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const headingRef = useRef<HTMLDivElement>(null);
  const draftKey = user ? `seriqcare-caregiver-draft:${user.agency_id}:${user.username}` : null;
  const activeIndex = SECTIONS.findIndex(section => section.id === activeSection);

  useEffect(() => {
    if (!draftKey) return;
    setForm(EMPTY);
    setActiveSection('personal');
    setCompleted([]);
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.version !== 1 || !draft.form || typeof draft.form !== 'object') return;
      const restored = { ...EMPTY };
      for (const key of Object.keys(EMPTY) as Array<keyof FormState>) {
        if (['ssnLast5', 'employeePin', 'initialPassword', 'confirmPassword'].includes(key)) continue;
        if (typeof draft.form[key] === 'string') restored[key] = draft.form[key];
      }
      setForm(restored);
      setSuccess('Draft restored. Re-enter EVV identifiers and account passwords before saving.');
    } catch { setError('Could not restore the saved draft.'); }
  }, [draftKey]);

  function scrollTo(id: string) {
    setActiveSection(id);
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      { setForm(f => ({ ...f, [key]: e.target.value })); setSuccess(''); setCompleted(previous => previous.filter(id => id !== activeSection)); };
  }

  function validateStep(id: string): string {
    if (id === 'personal') {
      if (!form.firstName.trim()) return 'First name is required.';
      if (!form.lastName.trim()) return 'Last name is required.';
      if (!form.phone.trim()) return 'Phone is required.';
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Enter a valid email address.';
    }
    if (id === 'employment') {
      if (!form.employeeCode.trim()) return 'Employee code is required.';
      if (!form.hireDate) return 'Hire date is required.';
    }
    if (id === 'evv') {
      if (!/^\d{5}$/.test(form.ssnLast5.trim())) return 'SSN last 5 must be exactly 5 digits.';
      if (!/^\d{4,5}$/.test(form.employeePin.trim())) return 'Employee PIN must be 4 or 5 digits.';
    }
    if (id === 'login') {
      if (!form.username.trim() && (form.initialPassword || form.confirmPassword)) return 'Enter a username to create a login account, or clear the passwords.';
      if (form.username.trim()) {
        if (form.initialPassword.length < 8) return 'Password must be at least 8 characters.';
        if (form.initialPassword !== form.confirmPassword) return 'Passwords do not match.';
      }
    }
    return '';
  }

  function goToStep(index: number) {
    if (saving) return;
    if (index > activeIndex) {
      for (let i = 0; i < index; i++) {
        const message = validateStep(SECTIONS[i].id);
        if (message) { setError(message); scrollTo(SECTIONS[i].id); return; }
      }
      setCompleted(previous => Array.from(new Set([...previous, ...SECTIONS.slice(0, index).map(section => section.id)])));
    }
    setError('');
    setSuccess('');
    scrollTo(SECTIONS[index].id);
  }

  function saveDraft() {
    if (!draftKey) return;
    const { ssnLast5, employeePin, initialPassword, confirmPassword, ...draftForm } = form;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ version: 1, form: draftForm }));
      setError('');
      setSuccess('Draft saved in this browser tab. EVV identifiers and passwords must be re-entered when resuming.');
    } catch { setError('Draft could not be saved. Browser storage may be unavailable.'); }
  }

  async function handleSave() {
    if (saving) return;
    setError('');
    setSuccess('');
    for (const section of SECTIONS) {
      const message = validateStep(section.id);
      if (message) { setError(message); scrollTo(section.id); return; }
    }

    setSaving(true);
    const payload = {
      employee_code:       form.employeeCode.trim(),
      first_name:          form.firstName.trim(),
      last_name:           form.lastName.trim(),
      phone:               form.phone.trim() || null,
      hire_date:           form.hireDate || null,
      is_active:           form.status === 'Active',
      sandata_employee_id: form.sandataEmployeeId.trim() || null,
      npi:                 form.npi.trim() || null,
      ssn_last5:           form.ssnLast5.trim() || null,
      employee_pin:        form.employeePin.trim() || null,
      username:            form.username.trim() || null,
      initial_password:    form.initialPassword || null,
      email:               form.email.trim() || null,
    };
    try {
      const res = await apiFetch('/api/caregivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        try { if (draftKey) sessionStorage.removeItem(draftKey); } catch { /* Caregiver was saved. */ }
        const data = await res.json().catch(() => ({}));
        setSuccess(data.message ?? 'Caregiver saved successfully.');
        try { await refreshCaregiversAfterSave(); } catch { router.refresh(); }
        router.push('/caregivers');
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? 'Failed to save caregiver.');
    } catch {
      setError('Could not reach server.');
    }
    setSaving(false);
  }

  return (
    <ProtectedLayout className={styles.shell}>
      <div className={styles.wizard}>
      {/* ── Topbar ─────────────────────────────────── */}
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            <Link href="/caregivers" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Caregivers</Link>
            <span>›</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>Add New Caregiver</span>
          </div>
          <h1 className="page-title">Add New Caregiver</h1>
          <p className="page-subtitle">Complete all required fields before saving the caregiver record.</p>
        </div>
      </div>

      <nav className={styles.steps} aria-label="Caregiver intake steps">
        {/* ── Left nav (scroll-spy) ─────────────────── */}
          {SECTIONS.map(({ id, step, label }, index) => (
            <button
              key={id}
              type="button"
              className={`${styles.step} ${activeSection === id ? styles.active : ''} ${completed.includes(id) ? styles.complete : ''}`}
              aria-current={activeSection === id ? 'step' : undefined}
              disabled={saving}
              onClick={() => goToStep(index)}
            >
              <span className={styles.stepNumber}>{completed.includes(id) && activeSection !== id ? '✓' : step}</span>
              <span>{label}</span>
              {index < SECTIONS.length - 1 && <span className={styles.connector} />}
            </button>
          ))}
      </nav>
      <div className={styles.grid}>

        {/* ── Form body ─────────────────────────────── */}
        <div className={styles.formBody}>
          <div className={styles.fields}>
          <div ref={headingRef} tabIndex={-1} className={styles.stepIntro}>Step {activeIndex + 1} of {SECTIONS.length} · {SECTIONS[activeIndex].label}</div>
          {error && <div role="alert" className={styles.error}>{error}</div>}
          {success && <div role="status" className={styles.success}>{success}</div>}

          {/* ── 1. Personal Information ─────────────── */}
          <div id="sec-personal" hidden={activeSection !== 'personal'} className="form-section-card">
            <div className="form-section-heading">Personal Information</div>
            <div className="form-section-sub">Basic contact and demographic details for the caregiver record.</div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">First Name <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="e.g. Sarah"
                  value={form.firstName} onChange={set('firstName')} />
              </div>
              <div className="form-field">
                <label className="form-label">Middle Name</label>
                <input className="form-input" type="text" placeholder="Optional" value={form.middleName} onChange={set('middleName')} />
              </div>
              <div className="form-field">
                <label className="form-label">Last Name <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="e.g. Mills"
                  value={form.lastName} onChange={set('lastName')} />
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Date of Birth</label>
                <input className="form-input" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
              </div>
              <div className="form-field">
                <label className="form-label">Gender</label>
                <select className="form-select" value={form.gender} onChange={set('gender')}>
                  <option value="">Select…</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Non-binary</option>
                  <option>Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Phone <span className="req">*</span></label>
                <input className="form-input" type="tel" placeholder="(555) 000-0000"
                  value={form.phone} onChange={set('phone')} />
              </div>
              <div className="form-field">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="staff@example.com"
                  value={form.email} onChange={set('email')} />
              </div>
            </div>

            <div className="form-row col1">
              <div className="form-field">
                <label className="form-label">Home Address</label>
                <input className="form-input" type="text" placeholder="Street address" value={form.streetAddress} onChange={set('streetAddress')} />
              </div>
            </div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">City</label>
                <input className="form-input" type="text" placeholder="City" value={form.city} onChange={set('city')} />
              </div>
              <div className="form-field">
                <label className="form-label">State</label>
                <select className="form-select" value={form.state} onChange={set('state')}>
                  <option value="">Select…</option>
                  <option value="PA">Pennsylvania</option>
                  <option value="NJ">New Jersey</option>
                  <option value="DE">Delaware</option>
                  <option value="MD">Maryland</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">ZIP</label>
                <input className="form-input" type="text" maxLength={5} placeholder="19103" value={form.zipCode} onChange={set('zipCode')} />
              </div>
            </div>
          </div>

          {/* ── 2. Employment Details ────────────────── */}
          <div id="sec-employment" hidden={activeSection !== 'employment'} className="form-section-card">
            <div className="form-section-heading">Employment Details</div>
            <div className="form-section-sub">Role, schedule type, and hire information.</div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Employee Code <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="e.g. EMP006"
                  value={form.employeeCode} onChange={set('employeeCode')} />
              </div>
              <div className="form-field">
                <label className="form-label">Role</label>
                <select className="form-select" value={form.role} onChange={set('role')}>
                  <option value="">Select…</option>
                  <option>Direct Support Professional</option>
                  <option>Home Health Aide</option>
                  <option>Respite Provider</option>
                  <option>Community Support Worker</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Employment Type</label>
                <select className="form-select" value={form.employmentType} onChange={set('employmentType')}>
                  <option value="">Select…</option>
                  <option>Full-time</option>
                  <option>Part-time</option>
                  <option>Per Diem</option>
                  <option>Contract</option>
                </select>
              </div>
            </div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Hire Date <span className="req">*</span></label>
                <input className="form-input" type="date"
                  value={form.hireDate} onChange={set('hireDate')} />
              </div>
              <div className="form-field">
                <label className="form-label">Weekly Hour Cap</label>
                <input className="form-input" type="number" placeholder="40" min={1} max={60} value={form.weeklyHourCap} onChange={set('weeklyHourCap')} />
              </div>
              <div className="form-field">
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status} onChange={set('status')}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── 3. EVV & Credentials ─────────────────── */}
          <div id="sec-evv" hidden={activeSection !== 'evv'} className="form-section-card">
            <div className="form-section-heading">EVV &amp; Credentials</div>
            <div className="form-section-sub">Sandata EVV identifiers required for PA ODP electronic visit verification.</div>

            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                background: '#fefce8', border: '1px solid #fde047',
                borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#854d0e',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
              <div>
                <strong>SSN Last 5</strong> and <strong>Employee PIN</strong> are required by the Sandata
                aggregator (PA ODP EVV). Without them, the employee record will fail registration and
                visits cannot be submitted. These values are used only for Sandata — they are not stored.
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">SSN — Last 5 Digits <span className="req">*</span></label>
                <input className="form-input" type="password" maxLength={5} placeholder="XXXXX"
                  autoComplete="off"
                  value={form.ssnLast5} onChange={set('ssnLast5')} />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                  Used to build Sandata EmployeeSSN (format: 0000XXXXX). Not stored.
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Employee EVV PIN <span className="req">*</span></label>
                <input className="form-input" type="password" maxLength={5} placeholder="4–5 digits"
                  autoComplete="off"
                  value={form.employeePin} onChange={set('employeePin')} />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                  4 or 5-digit PIN for Sandata EVV check-in (ESC-609). Not stored.
                </div>
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Sandata Employee ID</label>
                <input className="form-input" type="text" placeholder="e.g. SD-EMP-006"
                  value={form.sandataEmployeeId} onChange={set('sandataEmployeeId')} />
              </div>
              <div className="form-field">
                <label className="form-label">NPI Number</label>
                <input className="form-input" type="text" placeholder="10-digit NPI" maxLength={10}
                  value={form.npi} onChange={set('npi')} />
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Clearance Expiry</label>
                <input className="form-input" type="date" value={form.clearanceExpiry} onChange={set('clearanceExpiry')} />
              </div>
              <div className="form-field">
                <label className="form-label">Training Certification Expiry</label>
                <input className="form-input" type="date" value={form.trainingExpiry} onChange={set('trainingExpiry')} />
              </div>
            </div>
          </div>

          {/* ── 4. Documents ─────────────────────────── */}
          <div id="sec-documents" hidden={activeSection !== 'documents'} className="form-section-card">
            <div className="form-section-heading">Documents</div>
            <div className="form-section-sub">Review the supporting documents for caregiver onboarding.</div>
            <p className={styles.notice}>Document uploads are not available yet. You can create the caregiver without documents.</p>

            <div className="doc-grid" style={{ marginTop: 12 }}>
              {['Background Check', 'Training Certificate', 'ID / License', 'I-9 Form'].map((doc) => (
                <div
                  key={doc}
                  style={{ border: '2px dashed var(--line)', borderRadius: 8, padding: '20px 16px', textAlign: 'center' }}
                >
                  <div style={{ fontSize: 20, marginBottom: 6 }}>📎</div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{doc}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Upload unavailable</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 5. Login Account ─────────────────────── */}
          <div id="sec-login" hidden={activeSection !== 'login'} className="form-section-card">
            <div className="form-section-heading">Login Account</div>
            <div className="form-section-sub">
              Optional — creates a mobile app account so this caregiver can clock in/out via the EVV app.
              Leave blank to add login details later.
            </div>

            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                background: '#f0f9ff', border: '1px solid #bae6fd',
                borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#0369a1',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>ℹ</span>
              <div>
                The username and password entered here will be used by the caregiver to log into
                the <strong>mobile EVV clock-in/out app</strong>. Portal (web) access requires a
                separate Coordinator or Admin account.
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Username</label>
                <input className="form-input" type="text" placeholder="e.g. sarah.mills"
                  autoComplete="off"
                  value={form.username} onChange={set('username')} />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                  Used to log into the mobile app. Must be unique.
                </div>
              </div>
            </div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">
                  Initial Password {form.username.trim() && <span className="req">*</span>}
                </label>
                <input className="form-input" type="password" placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  value={form.initialPassword} onChange={set('initialPassword')} />
              </div>
              <div className="form-field">
                <label className="form-label">
                  Confirm Password {form.username.trim() && <span className="req">*</span>}
                </label>
                <input className="form-input" type="password" placeholder="Repeat password"
                  autoComplete="new-password"
                  value={form.confirmPassword} onChange={set('confirmPassword')} />
              </div>
            </div>
          </div>

          </div>
          <div className={styles.footer}>
            <button type="button" className="btn secondary" disabled={activeIndex === 0 || saving} onClick={() => goToStep(activeIndex - 1)}>Back</button>
            <div className={styles.footerActions}>
              <Link href="/caregivers" className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', pointerEvents: saving ? 'none' : undefined }} aria-disabled={saving}>Cancel</Link>
              <button type="button" className="btn secondary" disabled={saving} onClick={saveDraft}>Save Draft</button>
              {activeIndex < SECTIONS.length - 1 ? (
                <button type="button" className="btn" onClick={() => goToStep(activeIndex + 1)}>Continue to {SECTIONS[activeIndex + 1].label}</button>
              ) : (
                <button type="button" className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Caregiver'}</button>
              )}
            </div>
          </div>
        </div>
        <aside className={styles.aside} aria-label="Caregiver intake checklist">
          <section className={styles.sideCard}>
            <h2>Intake Checklist</h2>
            <p>Track each section of the caregiver record.</p>
            <ul className={styles.checklist}>
              {SECTIONS.map(({ id, label }, index) => {
                const status = activeSection === id ? 'In progress' : completed.includes(id) ? 'Complete' : 'Not started';
                return <li key={id}>
                  <button type="button" disabled={saving} onClick={() => goToStep(index)}>{label}</button>
                  <span className={`${styles.badge} ${status === 'In progress' ? styles.inProgress : status === 'Complete' ? styles.done : ''}`}>{status}</span>
                </li>;
              })}
            </ul>
          </section>
          <section className={styles.sideCard}>
            <h2>Required to Save</h2>
            <p>Have these details ready to complete onboarding.</p>
            <ul className={styles.requirements}>
              <li>First &amp; last name</li>
              <li>Phone number</li>
              <li>Employee code &amp; hire date</li>
              <li>SSN last 5 digits &amp; EVV PIN</li>
              <li>Matching passwords if creating a login</li>
            </ul>
          </section>
        </aside>
      </div>
      </div>
    </ProtectedLayout>
  );
}
