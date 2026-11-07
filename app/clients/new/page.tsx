'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { useAuth } from '@/components/auth-context';

const SECTIONS = [
  { id: 'personal',   step: 1, label: 'Personal Info' },
  { id: 'insurance',  step: 2, label: 'Insurance & Payer' },
  { id: 'auth',       step: 3, label: 'Service Authorization' },
  { id: 'careplan',   step: 4, label: 'Care Plan' },
  { id: 'documents',  step: 5, label: 'Documents' },
];


type FormState = {
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  language: string;
  ssnLast4: string;
  phone: string;
  email: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  // Insurance
  medicaidId: string;
  waiverProgram: string;
  // Service Auth
  procedureCode: string;
  authorizedUnits: string;
  authStart: string;
  authEnd: string;
  placeOfService: string;
  authNotes: string;
  // Care Plan
  coordinator: string;
  physician: string;
  levelOfCare: string;
  planStart: string;
  reviewDate: string;
  planNotes: string;
};

const EMPTY: FormState = {
  firstName: '', middleName: '', lastName: '',
  dateOfBirth: '', gender: '', language: 'English',
  ssnLast4: '', phone: '', email: '',
  streetAddress: '', city: '', state: 'PA', zipCode: '',
  emergencyName: '', emergencyRelationship: '', emergencyPhone: '',
  medicaidId: '', waiverProgram: '',
  procedureCode: '', authorizedUnits: '', authStart: '', authEnd: '',
  placeOfService: '12', authNotes: '',
  coordinator: '', physician: '', levelOfCare: '',
  planStart: '', reviewDate: '', planNotes: '',
};

