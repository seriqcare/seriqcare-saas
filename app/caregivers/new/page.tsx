'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { useAuth } from '@/components/auth-context';

const SECTIONS = [
  { id: 'personal',   step: 1, label: 'Personal Info' },
  { id: 'employment', step: 2, label: 'Employment Details' },
  { id: 'evv',        step: 3, label: 'EVV & Credentials' },
  { id: 'documents',  step: 4, label: 'Documents' },
  { id: 'login',      step: 5, label: 'Login Account' },
];

type FormState = {
  firstName: string; lastName: string;
  phone: string; email: string;
  employeeCode: string; hireDate: string; status: string;
  sandataEmployeeId: string; npi: string;
  ssnLast5: string; employeePin: string;
  username: string; initialPassword: string; confirmPassword: string;
};

const EMPTY: FormState = {
  firstName: '', lastName: '',
  phone: '', email: '',
  employeeCode: '', hireDate: '', status: 'Active',
  sandataEmployeeId: '', npi: '',
  ssnLast5: '', employeePin: '',
  username: '', initialPassword: '', confirmPassword: '',
};

export default function NewCaregiverPage() {
  const router = useRouter();
  const { apiFetch } = useAuth();
  const [activeSection, setActiveSection] = useState('personal');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(`sec-${id}`);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((obs) => obs.disconnect());
  }, []);

  function scrollTo(id: string) {
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function handleSave() {
    setError('');
    setSuccess('');
    if (!form.firstName.trim())    { setError('First name is required.');    scrollTo('personal');   return; }
    if (!form.lastName.trim())     { setError('Last name is required.');     scrollTo('personal');   return; }
    if (!form.phone.trim())        { setError('Phone is required.');         scrollTo('personal');   return; }
    if (!form.employeeCode.trim()) { setError('Employee code is required.'); scrollTo('employment'); return; }
    if (!form.hireDate)            { setError('Hire date is required.');     scrollTo('employment'); return; }
    if (!form.ssnLast5.trim())     { setError('SSN (last 5 digits) is required for Sandata EVV registration.'); scrollTo('evv'); return; }
    if (!/^\d{5}$/.test(form.ssnLast5.trim())) { setError('SSN last 5 must be exactly 5 digits.'); scrollTo('evv'); return; }
    if (!form.employeePin.trim())  { setError('Employee EVV PIN is required for Sandata registration.'); scrollTo('evv'); return; }
    if (!/^\d{4,5}$/.test(form.employeePin.trim())) { setError('Employee PIN must be 4 or 5 digits.'); scrollTo('evv'); return; }

    // Login credentials are optional — but if username given, password is required
    if (form.username.trim()) {
      if (!form.initialPassword)   { setError('Password is required when creating a login account.'); scrollTo('login'); return; }
      if (form.initialPassword.length < 8) { setError('Password must be at least 8 characters.'); scrollTo('login'); return; }
      if (form.initialPassword !== form.confirmPassword) { setError('Passwords do not match.'); scrollTo('login'); return; }
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
        const data = await res.json().catch(() => ({}));
        setSuccess(data.message ?? 'Caregiver saved successfully.');
        setSaving(false);
        setTimeout(() => router.push('/caregivers'), 1500);
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
    <ProtectedLayout>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {error && (
            <span style={{ fontSize: 12, color: '#dc2626', maxWidth: 420, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</span>
          )}
          {success && (
            <span style={{ fontSize: 12, color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, padding: '4px 10px' }}>
              {success}
            </span>
          )}
          <Link
            href="/caregivers"
            className="btn secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            Cancel
          </Link>
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Caregiver'}
          </button>
        </div>
      </div>

      <div className="form-page-grid">
        {/* ── Left nav (scroll-spy) ─────────────────── */}
        <div className="form-nav">
          {SECTIONS.map(({ id, step, label }) => (
            <div
              key={id}
              className={`form-nav-item${activeSection === id ? ' active' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => scrollTo(id)}
            >
              <div className="form-nav-step">{step}</div>
              {label}
            </div>
          ))}
        </div>

        {/* ── Form body ─────────────────────────────── */}
        <div>

          {/* ── 1. Personal Information ─────────────── */}
          <div id="sec-personal" className="form-section-card">
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
                <input className="form-input" type="text" placeholder="Optional" />
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
                <input className="form-input" type="date" />
              </div>
              <div className="form-field">
                <label className="form-label">Gender</label>
                <select className="form-select">
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
                <input className="form-input" type="text" placeholder="Street address" />
              </div>
            </div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">City</label>
                <input className="form-input" type="text" placeholder="City" />
              </div>
              <div className="form-field">
                <label className="form-label">State</label>
                <select className="form-select">
                  <option value="">Select…</option>
                  <option value="PA">Pennsylvania</option>
                  <option value="NJ">New Jersey</option>
                  <option value="DE">Delaware</option>
                  <option value="MD">Maryland</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">ZIP</label>
                <input className="form-input" type="text" maxLength={5} placeholder="19103" />
              </div>
            </div>
          </div>

          {/* ── 2. Employment Details ────────────────── */}
          <div id="sec-employment" className="form-section-card">
            <div className="form-section-heading">Employment Details</div>
            <div className="form-section-sub">Role, schedule type, and hire information.</div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Employee Code <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="e.g. EMP006"
                  value={form.employeeCode} onChange={set('employeeCode')} />
              </div>
              <div className="form-field">
                <label className="form-label">Role <span className="req">*</span></label>
                <select className="form-select">
                  <option value="">Select…</option>
                  <option>Direct Support Professional</option>
                  <option>Home Health Aide</option>
                  <option>Respite Provider</option>
                  <option>Community Support Worker</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Employment Type</label>
                <select className="form-select">
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
                <input className="form-input" type="number" placeholder="40" min={1} max={60} />
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
          <div id="sec-evv" className="form-section-card">
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
                <input className="form-input" type="date" />
              </div>
              <div className="form-field">
                <label className="form-label">Training Certification Expiry</label>
                <input className="form-input" type="date" />
              </div>
            </div>
          </div>

          {/* ── 4. Documents ─────────────────────────── */}
          <div id="sec-documents" className="form-section-card">
            <div className="form-section-heading">Documents</div>
            <div className="form-section-sub">Upload required compliance documents. Max 10 MB per file.</div>

            <div className="doc-grid" style={{ marginTop: 12 }}>
              {['Background Check', 'Training Certificate', 'ID / License', 'I-9 Form'].map((doc) => (
                <div
                  key={doc}
                  style={{ border: '2px dashed var(--line)', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: 20, marginBottom: 6 }}>📎</div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{doc}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Click to upload</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 5. Login Account ─────────────────────── */}
          <div id="sec-login" className="form-section-card">
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
      </div>
    </ProtectedLayout>
  );
}
