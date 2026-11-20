'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProtectedLayout } from '@/components/protected-layout';
import { useAuth } from '@/components/auth-context';
import styles from '@/components/intake-wizard.module.css';
import { refreshClientsAfterSave } from '../actions';

const SECTIONS = [
  { id: 'personal',   step: 1, label: 'Personal Info' },
  { id: 'insurance',  step: 2, label: 'Insurance & Payer' },
  { id: 'auth',       step: 3, label: 'Service Authorization' },
  { id: 'careplan',   step: 4, label: 'Care Plan' },
  { id: 'documents',  step: 5, label: 'Documents' },
];


type IntakeOptions = {
  services: { id: number; code: string; modifier: string | null; description: string; unit_type: string }[];
  providers: { id: number; name: string }[];
  waivers: { id: number; code: string; name: string }[];
};

type FormState = {
  serviceCodeId: string;
  providerId: string;
  authNumber: string;
  insuranceStart: string;
  insuranceEnd: string;
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
  payer: string;
  managedCarePlan: string;
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
  serviceCodeId: '', providerId: '', authNumber: '', insuranceStart: '', insuranceEnd: '',
  firstName: '', middleName: '', lastName: '',
  dateOfBirth: '', gender: '', language: 'English',
  ssnLast4: '', phone: '', email: '',
  streetAddress: '', city: '', state: 'PA', zipCode: '',
  emergencyName: '', emergencyRelationship: '', emergencyPhone: '',
  medicaidId: '', payer: 'Pennsylvania Medicaid (MA)', managedCarePlan: '', waiverProgram: '',
  procedureCode: '', authorizedUnits: '', authStart: '', authEnd: '',
  placeOfService: '12', authNotes: '',
  coordinator: '', physician: '', levelOfCare: '',
  planStart: '', reviewDate: '', planNotes: '',
};

