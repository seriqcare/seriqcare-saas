'use client';

import { useRef, useState } from 'react';
import type { VisitEntry } from '@/lib/queries/timesheets';
import { ViewModal, FixModal } from './visit-detail-modal';
import { VisitSubmitBtn } from './visit-submit-btn';
import styles from '@/app/visits/visits.module.css';

export function VisitRecordActions({ visit, aggregator }: { visit: VisitEntry; aggregator: string }) {
  const [modal, setModal] = useState<'view' | 'edit' | 'fix' | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = `visit-actions-${visit.id}`;
  const locked = Boolean(visit.edit_locked) || [visit.sandata_status, visit.hhax_status].some(status => ['Accepted', 'Submitted', 'Pending'].includes(status || ''));

  function positionMenu() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = menu.current?.offsetHeight || 160;
    const width = menu.current?.offsetWidth || 180;
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: rect.bottom + height + 6 > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
    });
  }
  function openModal(value: 'view' | 'edit' | 'fix') {
    if (value !== 'view' && locked) return;
    menu.current?.hidePopover?.();
    setModal(value);
  }

  return <div className={styles.visitActions}>
    <button type="button" className={styles.viewButton} onClick={() => openModal('view')}>View</button>
    <button type="button" ref={trigger} className={styles.moreButton} popoverTarget={menuId}
      onClick={positionMenu} aria-label={`More actions for visit ${visit.id}`} title="More actions">⋯</button>
    <div id={menuId} ref={menu} popover="auto" className={styles.actionMenu} role="group"
      aria-label={`Actions for visit ${visit.id}`} style={position}
      onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'open') positionMenu(); }}>
      <button type="button" autoFocus disabled={locked} onClick={() => openModal('edit')}
        title={locked ? 'Submitted or accepted visits are read-only.' : 'Edit visit'}>Edit visit</button>
      {['Incomplete', 'Failed'].includes(visit.evv_status) && <button type="button" disabled={locked} onClick={() => openModal('fix')}>Fix EVV issues</button>}
      {aggregator !== 'hhax' && (!visit.edit_locked || ['Accepted', 'Submitted', 'Pending'].includes(visit.sandata_status || '')) &&
        <VisitSubmitBtn visitId={visit.id} evvStatus={visit.evv_status} submissionStatus={visit.sandata_status} submissionCount={visit.sandata_submission_count} />}
    </div>
    {modal === 'view' && <ViewModal visit={visit} onClose={() => setModal(null)} />}
    {modal === 'edit' && !locked && <FixModal visit={visit} editMode onClose={() => setModal(null)} />}
    {modal === 'fix' && !locked && <FixModal visit={visit} onClose={() => setModal(null)} />}
  </div>;
}
