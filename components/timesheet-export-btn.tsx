'use client';

import { useState } from 'react';
import { ExportDialog, ExportWorkspace } from './export-workspace';

export function TimesheetExportBtn({ period = 'pay_current' }: { period?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <>
    <button className="btn secondary" onClick={() => setOpen(true)}>Export Payroll</button>
    {open && <ExportDialog title="Payroll export" busy={busy} onClose={() => { if (!busy) setOpen(false); }}>
      <ExportWorkspace kind="payroll" period={period} compact onBusyChange={setBusy} />
    </ExportDialog>}
  </>;
}