export default function NewClientPage() {
  const router = useRouter();
  const { apiFetch, user } = useAuth();
  const [activeSection, setActiveSection] = useState('personal');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [options, setOptions] = useState<IntakeOptions>({ services: [], providers: [], waivers: [] });
  const [optionsError, setOptionsError] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const savePending = useRef(false);
  const selectedService = options.services.find(service => String(service.id) === form.serviceCodeId);
  useEffect(() => {
    let active = true;
    setOptionsLoading(true); setOptionsError('');
    apiFetch('/api/clients/intake-options', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Could not load services, providers, and waiver programs.');
      const data: IntakeOptions = await response.json();
      if (!active) return;
      setOptions(data);
      if (data.providers.length === 1) setForm(current => ({ ...current, providerId: current.providerId || String(data.providers[0].id) }));
    }).catch(error => { if (active) setOptionsError(error.message); }).finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [apiFetch, optionsRetry, user?.agency_id]);

  const headingRef = useRef<HTMLDivElement>(null);
  const draftKey = user ? `seriqcare-client-draft:${user.agency_id}:${user.username}` : null;
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
        if (typeof draft.form[key] === 'string') restored[key] = draft.form[key];
      }
      setForm(restored);
      setSuccess('Saved draft restored from this browser tab.');
    } catch {
      setError('Could not restore the saved draft.');
    }
  }, [draftKey]);

  function scrollTo(id: string) {
    setActiveSection(id);
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function validateStep(id: string): string {
    if (id === 'personal') {
      if (!form.firstName.trim()) return 'First name is required.';
      if (!form.lastName.trim()) return 'Last name is required.';
      if (!form.dateOfBirth) return 'Date of birth is required.';
      if (!form.streetAddress.trim()) return 'Street address is required.';
      if (!form.city.trim()) return 'City is required.';
      if (!form.zipCode.trim()) return 'ZIP code is required.';
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Enter a valid email address.';
    }
    if (id === 'insurance' && !/^\d{10}$/.test(form.medicaidId.replace(/\D/g, ''))) return 'Medicaid ID must be exactly 10 digits.';
    if (id === 'insurance' && form.waiverProgram && !options.waivers.some(waiver => String(waiver.id) === form.waiverProgram)) return 'Select a current waiver program.';
    if (id === 'insurance' && form.insuranceStart && form.insuranceEnd && form.insuranceEnd < form.insuranceStart) return 'Insurance end must be on or after its effective date.';
    if (id === 'auth') {
      if (optionsLoading) return 'Please wait for service options to load.';
      if (optionsError) return optionsError;
      if (!form.procedureCode || !options.services.some(service => String(service.id) === form.serviceCodeId)) return 'Service code is required.';
      if (form.authStart && form.authEnd && form.authEnd < form.authStart) return 'Authorization end must be on or after the start date.';
      const hasAuthorization = Boolean(form.authorizedUnits || form.authStart || form.authEnd || form.authNotes || form.authNumber);
      if (hasAuthorization && (!form.authorizedUnits || Number(form.authorizedUnits) <= 0 || !form.authStart || !form.authEnd || !form.providerId)) return 'Complete authorization units, dates, and provider, or leave authorization details blank to add later.';

    }
    if (id === 'careplan' && form.planStart && form.reviewDate && form.reviewDate < form.planStart) return 'Review date must be on or after the plan start date.';
    return '';
  }

  function goToStep(index: number) {
    if (saving) return;
    if (index > activeIndex) {
      for (let i = 0; i < index; i++) {
        const message = validateStep(SECTIONS[i].id);
        if (message) {
          setError(message);
          scrollTo(SECTIONS[i].id);
          return;
        }
      }
      setCompleted(previous => Array.from(new Set([...previous, ...SECTIONS.slice(0, index).map(section => section.id)])));
    }
    setError('');
    setSuccess('');
    scrollTo(SECTIONS[index].id);
  }

  function saveDraft() {
    if (!draftKey) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ version: 1, form }));
      setError('');
      setSuccess('Draft saved in this browser tab. Return here to resume.');
    } catch {
      setError('Draft could not be saved. Browser storage may be unavailable.');
    }
  }

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      { setForm(f => ({ ...f, [key]: e.target.value })); setSuccess(''); setCompleted(previous => previous.filter(id => id !== activeSection)); };
  }

  async function handleSave() {
    if (saving) return;
    setError('');
    setSuccess('');

    for (const section of SECTIONS) {
      const message = validateStep(section.id);
      if (message) { setError(message); scrollTo(section.id); return; }
    }

    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);

    const payload = {
      first_name:     form.firstName.trim(),
      middle_name:    form.middleName.trim() || null,
      last_name:      form.lastName.trim(),
      date_of_birth:  form.dateOfBirth,
      medicaid_id:    form.medicaidId.replace(/\D/g, ''),
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
      primary_language: form.language.trim() || null,
      emergency_contact_name: form.emergencyName.trim() || null,
      emergency_contact_relationship: form.emergencyRelationship || null,
      emergency_contact_phone: form.emergencyPhone.trim() || null,
      payer_name: form.payer || null,
      managed_care_plan: form.managedCarePlan || null,
      waiver_id: form.waiverProgram ? Number(form.waiverProgram) : null,
      insurance_effective_date: form.insuranceStart || null,
      insurance_end_date: form.insuranceEnd || null,
      service_code_id: form.serviceCodeId ? Number(form.serviceCodeId) : null,
      provider_id: (form.authorizedUnits || form.authStart || form.authEnd || form.authNotes || form.authNumber) && form.providerId ? Number(form.providerId) : null,
      auth_number: form.authNumber.trim() || null,
      authorized_units: form.authorizedUnits ? Number(form.authorizedUnits) : null,
      authorization_start: form.authStart || null,
      authorization_end: form.authEnd || null,
      place_of_service: form.placeOfService,
      auth_notes: form.authNotes.trim() || null,
      care_coordinator: form.coordinator.trim() || null,
      physician: form.physician.trim() || null,
      level_of_care: form.levelOfCare || null,
      care_plan_start_date: form.planStart || null,
      care_plan_review_date: form.reviewDate || null,
      care_plan_notes: form.planNotes.trim() || null,

    };
    try {
      const res = await apiFetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        try { if (draftKey) sessionStorage.removeItem(draftKey); } catch { /* Client was saved successfully. */ }
        const data = await res.json().catch(() => ({}));
        const sandataNote = data.sandata_status
          ? ` Sandata simulator: ${data.sandata_status}.`
          : '';
        setSuccess(`${data.message ?? 'Client saved.'}${sandataNote}`);
        try {
          await refreshClientsAfterSave();
        } catch {
          // The client is already saved; clear local route state if revalidation fails.
          router.refresh();
        }
        router.push('/clients');
        return;
      }

      const body = await res.json().catch(() => ({}));
      setError(typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((item: { msg: string }) => item.msg).join(' ') : 'Failed to save client.');
    } catch {
      setError('Could not reach server.');
    }
    savePending.current = false;
    setSaving(false);
  }

  return (
    <ProtectedLayout className={styles.shell}>
      <div className={styles.wizard}>
      {/* Topbar */}
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            <Link href="/clients" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Clients</Link>
            <span>›</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>Add New Client</span>
          </div>
          {/* <h1 className="page-title">Add New Client</h1> */}
          <p className="page-subtitle">Complete all required sections before saving the client record.</p>
        </div>
      </div>

      <nav className={styles.steps} aria-label="Client intake steps">
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
        {/* Form body */}
        <div className={styles.formBody}>
          <div className={styles.fields}>
          <div ref={headingRef} tabIndex={-1} className={styles.stepIntro}>
            Step {activeIndex + 1} of {SECTIONS.length} · {SECTIONS[activeIndex].label}
          </div>
          {error && <div role="alert" className={styles.error}>{error}</div>}
          {success && <div role="status" className={styles.success}>{success}</div>}

          {/* ── 1. Personal Information ───────────── */}
          <div id="sec-personal" hidden={activeSection !== 'personal'} className="form-section-card">
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
          <div id="sec-insurance" hidden={activeSection !== 'insurance'} className="form-section-card">
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
                <select className="form-select" value={form.payer} onChange={set('payer')}>
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
                  {options.waivers.map(waiver => <option key={waiver.id} value={waiver.id}>{waiver.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Managed Care Plan</label>
                <select className="form-select" value={form.managedCarePlan} onChange={set('managedCarePlan')}>
                  <option value="">Select…</option>
                  <option>Community HealthChoices (CHC)</option>
                  <option>Fee-for-Service</option>
                </select>
              </div>
            </div>
            <div className="form-row col2">
              <div className="form-field"><label className="form-label">Insurance Effective Date</label><input className="form-input" type="date" value={form.insuranceStart} onChange={set('insuranceStart')} /></div>
              <div className="form-field"><label className="form-label">Insurance End Date</label><input className="form-input" type="date" value={form.insuranceEnd} onChange={set('insuranceEnd')} /></div>
            </div>
          </div>

          {/* ── 3. Service Authorization ──────────── */}
          <div id="sec-auth" hidden={activeSection !== 'auth'} className="form-section-card">
            <div className="form-section-heading">Service Authorization</div>
            <div className="form-section-sub">Authorized PA ODP services and unit allocations for this client.</div>

            <div className="form-row col2">
              <div className="form-field">
                <label className="form-label">Service Code <span className="req">*</span></label>
                <select className="form-select" value={form.serviceCodeId} disabled={optionsLoading || !!optionsError} onChange={event => {
                  const service = options.services.find(item => String(item.id) === event.target.value);
                  setForm(current => ({ ...current, serviceCodeId: event.target.value, procedureCode: service?.code || '' }));
                }}>
                  <option value="">Select service...</option>
                  {options.services.map(service => <option key={service.id} value={service.id}>{service.code}{service.modifier ? ` - ${service.modifier}` : ''} - {service.description}</option>)}
                </select>

              </div>
              <div className="form-field">
                <label className="form-label">Authorized Units</label>
                <input className="form-input" type="number" placeholder="e.g. 1040" min={1}
                  value={form.authorizedUnits} onChange={set('authorizedUnits')} />
              </div>
            </div>
            <div className="form-row col2">
              <div className="form-field"><label className="form-label">Provider</label><select className="form-select" value={form.providerId} onChange={set('providerId')} disabled={optionsLoading}><option value="">Select provider...</option>{options.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></div>
              <div className="form-field"><label className="form-label">Authorization Number</label><input className="form-input" value={form.authNumber} onChange={set('authNumber')} maxLength={50} /></div>
            </div>
            <p className="form-hint">{selectedService ? `Units are measured in ${selectedService.unit_type}. ` : ''}Authorization details may be added later. If entered now, complete units, dates, and provider.</p>
            {optionsError && <div role="alert" className="error-text">{optionsError} <button type="button" className="btn secondary sm" onClick={() => setOptionsRetry(value => value + 1)}>Retry</button></div>}
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
                  maxLength={2000} value={form.authNotes} onChange={set('authNotes')} />
              </div>
            </div>
          </div>

          {/* ── 4. Care Plan ──────────────────────── */}
          <div id="sec-careplan" hidden={activeSection !== 'careplan'} className="form-section-card">
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
                  maxLength={4000} value={form.planNotes} onChange={set('planNotes')} />
              </div>
            </div>
          </div>

          {/* ── 5. Documents ──────────────────────── */}
          <div id="sec-documents" hidden={activeSection !== 'documents'} className="form-section-card">
            <div className="form-section-heading">Documents</div>
            <div className="form-section-sub">Review the supporting documents for your intake.</div>
            <p className={styles.notice}>Document uploads are not available yet. You can create the client without documents.</p>

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
                <span className={styles.badge}>Optional</span>
              </div>
            ))}
          </div>

          </div>
          {/* Footer actions */}
          <div className={styles.footer}>
            <button type="button" className="btn secondary" disabled={activeIndex === 0 || saving} onClick={() => goToStep(activeIndex - 1)}>Back</button>
            <div className={styles.footerActions}>
              <Link href="/clients" className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', pointerEvents: saving ? 'none' : undefined }} aria-disabled={saving}>Cancel</Link>
              <button type="button" className="btn secondary" disabled={saving} onClick={saveDraft}>Save Draft</button>
              {activeIndex < SECTIONS.length - 1 ? (
                <button type="button" className="btn" onClick={() => goToStep(activeIndex + 1)}>Continue to {SECTIONS[activeIndex + 1].label}</button>
              ) : (
                <button type="button" className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save & Add Client'}</button>
              )}
            </div>
          </div>
        </div>
        <aside className={styles.aside} aria-label="Intake checklist">
          <section className={styles.sideCard}>
            <h2>Intake Checklist</h2>
            <p>Track each section of the client record.</p>
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
            <p>Have these details ready to complete the client record.</p>
            <ul className={styles.requirements}>
              <li>First &amp; last name</li>
              <li>Date of birth</li>
              <li>Street address, city &amp; ZIP</li>
              <li>Medicaid ID (MA number)</li>
              <li>Service code</li>
            </ul>
          </section>
        </aside>
      </div>
      </div>
    </ProtectedLayout>
  );
}
