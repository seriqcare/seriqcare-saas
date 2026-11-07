'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-context';
import {
  FIELD_TYPES,
  TEMPLATE_CATEGORIES,
  OPTIONS_REQUIRED_TYPES,
  type FieldSchema,
  type SectionSchema,
  type TemplateDetail,
} from '@/lib/queries/documentation';

interface Props {
  mode: 'create' | 'edit';
  initial?: TemplateDetail;
}

interface EditingFieldState {
  sectionId: string;
  fieldIdx: number | null;
  template: FieldSchema;
}

interface ActiveDragState {
  type: 'section' | 'field';
  label: string;
}

function makeFieldKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}

function makeSectionKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'section';
}

function sectionIdFor(section: SectionSchema, idx: number): string {
  return `section:${section.key || `idx_${idx}`}`;
}

function fieldIdFor(sectionId: string, field: FieldSchema, idx: number): string {
  return `field:${sectionId}:${field.key || `idx_${idx}`}`;
}

function normalizeFields(fields: FieldSchema[]): FieldSchema[] {
  return fields.map((field, idx) => ({ ...field, sort_order: idx }));
}

function normalizeSections(sections: SectionSchema[]): SectionSchema[] {
  return sections.map((section, idx) => ({
    ...section,
    sort_order: idx,
    fields: normalizeFields(section.fields),
  }));
}

function blankField(): FieldSchema {
  return {
    key: '',
    type: 'short_text',
    label: '',
    help_text: null,
    placeholder: null,
    required: false,
    default_value: null,
    options: null,
    min_length: null,
    max_length: null,
    min_value: null,
    max_value: null,
    sort_order: 0,
    width: 'full',
    is_active: true,
  };
}

function blankSection(): SectionSchema {
  return {
    key: '',
    title: '',
    description: null,
    sort_order: 0,
    fields: [],
  };
}

function makeFieldTemplate(type: string): FieldSchema {
  const label = FIELD_TYPES.find((item) => item.value === type)?.label ?? 'New Field';
  return {
    ...blankField(),
    type,
    label,
    key: makeFieldKey(label),
    options: OPTIONS_REQUIRED_TYPES.has(type) ? [] : null,
  };
}

function paletteGroups() {
  return [
    {
      title: 'Inputs',
      items: FIELD_TYPES.filter((item) => ['short_text', 'long_text', 'number', 'date', 'time', 'datetime'].includes(item.value)),
    },
    {
      title: 'Choices',
      items: FIELD_TYPES.filter((item) => ['dropdown', 'radio', 'checkbox', 'yes_no'].includes(item.value)),
    },
    {
      title: 'Workflow',
      items: FIELD_TYPES.filter((item) => ['instruction_block', 'staff_selector', 'patient_selector', 'signature_placeholder', 'file_upload_placeholder'].includes(item.value)),
    },
  ];
}

function findSectionIndex(sections: SectionSchema[], sectionId: string): number {
  return sections.findIndex((section, idx) => sectionIdFor(section, idx) === sectionId);
}

function templateStats(sections: SectionSchema[]) {
  const fieldCount = sections.reduce((sum, section) => sum + section.fields.length, 0);
  const requiredCount = sections.reduce(
    (sum, section) => sum + section.fields.filter((field) => field.required).length,
    0
  );
  return { fieldCount, requiredCount };
}

interface FieldEditorProps {
  field: FieldSchema;
  onSave: (f: FieldSchema) => void;
  onClose: () => void;
}

