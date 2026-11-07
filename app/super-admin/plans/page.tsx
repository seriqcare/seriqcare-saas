'use client';

import { useState } from 'react';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { useAuth } from '@/components/auth-context';

/* ── Types ──────────────────────────────────────── */
type PlanKey = 'core' | 'evv' | 'evvplus';
type AggregatorOption = 'sandata' | 'hhax';

interface FeatureItem {
  label: string;
  included: boolean;
  config?: React.ReactNode;
}

interface FeatureSection {
  section: string;
  items: FeatureItem[];
}

interface SettingItem {
  label: string;
  config?: React.ReactNode;
}

/* ── Check icon ─────────────────────────────────── */
function CheckIcon({ included }: { included: boolean }) {
  if (included) {
    return (
      <svg className="plan-feat-icon plan-feat-icon-yes" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="8" r="7" />
        <path d="M5 8l2 2 4-4" />
      </svg>
    );
  }
  return (
    <svg className="plan-feat-icon plan-feat-icon-no" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="7" />
      <path d="M5.5 10.5l5-5M10.5 10.5l-5-5" />
    </svg>
  );
}

/* ── Plan definitions ───────────────────────────── */
const CORE_FEATURES: FeatureSection[] = [
  {
    section: 'Dashboard',
    items: [{ label: 'Dashboard', included: true }],
  },
  {
    section: 'Operations',
    items: [
      { label: 'Clients', included: true },
      { label: 'Caregivers', included: true },
      { label: 'Schedule', included: true },
      { label: 'Visits (EVV)', included: false },
    ],
  },
  {
    section: 'Clinical',
    items: [
      { label: 'Care Plans', included: true },
      { label: 'Documentation', included: true },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Timesheet', included: true },
      { label: 'Billing', included: true },
      { label: 'Claims', included: true },
    ],
  },
  {
    section: 'Reports',
    items: [{ label: 'Reports', included: true }],
  },
];

const CORE_SETTINGS: SettingItem[] = [
  { label: 'General' },
  { label: 'Notification' },
  { label: 'Billing' },
  { label: 'Security' },
  { label: 'Payroll' },
];

const EVV_FEATURES: FeatureSection[] = [
  {
    section: 'Dashboard',
    items: [{ label: 'Dashboard', included: true }],
  },
  {
    section: 'Operations',
    items: [
      { label: 'Clients', included: true },
      { label: 'Caregivers', included: true },
      { label: 'Schedule', included: true },
      { label: 'Visits (EVV)', included: true },
    ],
  },
  {
    section: 'Clinical',
    items: [
      { label: 'Care Plans', included: true },
      { label: 'Documentation', included: true },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Timesheet', included: true },
      { label: 'Billing', included: true },
      { label: 'Claims', included: true },
    ],
  },
  {
    section: 'Reports',
    items: [{ label: 'Reports', included: true }],
  },
];

/* ── Plan Card ──────────────────────────────────── */
function PlanCard({
  tier,
  title,
  description,
  badge,
  badgeClass,
  features,
  settingsItems,
  comingSoon,
  children,
}: {
  tier: string;
  title: string;
  description: string;
  badge: string;
  badgeClass: string;
  features?: FeatureSection[];
  settingsItems?: SettingItem[];
  comingSoon?: boolean;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`plan-card${comingSoon ? ' plan-card-muted' : ''}`}>
      <div className="plan-card-header">
        <div className="plan-tier-row">
          <span className={`plan-tier-badge ${badgeClass}`}>{tier}</span>
        </div>
        <h2 className="plan-title">{title}</h2>
        <p className="plan-description">{description}</p>
        <div className="plan-status-badge">
          <span className={`plan-badge ${badgeClass}`}>{badge}</span>
        </div>
      </div>

      {comingSoon ? (
        <div className="plan-coming-soon">
          <div className="plan-coming-soon-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div className="plan-coming-soon-text">Coming Soon</div>
          <p className="plan-coming-soon-sub">
            For agencies using both Sandata AND HHAeXchange, or needing advanced integrations.
            This tier will be available in a future release.
          </p>
        </div>
      ) : (
        <div className="plan-features">
          <div className="plan-section-toggle" onClick={() => setExpanded((v) => !v)}>
            <span>Modules & Features</span>
            <svg
              className={`plan-chevron${expanded ? ' plan-chevron-open' : ''}`}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>

          {expanded && (
            <div className="plan-features-body">
              {features?.map((section) => (
                <div key={section.section} className="plan-feat-section">
                  <div className="plan-feat-section-title">{section.section}</div>
                  {section.items.map((item) => (
                    <div key={item.label} className="plan-feat-item">
                      <CheckIcon included={item.included} />
                      <span className={item.included ? '' : 'plan-feat-excluded'}>{item.label}</span>
                    </div>
                  ))}
                </div>
              ))}

              {settingsItems && settingsItems.length > 0 && (
                <div className="plan-feat-section">
                  <div className="plan-feat-section-title">System — Settings</div>
                  {settingsItems.map((s) => (
                    <div key={s.label} className="plan-feat-item plan-feat-item-setting">
                      <svg className="plan-feat-icon plan-feat-icon-setting" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="8" cy="8" r="2.5" />
                        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
                      </svg>
                      <span>{s.label}</span>
                      {s.config && <div className="plan-feat-config">{s.config}</div>}
                    </div>
                  ))}
                </div>
              )}

              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── EVV Aggregator Config ──────────────────────── */
function EvvPlanCard() {
  const [aggregator, setAggregator] = useState<AggregatorOption>('sandata');

  const evvSettings: SettingItem[] = [
    { label: 'General' },
    { label: 'Notification' },
    { label: 'Billing' },
    { label: 'Security' },
    { label: 'Payroll' },
    {
      label: 'Aggregator',
      config: (
        <select
          className="plan-aggregator-select"
          value={aggregator}
          onChange={(e) => setAggregator(e.target.value as AggregatorOption)}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="sandata">Sandata</option>
          <option value="hhax">HHAeXchange</option>
        </select>
      ),
    },
  ];

  return (
    <PlanCard
      tier="Tier 2"
      title="EVV"
      description="For agencies using Sandata or HHAeXchange."
      badge="EVV Enabled"
      badgeClass="plan-badge-evv"
      features={EVV_FEATURES}
      settingsItems={evvSettings}
    />
  );
}

/* ── Page ───────────────────────────────────────── */
export default function PlansPage() {
  const { user } = useAuth();

  if (user?.role !== 'super_admin') {
    return (
      <ProtectedLayout>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          Access denied.
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">Plans</h1>
          <p className="page-subtitle">Configure platform tiers and available modules per plan</p>
        </div>
        <div className="top-actions">
          <HeaderUser />
        </div>
      </div>

      <div className="plan-grid">
        {/* Tier 1 — Core */}
        <PlanCard
          tier="Tier 1"
          title="Core"
          description="For agencies that don't use EVV."
          badge="Base Plan"
          badgeClass="plan-badge-core"
          features={CORE_FEATURES}
          settingsItems={CORE_SETTINGS}
        />

        {/* Tier 2 — EVV */}
        <EvvPlanCard />

        {/* Tier 3 — EVV+ */}
        <PlanCard
          tier="Tier 3"
          title="EVV+"
          description="For agencies using both Sandata AND HHAeXchange, or needing advanced integrations."
          badge="Advanced"
          badgeClass="plan-badge-evvplus"
          comingSoon
        />
      </div>
    </ProtectedLayout>
  );
}