export default function NewClientPage() {
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
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function handleSave() {
    setError('');
    setSuccess('');

    if (!form.firstName.trim())  { setError('First name is required.');                         scrollTo('personal');  return; }
    if (!form.lastName.trim())   { setError('Last name is required.');                          scrollTo('personal');  return; }
    if (!form.dateOfBirth)       { setError('Date of birth is required.');                      scrollTo('personal');  return; }
    if (!form.streetAddress.trim()) { setError('Street address is required for Sandata EVV registration.'); scrollTo('personal'); return; }
    if (!form.city.trim())          { setError('City is required for Sandata EVV registration.');           scrollTo('personal'); return; }
    if (!form.zipCode.trim())       { setError('ZIP code is required for Sandata EVV registration.');       scrollTo('personal'); return; }
    if (!form.medicaidId.trim()) { setError('Medicaid ID is required.');                        scrollTo('insurance'); return; }
    if (!/^\d{10}$/.test(form.medicaidId.replace(/\D/g, ''))) { setError('Medicaid ID must be exactly 10 digits.'); scrollTo('insurance'); return; }
    if (!form.procedureCode)     { setError('Service Code (Procedure Code) is required for Sandata EVV registration.'); scrollTo('auth'); return; }

    setSaving(true);

    const payload = {
      first_name:     form.firstName.trim(),
      middle_name:    form.middleName.trim() || null,
      last_name:      form.lastName.trim(),
      date_of_birth:  form.dateOfBirth,
      medicaid_id:    form.medicaidId.trim(),
      gender:         form.gender || null,
      ssn_last4:      form.ssnLast4.trim() || null,
      phone:          form.phone.trim() || null,
      email:          form.email.trim() || null,
      status:         'Active',
      street_address: form.streetAddress.trim() || null,
      city:           form.city.trim() || null,
      state:          form.state || 'PA',
      zip_code:       form.zipCode.trim() || null,
      procedure_code: form.procedureCode || null,
    };
    try {
      const res = await apiFetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        const data = await res.json().catch(() => ({}));
        const sandataNote = data.sandata_status
          ? ` Sandata simulator: ${data.sandata_status}.`
          : '';
        setSuccess(`${data.message ?? 'Client saved.'}${sandataNote}`);
        setSaving(false);
        setTimeout(() => router.push('/clients'), 1800);
        return;
      }

      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? 'Failed to save client.');
    } catch {
      setError('Could not reach server.');
    }
    setSaving(false);
  }

  return (
    <ProtectedLayout>
      {/* Topbar */}
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            <Link href="/clients" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Clients</Link>
            <span>›</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>Add New Client</span>
          </div>
          <h1 className="page-title">Add New Client</h1>
          <p className="page-subtitle">Complete all required sections before saving the client record.</p>
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
          <Link href="/clients" className="btn secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            Cancel
          </Link>
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save & Add Client'}
          </button>
        </div>
      </div>

      <div className="form-page-grid">
        {/* Left nav */}
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

        {/* Form body */}
        <div>

          {/* ── 1. Personal Information ───────────── */}
          <div id="sec-personal" className="form-section-card">
            <div className="form-section-heading">Personal Information</div>
            <div className="form-section-sub">Basic demographic and contact details for the client record.</div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">First Name <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="e.g. Evelyn"
                  value={form.firstName} onChange={set('firstName')} />
              </div>
              <div className="form-field">
                <label className="form-label">Middle Name</label>
                <input className="form-input" type="text" placeholder="Optional"
                  value={form.middleName} onChange={set('middleName')} />
              </div>
              <div className="form-field">
                <label className="form-label">Last Name <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="e.g. Carter"
                  value={form.lastName} onChange={set('lastName')} />
              </div>
            </div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Date of Birth <span className="req">*</span></label>
                <input className="form-input" type="date"
                  value={form.dateOfBirth} onChange={set('dateOfBirth')} />
              </div>
              <div className="form-field">
                <label className="form-label">Gender</label>
                <select className="form-select" value={form.gender} onChange={set('gender')}>
                  <option value="">Select…</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="X">Non-binary</option>
                  <option value="">Prefer not to say</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Primary Language</label>
                <select className="form-select" value={form.language} onChange={set('language')}>
                  <option>English</option>
                  <option>Spanish</option>
                  <option>Other</option>
                </select>
              </div>
            </div>

            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">SSN (last 4 digits)</label>
                <input className="form-input" type="text" placeholder="XXXX" maxLength={4}
                  value={form.ssnLast4} onChange={set('ssnLast4')} />
              </div>
              <div className="form-field">
                <label className="form-label">Phone Number</label>
                <input className="form-input" type="tel" placeholder="(555) 000-0000"
                  value={form.phone} onChange={set('phone')} />
              </div>
              <div className="form-field">
                <label className="form-label">Email Address</label>
                <input className="form-input" type="email" placeholder="optional@email.com"
                  value={form.email} onChange={set('email')} />
              </div>
            </div>

            <hr className="form-divider" />
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>Residential Address <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>— required for Sandata EVV</span></div>

            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Street Address <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="123 Main Street"
                  value={form.streetAddress} onChange={set('streetAddress')} />
              </div>
            </div>
            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">City <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="Philadelphia"
                  value={form.city} onChange={set('city')} />
              </div>
              <div className="form-field">
                <label className="form-label">State</label>
                <select className="form-select" value={form.state} onChange={set('state')}>
                  <option value="PA">PA</option>
                  <option value="NJ">NJ</option>
                  <option value="DE">DE</option>
                  <option value="NY">NY</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">ZIP Code <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="19103-1234"
                  value={form.zipCode} onChange={set('zipCode')} />
              </div>
            </div>

            <hr className="form-divider" />
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>Emergency Contact</div>
            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Contact Name</label>
                <input className="form-input" type="text" placeholder="Full name"
                  value={form.emergencyName} onChange={set('emergencyName')} />
              </div>
              <div className="form-field">
                <label className="form-label">Relationship</label>
                <select className="form-select" value={form.emergencyRelationship} onChange={set('emergencyRelationship')}>
                  <option value="">Select…</option>
                  <option>Parent</option><option>Spouse</option><option>Sibling</option>
                  <option>Guardian</option><option>Other</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Phone</label>
                <input className="form-input" type="tel" placeholder="(555) 000-0000"
                  value={form.emergencyPhone} onChange={set('emergencyPhone')} />
              </div>
            </div>
          </div>

          {/* ── 2. Insurance & Payer ──────────────── */}
          <div id="sec-insurance" className="form-section-card">
            <div className="form-section-heading">Insurance &amp; Payer</div>
            <div className="form-section-sub">Medicaid, waiver program, and managed care enrollment details.</div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Medicaid ID (MA Number) <span className="req">*</span></label>
                <input className="form-input" type="text" placeholder="10-digit MA number" maxLength={12}
                  value={form.medicaidId} onChange={set('medicaidId')} />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Must be exactly 10 digits</div>
              </div>
              <div className="form-field">
                <label className="form-label">Payer</label>
                <select className="form-select">
                  <option>Pennsylvania Medicaid (MA)</option>
                  <option>Medicare Part A</option>
                  <option>Private Insurance</option>
                </select>
              </div>
            </div>
            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Waiver Program</label>
                <select className="form-select" value={form.waiverProgram} onChange={set('waiverProgram')}>
                  <option value="">Select…</option>
                  <option value="ODP-CW">Consolidated Waiver (ODP)</option>
                  <option value="ODP-PFDS">P/FDS Waiver (ODP)</option>
                  <option value="ODP-CLW">Community Living Waiver (ODP)</option>
                  <option value="OBRA">OBRA Waiver</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Managed Care Plan</label>
                <select className="form-select">
                  <option value="">Select…</option>
                  <option>Community HealthChoices (CHC)</option>
                  <option>Fee-for-Service</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── 3. Service Authorization ──────────── */}
          <div id="sec-auth" className="form-section-card">
            <div className="form-section-heading">Service Authorization</div>
            <div className="form-section-sub">Authorized PA ODP services and unit allocations for this client.</div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Service Code <span className="req">*</span></label>
                <select className="form-select" value={form.procedureCode} onChange={set('procedureCode')}>
                  <option value="">Select service…</option>
                  <option value="W7076">W7076 — Companion Services</option>
                  <option value="W7060">W7060 — In-Home &amp; Community Support</option>
                  <option value="W9494">W9494 — Respite (Unlicensed)</option>
                  <option value="W9495">W9495 — Respite Day (eff. 7/1/2025)</option>
                  <option value="S5130">S5130 — Homemaker</option>
                  <option value="W9783">W9783 — Community Support AAW</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Authorized Units (15-min)</label>
                <input className="form-input" type="number" placeholder="e.g. 1040" min={1}
                  value={form.authorizedUnits} onChange={set('authorizedUnits')} />
              </div>
            </div>
            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Authorization Start</label>
                <input className="form-input" type="date"
                  value={form.authStart} onChange={set('authStart')} />
              </div>
              <div className="form-field">
                <label className="form-label">Authorization End</label>
                <input className="form-input" type="date"
                  value={form.authEnd} onChange={set('authEnd')} />
              </div>
              <div className="form-field">
                <label className="form-label">Place of Service</label>
                <select className="form-select" value={form.placeOfService} onChange={set('placeOfService')}>
                  <option value="12">12 — Home</option>
                  <option value="99">99 — Community</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" placeholder="Additional authorization notes…"
                  value={form.authNotes} onChange={set('authNotes')} />
              </div>
            </div>
          </div>

          {/* ── 4. Care Plan ──────────────────────── */}
          <div id="sec-careplan" className="form-section-card">
            <div className="form-section-heading">Care Plan</div>
            <div className="form-section-sub">Initial care plan assignment and coordinator details.</div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Care Coordinator</label>
                <input className="form-input" type="text" placeholder="Coordinator full name"
                  value={form.coordinator} onChange={set('coordinator')} />
              </div>
              <div className="form-field">
                <label className="form-label">Attending Physician</label>
                <input className="form-input" type="text" placeholder="Dr. Full Name"
                  value={form.physician} onChange={set('physician')} />
              </div>
            </div>
            <div className="form-row col3">
              <div className="form-field">
                <label className="form-label">Level of Care</label>
                <select className="form-select" value={form.levelOfCare} onChange={set('levelOfCare')}>
                  <option value="">Select…</option>
                  <option>Minimal Support</option>
                  <option>Moderate Support</option>
                  <option>Intensive Support</option>
                  <option>Total Support</option>
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Plan Start Date</label>
                <input className="form-input" type="date"
                  value={form.planStart} onChange={set('planStart')} />
              </div>
              <div className="form-field">
                <label className="form-label">Review Date</label>
                <input className="form-input" type="date"
                  value={form.reviewDate} onChange={set('reviewDate')} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Initial Goals &amp; Notes</label>
                <textarea className="form-textarea" style={{ minHeight: 100 }}
                  placeholder="Describe initial care goals, support needs, and any special requirements…"
                  value={form.planNotes} onChange={set('planNotes')} />
              </div>
            </div>
          </div>

          {/* ── 5. Documents ──────────────────────── */}
          <div id="sec-documents" className="form-section-card">
            <div className="form-section-heading">Documents</div>
            <div className="form-section-sub">Upload supporting documents for the client record.</div>

            {[
              ['Care Plan Document', 'PDF or Word (.pdf, .doc, .docx)'],
              ['Service Agreement', 'PDF or Word (.pdf, .doc, .docx)'],
              ['Insurance Card / Eligibility', 'PDF, JPG, or PNG'],
              ['Medical Release Form', 'PDF or Word (.pdf, .doc, .docx)'],
            ].map(([label, hint]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px', border: '1px dashed var(--line)', borderRadius: 6, marginBottom: 10, background: 'var(--surface-soft)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8L14 2z"/>
                  <path d="M14 2v6h6"/><path d="M12 12v6M9 15l3-3 3 3"/>
                </svg>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</div>
                </div>
                <button className="btn secondary" style={{ fontSize: 11, height: 28 }}>Choose File</button>
              </div>
            ))}
          </div>

          {/* Footer actions */}
          <div className="form-footer">
            <Link href="/clients" className="btn secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              Cancel
            </Link>
            <button className="btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save & Add Client'}
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  );
}
