'use client';

import { FormEvent, ReactNode, useEffect, useRef } from 'react';
import s from './settings-panels.module.css';

export function SettingsDialog({ title, description, children, onClose, onSubmit, busy = false, error = '', submitLabel = 'Save changes', disableSubmit = false, destructive = false }: {
  title: string; description: string; children: ReactNode; onClose: () => void;
  onSubmit: (event: FormEvent) => void; busy?: boolean; error?: string; submitLabel?: string; disableSubmit?: boolean; destructive?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={s.dialog} aria-labelledby="settings-dialog-title" aria-describedby="settings-dialog-description" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={onSubmit}>
      <header className={s.dialogHeader}><h2 id="settings-dialog-title">{title}</h2><p className={s.subtitle} id="settings-dialog-description">{description}</p></header>
      <div className={s.dialogBody}><fieldset disabled={busy}>{children}</fieldset>{error && <div role="alert" className="error-text">{error}</div>}</div>
      <footer className={s.dialogFooter}><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className={destructive ? `btn ${s.dangerButton}` : 'btn primary'} disabled={busy || disableSubmit}>{busy ? destructive ? 'Deleting…' : 'Saving…' : submitLabel}</button></footer>
    </form>
  </dialog>;
}