function FieldEditor({ field: initial, onSave, onClose }: FieldEditorProps) {
  const [f, setF] = useState<FieldSchema>({ ...initial });
  const [optionText, setOptionText] = useState('');

  const set = <K extends keyof FieldSchema>(k: K, v: FieldSchema[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  function handleLabelChange(v: string) {
    setF((prev) => ({
      ...prev,
      label: v,
      key: prev.key || makeFieldKey(v),
    }));
  }

  function addOption() {
    const trimmed = optionText.trim();
    if (!trimmed) return;
    const opt = { label: trimmed, value: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '_') };
    setF((prev) => ({ ...prev, options: [...(prev.options ?? []), opt] }));
    setOptionText('');
  }

  function removeOption(idx: number) {
    setF((prev) => ({ ...prev, options: prev.options?.filter((_, i) => i !== idx) ?? null }));
  }

  const needsOptions = OPTIONS_REQUIRED_TYPES.has(f.type);

  return (
    <div className="doc-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="doc-modal-card">
        <div className="doc-modal-header">
          <div>
            <div className="card-title" style={{ fontSize: 15 }}>Configure Field</div>
            <div className="card-subtitle">Fine-tune label, validation, guidance, and layout.</div>
          </div>
          <button className="doc-close-btn" onClick={onClose} aria-label="Close field editor">×</button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={FIELD_ROW}>
            <label style={LABEL}>Field Type</label>
            <select style={INPUT} value={f.type} onChange={(e) => set('type', e.target.value)}>
              {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div style={FIELD_ROW}>
            <label style={LABEL}>Label</label>
            <input style={INPUT} value={f.label} onChange={(e) => handleLabelChange(e.target.value)} placeholder="e.g. Services Provided" />
          </div>

          <div style={FIELD_ROW}>
            <label style={LABEL}>Field Key</label>
            <input style={INPUT} value={f.key} onChange={(e) => set('key', e.target.value)} placeholder="services_provided" />
            <div style={HINT}>Used in stored submissions. Keep it stable once templates are in use.</div>
          </div>

          <div style={FIELD_ROW}>
            <label style={LABEL}>Help Text</label>
            <input style={INPUT} value={f.help_text ?? ''} onChange={(e) => set('help_text', e.target.value || null)} placeholder="Explain how staff should complete this field" />
          </div>

          <div style={FIELD_ROW}>
            <label style={LABEL}>Placeholder</label>
            <input style={INPUT} value={f.placeholder ?? ''} onChange={(e) => set('placeholder', e.target.value || null)} placeholder="Optional placeholder" />
          </div>

          <div className="doc-inline-check">
            <input
              type="checkbox"
              id="field-required"
              checked={f.required}
              onChange={(e) => set('required', e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="field-required" style={{ fontSize: 13, cursor: 'pointer' }}>Required field</label>
          </div>

          {(f.type === 'short_text' || f.type === 'long_text') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Min Length</label>
                <input style={INPUT} type="number" value={f.min_length ?? ''} onChange={(e) => set('min_length', e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Max Length</label>
                <input style={INPUT} type="number" value={f.max_length ?? ''} onChange={(e) => set('max_length', e.target.value ? Number(e.target.value) : null)} />
              </div>
            </div>
          )}

          {f.type === 'number' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Min Value</label>
                <input style={INPUT} type="number" value={f.min_value ?? ''} onChange={(e) => set('min_value', e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Max Value</label>
                <input style={INPUT} type="number" value={f.max_value ?? ''} onChange={(e) => set('max_value', e.target.value ? Number(e.target.value) : null)} />
              </div>
            </div>
          )}

          {needsOptions && (
            <div style={FIELD_ROW}>
              <label style={LABEL}>Options</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...INPUT, flex: 1 }}
                  value={optionText}
                  onChange={(e) => setOptionText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                  placeholder="Add option and press Enter"
                />
                <button className="btn secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={addOption}>Add</button>
              </div>
              <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {(f.options ?? []).map((opt, i) => (
                  <div key={i} className="doc-option-row">
                    <span>{opt.label}</span>
                    <button onClick={() => removeOption(i)} className="doc-inline-danger" aria-label={`Remove ${opt.label}`}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={FIELD_ROW}>
            <label style={LABEL}>Width</label>
            <select style={INPUT} value={f.width ?? 'full'} onChange={(e) => set('width', e.target.value)}>
              <option value="full">Full width</option>
              <option value="half">Half width</option>
            </select>
          </div>
        </div>

        <div className="doc-modal-actions">
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            onClick={() => {
              if (!f.key.trim()) {
                f.key = f.label.trim() ? makeFieldKey(f.label) : `field_${Date.now()}`;
              }
              onSave(f);
            }}
          >
            Save Field
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateBuilderClient({ mode, initial }: Props) {
  const router = useRouter();
  const { apiFetch } = useAuth();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [sections, setSections] = useState<SectionSchema[]>(normalizeSections(initial?.template_schema?.sections ?? []));
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    (initial?.template_schema?.sections?.[0] && sectionIdFor(initial.template_schema.sections[0], 0)) || null
  );
  const [editingField, setEditingField] = useState<EditingFieldState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!sections.length) {
      setSelectedSectionId(null);
      return;
    }
    if (!selectedSectionId || findSectionIndex(sections, selectedSectionId) === -1) {
      setSelectedSectionId(sectionIdFor(sections[0], 0));
    }
  }, [sections, selectedSectionId]);

  const addSection = () => {
    const nextIndex = sections.length + 1;
    const section = blankSection();
    section.title = `Section ${nextIndex}`;
    section.key = makeSectionKey(section.title);
    const nextSections = normalizeSections([...sections, section]);
    const nextId = sectionIdFor(nextSections[nextSections.length - 1], nextSections.length - 1);
    setSections(nextSections);
    setSelectedSectionId(nextId);
  };

  const updateSection = (sectionId: string, patch: Partial<SectionSchema>) => {
    setSections((prev) => normalizeSections(prev.map((section, idx) => {
      if (sectionIdFor(section, idx) !== sectionId) return section;
      return { ...section, ...patch };
    })));
  };

  const removeSection = (sectionId: string) => {
    setSections((prev) => normalizeSections(prev.filter((section, idx) => sectionIdFor(section, idx) !== sectionId)));
  };

  const openAddField = (type: string, targetSectionId?: string) => {
    const sectionId = targetSectionId ?? selectedSectionId;
    if (!sectionId) {
      setError('Add a section first, then choose where to place your field.');
      return;
    }
    setError(null);
    setSelectedSectionId(sectionId);
    setEditingField({ sectionId, fieldIdx: null, template: makeFieldTemplate(type) });
  };

  const saveField = (sectionId: string, fieldIdx: number | null, field: FieldSchema) => {
    setSections((prev) => normalizeSections(prev.map((section, idx) => {
      if (sectionIdFor(section, idx) !== sectionId) return section;
      const fields = [...section.fields];
      if (fieldIdx === null) {
        fields.push({ ...field, sort_order: fields.length });
      } else {
        fields[fieldIdx] = field;
      }
      return { ...section, fields };
    })));
    setEditingField(null);
  };

  const removeField = (sectionId: string, fieldIdx: number) => {
    setSections((prev) => normalizeSections(prev.map((section, idx) => {
      if (sectionIdFor(section, idx) !== sectionId) return section;
      return { ...section, fields: section.fields.filter((_, currentIdx) => currentIdx !== fieldIdx) };
    })));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (!data) return;
    setActiveDrag({
      type: data.type,
      label: data.label ?? 'Untitled item',
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (!activeData || !overData) return;

    if (activeData.type === 'section' && overData.type === 'section') {
      setSections((prev) => {
        const oldIndex = findSectionIndex(prev, activeData.sectionId);
        const newIndex = findSectionIndex(prev, overData.sectionId);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return normalizeSections(arrayMove(prev, oldIndex, newIndex));
      });
      return;
    }

    if (activeData.type !== 'field') return;

    setSections((prev) => {
      const next = prev.map((section) => ({ ...section, fields: [...section.fields] }));
      const sourceSectionIdx = findSectionIndex(next, activeData.sectionId);
      if (sourceSectionIdx === -1) return prev;

      const sourceFields = next[sourceSectionIdx].fields;
      const movingIndex = activeData.fieldIdx;
      if (movingIndex < 0 || movingIndex >= sourceFields.length) return prev;

      if (overData.type === 'field') {
        const targetSectionIdx = findSectionIndex(next, overData.sectionId);
        if (targetSectionIdx === -1) return prev;

        if (sourceSectionIdx === targetSectionIdx) {
          next[sourceSectionIdx].fields = arrayMove(sourceFields, movingIndex, overData.fieldIdx);
          return normalizeSections(next);
        }

        const [movedField] = sourceFields.splice(movingIndex, 1);
        next[targetSectionIdx].fields.splice(overData.fieldIdx, 0, movedField);
        return normalizeSections(next);
      }

      if (overData.type === 'field-container') {
        const targetSectionIdx = findSectionIndex(next, overData.sectionId);
        if (targetSectionIdx === -1) return prev;
        const [movedField] = sourceFields.splice(movingIndex, 1);
        next[targetSectionIdx].fields.push(movedField);
        return normalizeSections(next);
      }

      return prev;
    });
  };

  const handleSave = useCallback(
    async (publishAfter = false) => {
      if (!name.trim()) {
        setError('Template name is required.');
        return;
      }

      setSaving(true);
      setError(null);

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
        template_schema: { sections: normalizeSections(sections) },
      };

      try {
        let res: Response;
        if (mode === 'create' || !initial?.id) {
          res = await apiFetch('/api/documentation/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await apiFetch(`/api/documentation/templates/${initial.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.detail ?? 'Save failed. Please try again.');
          setSaving(false);
          return;
        }

        const saved: TemplateDetail = await res.json();

        if (publishAfter) {
          const pubRes = await apiFetch(`/api/documentation/templates/${saved.id}/publish`, { method: 'POST' });
          if (!pubRes.ok) {
            const body = await pubRes.json().catch(() => ({}));
            setError(body?.detail ?? 'Publish failed.');
            setSaving(false);
            router.push(`/documentation/templates/${saved.id}`);
            return;
          }
        }

        router.push('/documentation/templates');
      } catch {
        setError('Network error. Please try again.');
        setSaving(false);
      }
    },
    [name, description, category, sections, mode, initial, apiFetch, router]
  );

  if (preview) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="doc-preview-header">
          <div>
            <div className="page-title" style={{ marginBottom: 4 }}>Template Preview</div>
            <div className="page-subtitle">Review the form exactly as staff will see it before publishing.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn secondary" onClick={() => setPreview(false)}>Back to Builder</button>
            <button className="btn secondary" onClick={() => handleSave(false)} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
            <button className="btn" onClick={() => handleSave(true)} disabled={saving}>{saving ? 'Saving…' : 'Save & Publish'}</button>
          </div>
        </div>
        <TemplatePreview name={name} description={description} sections={sections} />
      </div>
    );
  }

  const selectedSectionIdx = selectedSectionId ? findSectionIndex(sections, selectedSectionId) : -1;
  const selectedSection = selectedSectionIdx >= 0 ? sections[selectedSectionIdx] : null;
  const stats = templateStats(sections);
  const sectionIds = sections.map((section, idx) => sectionIdFor(section, idx));

  return (
    <div className="doc-builder">
      {error && (
        <div style={{ padding: '10px 14px', background: '#fdf4f4', border: '1px solid #f5c5c5', borderRadius: 8, color: '#b23b3b', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="doc-builder-toolbar card">
        <div>
          <div className="card-title" style={{ fontSize: 16 }}>SeriqCare Template Builder</div>
          <div className="card-subtitle">
            Structure sections, add fields from the palette, and keep version-safe publishing intact.
          </div>
        </div>
        <div className="doc-builder-toolbar-actions">
          <button className="btn secondary" onClick={() => router.push('/documentation/templates')}>Cancel</button>
          <button className="btn secondary" onClick={() => setPreview(true)}>Preview</button>
          <button className="btn secondary" onClick={() => handleSave(false)} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
          <button className="btn" onClick={() => handleSave(true)} disabled={saving}>{saving ? 'Saving…' : 'Save & Publish'}</button>
        </div>
      </div>

      <div className="doc-builder-shell">
        <aside className="doc-builder-sidebar">
          <div className="card doc-builder-panel">
            <div className="card-title">Template Details</div>
            <div className="card-subtitle">Define how this form should appear in your agency's library.</div>
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Template Name <span style={{ color: '#d56b6b' }}>*</span></label>
                <input style={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily Care Note" />
              </div>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Category</label>
                <select style={INPUT} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— Select category —</option>
                  {TEMPLATE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div style={FIELD_ROW}>
                <label style={LABEL}>Description</label>
                <textarea
                  style={{ ...INPUT, minHeight: 96, resize: 'vertical' }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe when this template should be used"
                />
              </div>
            </div>
          </div>

          <div className="card doc-builder-panel">
            <div className="card-title">Builder Snapshot</div>
            <div className="doc-builder-stats">
              <div className="doc-builder-stat">
                <span>Sections</span>
                <strong>{sections.length}</strong>
              </div>
              <div className="doc-builder-stat">
                <span>Fields</span>
                <strong>{stats.fieldCount}</strong>
              </div>
              <div className="doc-builder-stat">
                <span>Required</span>
                <strong>{stats.requiredCount}</strong>
              </div>
            </div>
            <div className="doc-builder-status">
              {selectedSection
                ? `Selected section: ${selectedSection.title || 'Untitled section'}`
                : 'Select or create a section to place new fields.'}
            </div>
          </div>

          <div className="card doc-builder-panel">
            <div className="card-title">Field Palette</div>
            <div className="card-subtitle">Click a field to add it into the selected section.</div>
            <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
              {paletteGroups().map((group) => (
                <div key={group.title}>
                  <div className="doc-palette-group-title">{group.title}</div>
                  <div className="doc-palette-grid">
                    {group.items.map((item) => (
                      <button
                        key={item.value}
                        className="doc-palette-btn"
                        onClick={() => openAddField(item.value)}
                      >
                        <span className="doc-palette-icon">{fieldTypeGlyph(item.value)}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="doc-builder-main">
          <div className="card doc-builder-canvas-head">
            <div>
              <div className="card-title">Template Structure</div>
              <div className="card-subtitle">Drag sections and fields to reorder. Select a section to route new fields from the palette.</div>
            </div>
            <button className="btn secondary" onClick={addSection}>
              + Add Section
            </button>
          </div>

          {!sections.length ? (
            <div className="card doc-canvas-empty">
              <div className="doc-canvas-empty-title">Start with your first section</div>
              <div className="doc-canvas-empty-text">Create a section, then use the field palette to build a form that matches how your staff documents care.</div>
              <button className="btn" onClick={addSection}>Create Section</button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
                <div style={{ display: 'grid', gap: 14 }}>
                  {sections.map((section, sectionIdx) => {
                    const sectionId = sectionIdFor(section, sectionIdx);
                    return (
                      <SortableSectionCard
                        key={sectionId}
                        section={section}
                        sectionId={sectionId}
                        sectionIdx={sectionIdx}
                        selected={selectedSectionId === sectionId}
                        onSelect={() => setSelectedSectionId(sectionId)}
                        onUpdate={updateSection}
                        onRemove={removeSection}
                        onOpenField={(type) => openAddField(type, sectionId)}
                        onEditField={(fieldIdx) => setEditingField({
                          sectionId,
                          fieldIdx,
                          template: sections[sectionIdx].fields[fieldIdx],
                        })}
                        onRemoveField={removeField}
                      />
                    );
                  })}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeDrag ? <DragGhost label={activeDrag.label} type={activeDrag.type} /> : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>

      {editingField !== null && (
        <FieldEditor
          field={editingField.template}
          onSave={(field) => saveField(editingField.sectionId, editingField.fieldIdx, field)}
          onClose={() => setEditingField(null)}
        />
      )}
    </div>
  );
}

interface SortableSectionCardProps {
  section: SectionSchema;
  sectionId: string;
  sectionIdx: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (sectionId: string, patch: Partial<SectionSchema>) => void;
  onRemove: (sectionId: string) => void;
  onOpenField: (type: string) => void;
  onEditField: (fieldIdx: number) => void;
  onRemoveField: (sectionId: string, fieldIdx: number) => void;
}

function SortableSectionCard({
  section,
  sectionId,
  sectionIdx,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onOpenField,
  onEditField,
  onRemoveField,
}: SortableSectionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sectionId,
    data: { type: 'section', sectionId, label: section.title || `Section ${sectionIdx + 1}` },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  const fieldIds = section.fields.map((field, fieldIdx) => fieldIdFor(sectionId, field, fieldIdx));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`doc-section-card${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="doc-section-header">
        <div className="doc-section-heading">
          <button className="doc-drag-handle" aria-label="Drag section" {...attributes} {...listeners}>
            <GripIcon />
          </button>
          <div style={{ flex: 1 }}>
            <input
              style={{ ...INPUT, fontWeight: 700, fontSize: 15, marginBottom: 8 }}
              value={section.title}
              onChange={(e) => {
                const title = e.target.value;
                onUpdate(sectionId, { title, key: section.key || makeSectionKey(title) });
              }}
              placeholder="Section Title"
            />
            <input
              style={{ ...INPUT, fontSize: 12 }}
              value={section.description ?? ''}
              onChange={(e) => onUpdate(sectionId, { description: e.target.value || null })}
              placeholder="Optional section description"
            />
          </div>
        </div>
        <div className="doc-section-actions">
          <span className="doc-section-count">{section.fields.length} field{section.fields.length === 1 ? '' : 's'}</span>
          <button className="btn secondary" style={ICON_BTN} onClick={() => onOpenField('short_text')}>+ Field</button>
          <button className="btn secondary" style={{ ...ICON_BTN, color: '#b24a4a' }} onClick={() => onRemove(sectionId)}>Remove</button>
        </div>
      </div>

      <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
        <FieldContainer sectionId={sectionId} empty={section.fields.length === 0}>
          {section.fields.length === 0 ? (
            <div className="doc-section-empty">
              <div>No fields yet in this section.</div>
              <div className="doc-section-empty-actions">
                <button className="btn secondary" onClick={() => onOpenField('short_text')}>Add Short Text</button>
                <button className="btn secondary" onClick={() => onOpenField('instruction_block')}>Add Instruction</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {section.fields.map((field, fieldIdx) => (
                <SortableFieldCard
                  key={fieldIdFor(sectionId, field, fieldIdx)}
                  sectionId={sectionId}
                  field={field}
                  fieldIdx={fieldIdx}
                  onEdit={() => onEditField(fieldIdx)}
                  onRemove={() => onRemoveField(sectionId, fieldIdx)}
                />
              ))}
            </div>
          )}
        </FieldContainer>
      </SortableContext>
    </div>
  );
}

function FieldContainer({ sectionId, empty, children }: { sectionId: string; empty: boolean; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop:${sectionId}`,
    data: { type: 'field-container', sectionId },
  });

  return (
    <div ref={setNodeRef} className={`doc-dropzone${isOver ? ' is-over' : ''}${empty ? ' is-empty' : ''}`}>
      {children}
    </div>
  );
}

function SortableFieldCard({
  sectionId,
  field,
  fieldIdx,
  onEdit,
  onRemove,
}: {
  sectionId: string;
  field: FieldSchema;
  fieldIdx: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const id = fieldIdFor(sectionId, field, fieldIdx);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: {
      type: 'field',
      sectionId,
      fieldIdx,
      label: field.label || FIELD_TYPES.find((item) => item.value === field.type)?.label || 'Field',
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="doc-field-card">
      <div className="doc-field-main">
        <button className="doc-drag-handle small" aria-label="Drag field" {...attributes} {...listeners}>
          <GripIcon />
        </button>
        <div style={{ flex: 1 }}>
          <div className="doc-field-title-row">
            <span className="doc-field-title">{field.label || '(unlabeled field)'}</span>
            {field.required && <span className="doc-required-pill">Required</span>}
            {!field.is_active && <span className="doc-muted-pill">Inactive</span>}
          </div>
          <div className="doc-field-meta">
            <span>{FIELD_TYPES.find((item) => item.value === field.type)?.label ?? field.type}</span>
            <span>{field.key || 'missing_key'}</span>
            {field.width && <span>{field.width} width</span>}
          </div>
          {field.help_text && <div className="doc-field-help">{field.help_text}</div>}
        </div>
      </div>
      <div className="doc-field-actions">
        <button className="btn secondary" style={ICON_BTN} onClick={onEdit}>Edit</button>
        <button className="btn secondary" style={{ ...ICON_BTN, color: '#b24a4a' }} onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

function DragGhost({ type, label }: ActiveDragState) {
  return (
    <div className={`doc-drag-ghost ${type}`}>
      <GripIcon />
      <span>{label}</span>
    </div>
  );
}

function TemplatePreview({ name, description, sections }: { name: string; description: string; sections: SectionSchema[] }) {
  return (
    <div className="doc-preview-shell">
      <div className="doc-preview-card">
        <div style={{ display: 'grid', gap: 6, marginBottom: 22 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{name || '(unnamed template)'}</div>
          {description && <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 700 }}>{description}</div>}
        </div>
        <div style={{ display: 'grid', gap: 18 }}>
          {sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="doc-preview-section">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{section.title}</div>
              {section.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{section.description}</div>}
              <div style={{ display: 'grid', gap: 14 }}>
                {section.fields.filter((field) => field.is_active).map((field, fieldIdx) => (
                  <PreviewField key={fieldIdx} field={field} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewField({ field: f }: { field: FieldSchema }) {
  if (f.type === 'instruction_block') {
    return (
      <div style={{ padding: '12px 14px', background: '#eef5fb', borderLeft: '3px solid #2567a4', borderRadius: 8, fontSize: 13, color: '#1a3f6f' }}>
        {f.label}
      </div>
    );
  }

  const labelEl = (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'block' }}>
      {f.label}
      {f.required && <span style={{ color: '#d56b6b', marginLeft: 3 }}>*</span>}
    </label>
  );

  let inputEl: React.ReactNode = null;
  switch (f.type) {
    case 'long_text':
      inputEl = <textarea style={{ ...INPUT, height: 88, resize: 'none', opacity: 0.7 }} disabled placeholder={f.placeholder ?? ''} />;
      break;
    case 'date':
      inputEl = <input style={INPUT} type="date" disabled />;
      break;
    case 'time':
      inputEl = <input style={INPUT} type="time" disabled />;
      break;
    case 'datetime':
      inputEl = <input style={INPUT} type="datetime-local" disabled />;
      break;
    case 'number':
      inputEl = <input style={INPUT} type="number" disabled placeholder={f.placeholder ?? ''} />;
      break;
    case 'yes_no':
      inputEl = (
        <div style={{ display: 'flex', gap: 16 }}>
          {['Yes', 'No'].map((v) => (
            <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'default' }}>
              <input type="radio" disabled /> {v}
            </label>
          ))}
        </div>
      );
      break;
    case 'radio':
      inputEl = (
        <div style={{ display: 'grid', gap: 6 }}>
          {(f.options ?? []).map((o) => (
            <label key={o.value} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'default' }}>
              <input type="radio" disabled /> {o.label}
            </label>
          ))}
        </div>
      );
      break;
    case 'checkbox':
      inputEl = (
        <div style={{ display: 'grid', gap: 6 }}>
          {(f.options ?? []).map((o) => (
            <label key={o.value} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'default' }}>
              <input type="checkbox" disabled /> {o.label}
            </label>
          ))}
        </div>
      );
      break;
    case 'dropdown':
      inputEl = (
        <select style={INPUT} disabled>
          <option>{f.placeholder ?? '— Select —'}</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'signature_placeholder':
      inputEl = <PreviewPlaceholder text="Signature area captured on device" />;
      break;
    case 'file_upload_placeholder':
      inputEl = <PreviewPlaceholder text="File upload collected during documentation" />;
      break;
    case 'staff_selector':
      inputEl = <input style={INPUT} type="text" disabled placeholder="Select staff member…" />;
      break;
    case 'patient_selector':
      inputEl = <input style={INPUT} type="text" disabled placeholder="Select patient…" />;
      break;
    default:
      inputEl = <input style={INPUT} type="text" disabled placeholder={f.placeholder ?? ''} />;
  }

  return (
    <div>
      {labelEl}
      {f.help_text && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{f.help_text}</div>}
      {inputEl}
    </div>
  );
}

function PreviewPlaceholder({ text }: { text: string }) {
  return (
    <div style={{ height: 56, border: '2px dashed var(--line)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)', background: '#f8fbfe' }}>
      {text}
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="4" cy="3.5" r="1" fill="currentColor" />
      <circle cx="10" cy="3.5" r="1" fill="currentColor" />
      <circle cx="4" cy="7" r="1" fill="currentColor" />
      <circle cx="10" cy="7" r="1" fill="currentColor" />
      <circle cx="4" cy="10.5" r="1" fill="currentColor" />
      <circle cx="10" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

function fieldTypeGlyph(type: string): string {
  switch (type) {
    case 'short_text':
    case 'long_text':
      return 'T';
    case 'number':
      return '#';
    case 'date':
      return 'D';
    case 'time':
      return 'H';
    case 'datetime':
      return 'DT';
    case 'dropdown':
      return 'V';
    case 'radio':
      return 'O';
    case 'checkbox':
      return 'C';
    case 'yes_no':
      return 'Y';
    case 'instruction_block':
      return 'I';
    case 'signature_placeholder':
      return 'S';
    case 'file_upload_placeholder':
      return 'F';
    case 'staff_selector':
      return 'U';
    case 'patient_selector':
      return 'P';
    default:
      return '+';
  }
}

const FIELD_ROW: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text)',
};

const HINT: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--muted)',
};

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  fontSize: 13,
  border: '1px solid var(--line)',
  borderRadius: 8,
  outline: 'none',
  background: '#fff',
  boxSizing: 'border-box',
};

const ICON_BTN: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  minWidth: 40,
};
