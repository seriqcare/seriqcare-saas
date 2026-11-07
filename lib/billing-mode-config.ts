/**
 * Billing mode configuration.
 *
 * One config per integration_mode value (SANDATA | HHAX).
 * The Billing page reads integration_mode from agency settings and selects
 * the matching config. All mode-specific labels, statuses, actions, and
 * detail fields are driven from here — no hardcoded mode checks in components.
 */

export type IntegrationMode = 'SANDATA' | 'HHAX';

export interface HistoryAction {
  key: string;
  label: string;
  /** 'primary' = blue filled, 'secondary' = outline, 'danger' = red outline */
  style: 'primary' | 'secondary' | 'danger';
}

export interface DetailFieldDef {
  key: string;
  label: string;
}

export interface ModeConfig {
  mode: IntegrationMode;
  badgeLabel: string;
  /** Subtitle line shown inside the Claims Queue card */
  claimsQueueSubtitle: string;
  /** Subtitle line shown inside the Billing History card */
  historySubtitle: string;
  /** Text shown when the history list is empty */
  historyEmptyNote: string;
  /** Modal header title for the grouping preview */
  previewTitle: string;
  /** Done-state heading after generation succeeds */
  previewDoneTitle: string;
  /** Footer note shown in the done state */
  previewDoneNote: string;
  /** Section label above the groups table */
  previewGroupsLabel: string;
  /** Ordered set of status label strings for this mode */
  statuses: string[];
  /** Dot/badge colour per status label */
  statusColors: Record<string, string>;
  /**
   * Valid next-status transitions per current status.
   * A claim whose status is NOT a key here shows a static badge (no dropdown).
   */
  nextStatuses: Record<string, string[]>;
  /** Row actions rendered in the history table (in order) */
  historyActions: HistoryAction[];
  /** Fields shown in the mode-specific section of the detail drawer */
  detailFields: DetailFieldDef[];
  /** Label for the mode-specific detail section heading */
  detailSectionTitle: string;
}

/* ── SANDATA ──────────────────────────────────────────────── */
export const SANDATA_CONFIG: ModeConfig = {
  mode: 'SANDATA',
  badgeLabel: 'Mode: Sandata',

  claimsQueueSubtitle:
    'PA Medicaid · ODP / PDA · Prepares grouped visits for CSV export and PROMISe manual submission',
  historySubtitle:
    'Generated claims / exports for manual PROMISe submission tracking',
  historyEmptyNote:
    'Claims appear here after you generate them from the Claims Queue. Export as CSV for PROMISe submission.',

  previewTitle: 'Generate Claims — Grouped for CSV / PROMISe Submission',
  previewDoneTitle: 'Claims Created',
  previewDoneNote:
    'All claims created in Draft status. Export as CSV from Billing History for PROMISe manual submission.',
  previewGroupsLabel: 'CLAIM GROUPS — one claim per row, exported as CSV for PROMISe',

  statuses: ['Draft', 'Export Ready', 'Exported', 'Manually Submitted', 'Paid', 'Denied'],
  statusColors: {
    Draft:                '#8a9aaa',
    'Export Ready':       '#35693c',
    Exported:             '#2567a4',
    'Manually Submitted': '#1d5c35',
    Paid:                 '#1d5c35',
    Denied:               '#d56b6b',
    // backward-compat for existing DB rows using old status names
    Ready:                '#35693c',
    Submitted:            '#2567a4',
    Voided:               '#8a9aaa',
    Approved:             '#1d5c35',
  },
  nextStatuses: {
    Draft:                ['Export Ready', 'Voided'],
    'Export Ready':       ['Exported', 'Voided'],
    Exported:             ['Manually Submitted', 'Voided'],
    'Manually Submitted': ['Paid', 'Denied'],
    // backward-compat
    Ready:                ['Submitted', 'Voided'],
    Submitted:            ['Paid', 'Denied', 'Voided'],
  },

  historyActions: [
    { key: 'view',           label: 'View',           style: 'primary'    },
    { key: 'export_csv',     label: 'Export CSV',     style: 'secondary'  },
    { key: 'mark_submitted', label: 'Mark Submitted', style: 'secondary'  },
  ],

  detailSectionTitle: 'Submission Details',
  detailFields: [
    { key: 'csv_export_ref',   label: 'CSV Export File'  },
    { key: 'submission_notes', label: 'Submission Notes'  },
    { key: 'submitted_by',     label: 'Submitted By'      },
    { key: 'submitted_date',   label: 'Submitted Date'    },
  ],
};

/* ── HHAX ─────────────────────────────────────────────────── */
export const HHAX_CONFIG: ModeConfig = {
  mode: 'HHAX',
  badgeLabel: 'Mode: HHAeXchange',

  claimsQueueSubtitle:
    'PA Medicaid · ODP / PDA · Prepares grouped visits for HHAeXchange export',
  historySubtitle: 'HHAX export history / response tracking',
  historyEmptyNote:
    'Export records appear here after visits are exported to HHAeXchange.',

  previewTitle: 'Generate Export Records — Grouped for HHAeXchange',
  previewDoneTitle: 'Export Records Created',
  previewDoneNote:
    'All records created in Draft status. Use "Export to HHAX" in Billing History to submit.',
  previewGroupsLabel: 'EXPORT GROUPS — one export record per row, sent to HHAeXchange',

  statuses: [
    'Draft',
    'Ready for HHAX Export',
    'Exported to HHAX',
    'Response Received',
    'Billing Exception',
    'Processed',
    'Pre-Adjudication Rejected',
  ],
  statusColors: {
    Draft:                         '#8a9aaa',
    'Ready for HHAX Export':       '#35693c',
    'Exported to HHAX':            '#2567a4',
    'Response Received':           '#1d5c35',
    'Billing Exception':           '#c4831e',
    Processed:                     '#1d5c35',
    'Pre-Adjudication Rejected':   '#d56b6b',
    // backward-compat
    Ready:                         '#35693c',
    Submitted:                     '#2567a4',
    Voided:                        '#8a9aaa',
  },
  nextStatuses: {
    Draft:                   ['Ready for HHAX Export', 'Voided'],
    'Ready for HHAX Export': ['Exported to HHAX', 'Voided'],
    'Exported to HHAX':      ['Response Received', 'Billing Exception'],
    'Response Received':     ['Processed', 'Pre-Adjudication Rejected'],
    'Billing Exception':     ['Exported to HHAX'],
    // backward-compat
    Ready:                   ['Submitted', 'Voided'],
    Submitted:               ['Paid', 'Denied', 'Voided'],
  },

  historyActions: [
    { key: 'view',          label: 'View',               style: 'primary'   },
    { key: 'export_hhax',   label: 'Export to HHAX',     style: 'secondary' },
    { key: 'view_response', label: 'View HHAX Response', style: 'secondary' },
    { key: 're_export',     label: 'Re-export',          style: 'secondary' },
  ],

  detailSectionTitle: 'HHAX Export Details',
  detailFields: [
    { key: 'hhax_export_ref',     label: 'HHAX Export File / Batch'   },
    { key: 'sftp_status',         label: 'SFTP / Export Status'        },
    { key: 'hhax_response_status',label: 'HHAX Response Status'        },
    { key: 'exception_details',   label: 'Exception / Rejection'       },
    { key: 'response_file_ref',   label: 'Response File / Reference'   },
  ],
};

/* ── Selector ─────────────────────────────────────────────── */
export function getModeConfig(mode: string | null | undefined): ModeConfig {
  if (mode === 'HHAX') return HHAX_CONFIG;
  return SANDATA_CONFIG;
}
