'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  DISPLAY_ONLY_TYPES,
  type FieldSchema,
  type SectionSchema,
  type SubmissionDetail,
  type TemplateDetail,
} from '@/lib/queries/documentation';

interface ClientOption {
  id: number;
  name: string;
  client_code: string | null;
}

interface Props {
  template: TemplateDetail;
  existingSubmission?: SubmissionDetail;
}

/**
 * State key = "<section.key>.<field.key>"
 * This prevents cross-section bleed when two sections use the same field key name
 * (e.g. both have a field called "name").
 * Submission values are stored and validated using the same compound key.
 */
function stateKey(section: SectionSchema, field: FieldSchema): string {
  return `${section.key}.${field.key}`;
}

export function FillFormClient({ template, existingSubmission }: Props) {
  const router = useRouter();
  const { apiFetch } = useAuth();

  const sections = template.template_schema?.sections ?? [];

  // Flat list of {section, field} pairs for validation
  const allPairs = sections.flatMap((s) =>
    s.fields.filter((f) => f.is_active).map((f) => ({ section: s, field: f }))
  );

  // values keyed by "<section.key>.<field.key>"
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submissionId, setSubmissionId] = useState<number | undefined>(existingSubmission?.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Patient picker state
  const [patientId, setPatientId] = useState<number | null>(existingSubmission?.patient_id ?? null);
  const [patientName, setPatientName] = useState<string>(existingSubmission?.patient_name ?? '');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientOptions, setPatientOptions] = useState<ClientOption[]>([]);
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false);
  const patientSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patientBoxRef = useRef<HTMLDivElement>(null);

  // Patient search — debounce 300 ms
  useEffect(() => {
    if (!patientDropdownOpen) return;
    if (patientSearchTimeout.current) clearTimeout(patientSearchTimeout.current);
    patientSearchTimeout.current = setTimeout(async () => {
      try {
        const qs = patientSearch.trim() ? `?search=${encodeURIComponent(patientSearch)}&take=20` : '?take=20';
        const res = await apiFetch(`/api/clients${qs}`);
        if (res.ok) {
          const data = await res.json();
          const items: ClientOption[] = (data.items ?? []).map((c: { id: number; name?: string; first_name?: string; last_name?: string; client_code?: string | null }) => ({
            id: c.id,
            name: c.name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
            client_code: c.client_code ?? null,
          }));
          setPatientOptions(items);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => { if (patientSearchTimeout.current) clearTimeout(patientSearchTimeout.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientSearch, patientDropdownOpen]);

  // Close patient dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (patientBoxRef.current && !patientBoxRef.current.contains(e.target as Node)) {
        setPatientDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Pre-populate: existing submission values take priority over field defaults
  useEffect(() => {
    const initial: Record<string, unknown> = {};

    if (existingSubmission?.values && Object.keys(existingSubmission.values).length > 0) {
      // Existing submission — values are already stored as compound keys
      Object.assign(initial, existingSubmission.values);
    } else {
      // New submission — apply field defaults
      for (const { section, field } of allPairs) {
        if (!DISPLAY_ONLY_TYPES.has(field.type) && field.default_value != null) {
          initial[stateKey(section, field)] = field.default_value;
        }
      }
    }

    if (Object.keys(initial).length) setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const { section, field } of allPairs) {
      if (DISPLAY_ONLY_TYPES.has(field.type)) continue;
      if (!field.required) continue;
      const v = values[stateKey(section, field)];
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
        errs[stateKey(section, field)] = `${field.label} is required.`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function upsertSubmission(status: 'draft' | 'submitted') {
    setGlobalError(null);
    setSavedMsg(null);

    if (status === 'submitted' && !validate()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const isDraft = status === 'draft';
    isDraft ? setSaving(true) : setSubmitting(true);

    try {
      let res: Response;
      if (!submissionId) {
        res = await apiFetch('/api/documentation/submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: template.id, values, status, patient_id: patientId }),
        });
      } else if (isDraft) {
        res = await apiFetch(`/api/documentation/submissions/${submissionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values, patient_id: patientId }),
        });
      } else {
        res = await apiFetch(`/api/documentation/submissions/${submissionId}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values, patient_id: patientId }),
        });
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.detail?.validation_errors) {
          setGlobalError('Please fix the errors below.');
          const newErrs: Record<string, string> = {};
          for (const msg of body.detail.validation_errors as string[]) {
            const pair = allPairs.find(({ field }) => msg.includes(field.label));
            if (pair) newErrs[stateKey(pair.section, pair.field)] = msg;
          }
          setErrors(newErrs);
        } else {
          setGlobalError(body?.detail ?? 'Save failed. Please try again.');
        }
        return;
      }

      const data = await res.json();
      if (!submissionId) setSubmissionId(data.id);

      if (status === 'submitted') {
        router.push(`/documentation/submissions/${data.id}`);
      } else {
        setSavedMsg('Draft saved.');
        setTimeout(() => setSavedMsg(null), 3000);
      }
    } catch {
      setGlobalError('Network error. Please try again.');
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      {globalError && (
        <div style={{ padding: '10px 14px', background: '#fdf4f4', border: '1px solid #f5c5c5', borderRadius: 6, color: '#b23b3b', fontSize: 13 }}>
          {globalError}
        </div>
      )}
      {savedMsg && (
        <div style={{ padding: '10px 14px', background: '#edf7ee', border: '1px solid #b6d9b6', borderRadius: 6, color: '#2d6130', fontSize: 13 }}>
          {savedMsg}
        </div>
      )}

      {/* ── Patient Picker ──────────────────────────────────── */}
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Assign Patient</div>
        <div ref={patientBoxRef} style={{ position: 'relative' }}>
          {patientId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, background: '#eef5fb' }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a3f6f' }}>{patientName}</div>
              <button
                type="button"
                onClick={() => { setPatientId(null); setPatientName(''); setPatientSearch(''); }}
                style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              >
                Change
              </button>
            </div>
          ) : (
            <input
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 6, outline: 'none', background: '#fff' }}
              placeholder="Search patient by name or ID…"
              value={patientSearch}
              onChange={(e) => { setPatientSearch(e.target.value); setPatientDropdownOpen(true); }}
              onFocus={() => setPatientDropdownOpen(true)}
            />
          )}
          {patientDropdownOpen && !patientId && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.10)', marginTop: 2, maxHeight: 220, overflowY: 'auto' }}>
              {patientOptions.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)' }}>No patients found</div>
              ) : patientOptions.map((p) => (
                <div
                  key={p.id}
                  onClick={() => { setPatientId(p.id); setPatientName(p.name); setPatientDropdownOpen(false); setPatientSearch(''); }}
                  style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line-soft)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--primary-soft)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  {p.client_code && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>#{p.client_code}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {sections.map((section, sIdx) => (
        <div key={sIdx} className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: section.description ? 4 : 14 }}>
            {section.title}
          </div>
          {section.description && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{section.description}</div>
          )}
          <div style={{ display: 'grid', gap: 14 }}>
            {section.fields.filter((f) => f.is_active).map((field, fIdx) => (
              <FormField
                key={fIdx}
                field={field}
                value={values[stateKey(section, field)]}
                error={errors[stateKey(section, field)]}
                onChange={(v) => setValue(stateKey(section, field), v)}
              />
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingBottom: 32 }}>
        <button className="btn secondary" onClick={() => router.back()}>Cancel</button>
        <button className="btn secondary" onClick={() => upsertSubmission('draft')} disabled={saving || submitting}>
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button className="btn" onClick={() => upsertSubmission('submitted')} disabled={saving || submitting}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual field renderer
// Label is NOT shown — section title provides context.
// Field label is used as placeholder where applicable.
// For multi-option fields (radio, checkbox, yes/no) the label is shown inline.
// ---------------------------------------------------------------------------

interface FieldProps {
  field: FieldSchema;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}

function FormField({ field: f, value, error, onChange }: FieldProps) {
  if (f.type === 'instruction_block') {
    return (
      <div style={{ padding: '10px 14px', background: '#eef5fb', borderLeft: '3px solid #2567a4', borderRadius: 4, fontSize: 13, color: '#1a3f6f' }}>
        {f.label}
      </div>
    );
  }

  if (f.type === 'signature_placeholder') {
    return (
      <div style={{ height: 70, border: '2px dashed var(--line)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
        Signature will be captured on device
      </div>
    );
  }

  if (f.type === 'file_upload_placeholder') {
    return (
      <div style={{ height: 60, border: '2px dashed var(--line)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
        File upload will be available on device
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13, boxSizing: 'border-box',
    border: `1px solid ${error ? '#d56b6b' : 'var(--line)'}`,
    borderRadius: 6, outline: 'none', background: '#fff',
  };

  // Use the field label as placeholder fallback
  const ph = f.placeholder || f.label;

  let input: React.ReactNode;

  switch (f.type) {
    case 'long_text':
      input = (
        <textarea
          style={{ ...inputStyle, height: 100, resize: 'vertical' }}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
        />
      );
      break;

    case 'date':
      input = <input style={inputStyle} type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;

    case 'time':
      input = <input style={inputStyle} type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;

    case 'datetime':
      input = <input style={inputStyle} type="datetime-local" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;

    case 'number':
      input = (
        <input
          style={inputStyle} type="number"
          value={value != null ? String(value) : ''}
          min={f.min_value ?? undefined} max={f.max_value ?? undefined}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder={ph}
        />
      );
      break;

    case 'yes_no':
      input = (
        <div style={{ display: 'flex', gap: 20 }}>
          {['Yes', 'No'].map((opt) => (
            <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" name={f.key} value={opt.toLowerCase()} checked={value === opt.toLowerCase()} onChange={() => onChange(opt.toLowerCase())} />
              {opt}
            </label>
          ))}
        </div>
      );
      break;

    case 'radio':
      input = (
        <div style={{ display: 'grid', gap: 8 }}>
          {(f.options ?? []).map((o) => (
            <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" name={f.key} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;

    case 'checkbox': {
      const checked: string[] = Array.isArray(value) ? (value as string[]) : [];
      input = (
        <div style={{ display: 'grid', gap: 8 }}>
          {(f.options ?? []).map((o) => (
            <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox" value={o.value} checked={checked.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked ? [...checked, o.value] : checked.filter((v) => v !== o.value);
                  onChange(next);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }

    case 'dropdown':
      input = (
        <select style={inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.placeholder ?? `— ${f.label} —`}</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;

    case 'staff_selector':
      input = <input style={inputStyle} type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="Enter staff name or ID" />;
      break;

    case 'patient_selector':
      input = <input style={inputStyle} type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="Enter patient name or ID" />;
      break;

    default:
      input = (
        <input
          style={inputStyle} type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
          maxLength={f.max_length ?? undefined}
        />
      );
  }

  return (
    <div>
      {f.help_text && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{f.help_text}</div>}
      {input}
      {f.required && !value && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{f.label} *</div>}
      {error && <div style={{ fontSize: 11, color: '#d56b6b', marginTop: 3 }}>{error}</div>}
    </div>
  );
}
