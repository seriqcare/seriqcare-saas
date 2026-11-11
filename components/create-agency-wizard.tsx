'use client';

import { useEffect, useRef, useState } from 'react';

const steps = [
  { title: 'Basic information', description: 'Name, code & plan' },
  { title: 'Contact & setup', description: 'Location & integrations' },
  { title: 'Admin account', description: 'Your agency administrator' },
  { title: 'Review & create', description: 'One final look' },
];

const descriptions = [
  'Let’s start with a few details about your agency.',
  'Add the agency’s contact details and provider information.',
  'Choose who will manage this agency. We’ll email them a secure setup link.',
  'Check the details below before creating the agency and its admin account.',
];

type Props = {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onCreated: () => void;
};

export function CreateAgencyWizard({ apiFetch, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    agency_code: '', name: '', tier: 'core', aggregator: 'sandata', state: 'PA',
    state_provider_id: '', sandata_provider_id: '', address1: '', city: '', zip: '', phone: '',
    primary_contact_name: '', primary_contact_email: '', admin_username: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<{
    id: number; username: string; email: string; email_sent: boolean;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const integrated = form.tier !== 'core';

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => { headingRef.current?.focus(); }, [step, success]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  };

  const navigate = (next: number) => { setError(''); setStep(next); };

  const validate = () => {
    if (!form.name.trim() || !form.agency_code.trim()) {
      setStep(0); return 'Agency name and code are required.';
    }
    if (!form.primary_contact_name.trim() || !form.admin_username.trim()) {
      setStep(2); return 'Contact name and admin username are required.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.primary_contact_email.trim())) {
      setStep(2); return 'Enter a valid contact email address.';
    }
    return '';
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving || success) return;
    if (step < 3) {
      if (step === 0 && (!form.name.trim() || !form.agency_code.trim())) {
        setError('Agency name and code are required.'); return;
      }
      if (step === 2) {
        const message = validate();
        if (message) { setError(message); return; }
      }
      navigate(step + 1);
      return;
    }
    const message = validate();
    if (message) { setError(message); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          agency_code: form.agency_code.trim().toUpperCase(),
          name: form.name.trim(),
          primary_contact_name: form.primary_contact_name.trim(),
          primary_contact_email: form.primary_contact_email.trim().toLowerCase(),
          admin_username: form.admin_username.trim(),
          aggregator: integrated ? form.aggregator : null,
          state_provider_id: form.state_provider_id.trim() || null,
          sandata_provider_id: form.sandata_provider_id.trim() || null,
          address1: form.address1.trim() || null,
          city: form.city.trim() || null,
          zip: form.zip.trim() || null,
          phone: form.phone.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.detail === 'string' ? body.detail : 'Failed to create agency. Please review the details and try again.');
        return;
      }
      const data = await res.json();
      setSuccess({ id: data.id, username: data.admin_user.username, email: data.admin_user.email, email_sent: data.email_sent });
    } catch {
      setError('Unable to confirm agency creation. Check the agency list before trying again.');
    } finally { setSaving(false); }
  };

  const field = (key: keyof typeof form, label: string, placeholder: string, required = false, type = 'text') => (
    <label className="aw-field" key={key}>
      <span>{label}{required && <span className="aw-required"> *</span>}</span>
      <input className="form-input" value={form[key]} onChange={set(key)} placeholder={placeholder} required={required} type={type}
        maxLength={key === 'agency_code' ? 20 : key === 'state' ? 2 : undefined}
        autoComplete={type === 'email' ? 'email' : key === 'phone' ? 'tel' : 'off'} />
    </label>
  );

  const review = (title: string, editStep: number, rows: [string, string][]) => (
    <section className="aw-review-section">
      <div><h3>{title}</h3>{!success && <button type="button" disabled={saving} onClick={() => navigate(editStep)}>Edit <span aria-hidden="true">↗</span></button>}</div>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>
    </section>
  );

  return (
    <div className="sa-modal-backdrop aw-backdrop" onClick={() => { if (!saving) (success ? onCreated : onClose)(); }}>
      <div ref={dialogRef} className="aw-dialog" role="dialog" aria-modal="true" aria-labelledby="agency-wizard-title"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
          if (e.key === 'Escape' && !saving) { e.stopPropagation(); (success ? onCreated : onClose)(); }
          if (e.key !== 'Tab') return;
          const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
          if (!elements?.length) return;
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
        <aside className="aw-sidebar">
          <div className="aw-brand"><span className="aw-brand-icon" aria-hidden="true">▥</span><div><strong>Create Agency</strong><span>A new beginning for better care.</span></div></div>
          <div className="aw-sidebar-label">YOUR SETUP JOURNEY</div>
          <nav aria-label="Agency creation steps"><ol className="aw-steps">
            {steps.map((item, index) => (
              <li key={item.title} className={index === step && !success ? 'is-current' : index < step || success ? 'is-complete' : ''}>
                <button type="button" disabled={saving || !!success || index > step} onClick={() => navigate(index)} aria-current={index === step ? 'step' : undefined}>
                  <span className="aw-step-number">{index < step || success ? '✓' : index + 1}</span>
                  <span className="aw-step-text"><strong>{item.title}</strong><small>{item.description}</small></span>
                  {index < step || success ? <span className="aw-step-check" aria-label="Completed">✓</span> : null}
                </button>
              </li>
            ))}
          </ol></nav>
          <div className="aw-sidebar-note"><span aria-hidden="true">◇</span><p>A dedicated space for your team.<br />Built around your agency.</p></div>
        </aside>

        <form className="aw-main" onSubmit={handleSubmit}>
          <div className="aw-topbar"><span>AGENCY SETUP</span><div><span>{success ? 'Complete' : `Step ${step + 1} of ${steps.length}`}</span><button type="button" className="aw-close" aria-label="Close create agency" disabled={saving} onClick={success ? onCreated : onClose}>×</button></div></div>
          <div className="aw-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={4} aria-valuenow={success ? 4 : step + 1}><span style={{ width: `${success ? 100 : (step + 1) * 25}%` }} /></div>
          <div className="aw-content">
            <span className="aw-eyebrow">{success ? 'ALL SET' : `STEP ${String(step + 1).padStart(2, '0')}`}</span>
            <h2 id="agency-wizard-title" ref={headingRef} tabIndex={-1}>{success ? 'Your agency is ready.' : steps[step].title}</h2>
            <p className="aw-description">{success ? 'The agency and its administrator account have been created successfully.' : descriptions[step]}</p>
            {error && <div className="sa-error" role="alert">{error}</div>}

            {success ? (
              <div className="aw-success-content">
                <div className="aw-created-id"><span>Agency ID</span><strong>{success.id}</strong><p>Use this ID when signing in to this agency.</p></div>
                {review('Administrator', 2, [['Username', success.username], ['Email', success.email]])}
                <p className={success.email_sent ? 'aw-note' : 'sa-error'}>{success.email_sent ? `An email with a password setup link has been sent to ${success.email}.` : 'The onboarding email could not be sent. The administrator can use Forgot Password with the Agency ID and email above.'}</p>
              </div>
            ) : <fieldset className="aw-fields" disabled={saving}>
              {step === 0 && <>
                {field('name', 'Agency name', 'Enter your agency’s name', true)}
                {field('agency_code', 'Agency code', 'e.g. ACME', true)}
                <p className="aw-field-help">A short, unique code to identify your agency. Your numeric Agency ID is assigned after creation.</p>
                <label className="aw-field"><span>Subscription plan</span><select className="form-select" value={form.tier} onChange={set('tier')}><option value="core">Core</option><option value="evv">EVV</option><option value="evvplus" disabled>EVV+ (planned)</option></select></label>
                <div className="aw-info"><span aria-hidden="true">i</span><p>{form.tier === 'core' ? 'Core includes the essentials for managing your home care operations.' : 'Connect an EVV aggregator in the next step to support electronic visit verification.'}</p></div>
              </>}
              {step === 1 && <>
                {field('address1', 'Street address', 'Street address')}
                <div className="aw-field-row">{field('city', 'City', 'City')}{field('state', 'State', 'PA')}</div>
                <div className="aw-field-row">{field('zip', 'ZIP code', 'ZIP code')}{field('phone', 'Phone', '(555) 000-0000', false, 'tel')}</div>
                <h3 className="aw-group-title">Provider information <span>Optional</span></h3>
                {integrated && <label className="aw-field"><span>EVV aggregator</span><select className="form-select" value={form.aggregator} onChange={set('aggregator')}><option value="sandata">Sandata</option><option value="hhax">HHAeXchange</option></select></label>}
                <div className="aw-field-row">{field('state_provider_id', 'State Provider ID', 'Provider ID')}{field('sandata_provider_id', 'Sandata Provider ID', 'Provider ID')}</div>
              </>}
              {step === 2 && <>
                {field('primary_contact_name', 'Contact name', 'Full name', true)}
                {field('primary_contact_email', 'Contact email', 'admin@agency.com', true, 'email')}
                {field('admin_username', 'Admin username', 'e.g. jsmith', true)}
                <div className="aw-info"><span aria-hidden="true">✉</span><p>No password to share. Your administrator will receive an email with a secure link to set their own password.</p></div>
              </>}
              {step === 3 && <>
                {review('Basic information', 0, [['Agency name', form.name], ['Agency code', form.agency_code.toUpperCase()], ['Plan', form.tier === 'evvplus' ? 'EVV+' : form.tier === 'evv' ? 'EVV' : 'Core']])}
                {review('Contact & setup', 1, [['Address', [form.address1, form.city, form.state, form.zip].filter(Boolean).join(', ')], ['Phone', form.phone], ['Aggregator', integrated ? form.aggregator === 'hhax' ? 'HHAeXchange' : 'Sandata' : 'Not included in Core'], ['State Provider ID', form.state_provider_id], ['Sandata Provider ID', form.sandata_provider_id]])}
                {review('Admin account', 2, [['Contact', form.primary_contact_name], ['Email', form.primary_contact_email], ['Username', form.admin_username]])}
              </>}
            </fieldset>}
          </div>
          <div className="aw-footer">
            <button type="button" className="btn secondary aw-button aw-button-secondary" disabled={saving} onClick={() => success ? onCreated() : step === 0 ? onClose() : navigate(step - 1)}>{success ? 'Close' : step === 0 ? 'Cancel' : <><span aria-hidden="true">←</span> Previous</>}</button>
            <button type={success ? 'button' : 'submit'} className="btn primary aw-button aw-button-primary" disabled={saving} onClick={success ? onCreated : undefined}>{success ? 'View agencies' : saving ? 'Creating agency…' : step === 3 ? 'Create agency' : <>Next <span aria-hidden="true">→</span></>}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
