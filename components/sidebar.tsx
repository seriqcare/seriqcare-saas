'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-context';

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

interface NavGroup {
  section: string | null;
  links: NavLink[];
}

/* ── Inline SVG icons ─────────────────────────────────────── */
const Icons = {
  dashboard: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  ),
  clients: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  ),
  caregivers: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1 13c0-2.8 2.2-5 5-5" />
      <circle cx="12" cy="5" r="2" />
      <path d="M10 13c0-2.2 1.8-4 4-4" strokeDasharray="2 1" />
      <path d="M8.5 9.5l2 2-1 1.5" />
    </svg>
  ),
  schedule: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="11" rx="1.5" />
      <path d="M5 1v4M11 1v4M1 7h14" />
    </svg>
  ),
  visits: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1l1.8 3.6L14 5.3l-3 2.9.7 4.1L8 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7z" />
    </svg>
  ),
  carePlans: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h4" />
    </svg>
  ),
  documentation: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7L9 1z" />
      <path d="M9 1v6h5" />
      <path d="M5 10h6M5 12.5h4" />
    </svg>
  ),
  evv: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8l2.5 2.5L11 5.5" />
    </svg>
  ),
  timesheets: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 2" />
    </svg>
  ),
  billing: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="10" rx="1.5" />
      <path d="M1 7h14" />
      <path d="M5 11h2M10 11h1" />
    </svg>
  ),
  claims: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 13V5l4-4h8v12H2z" />
      <path d="M6 1v4H2" />
      <path d="M5 9h6M5 11.5h4" />
    </svg>
  ),
  reports: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 14V1" />
      <path d="M1 14h15" />
      <path d="M4 10V7M7 10V5M10 10V8M13 10V3" />
    </svg>
  ),
  admin: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  ),
  superAdmin: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1l1.5 3 3.5.5-2.5 2.5.5 3.5L8 9l-3 1.5.5-3.5L3 4.5l3.5-.5z" />
      <path d="M4 12.5C4 11 5.8 10 8 10s4 1 4 2.5" />
    </svg>
  ),
  plans: (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="2" width="4" height="12" rx="1" />
      <rect x="6" y="5" width="4" height="9" rx="1" />
      <rect x="11" y="8" width="4" height="6" rx="1" />
    </svg>
  ),
};

function buildAgencyNav(tier: string | null | undefined): NavGroup[] {
  const hasEVV = tier === 'evv' || tier === 'evvplus';
  return [
    {
      section: null,
      links: [{ href: '/', label: 'Dashboard', icon: Icons.dashboard }],
    },
    {
      section: 'Operations',
      links: [
        { href: '/clients',    label: 'Clients',    icon: Icons.clients },
        { href: '/caregivers', label: 'Caregivers', icon: Icons.caregivers },
        { href: '/schedule',   label: 'Schedule',   icon: Icons.schedule },
        ...(hasEVV ? [{ href: '/visits', label: 'Visits', icon: Icons.visits }] : []),
      ],
    },
    {
      section: 'Clinical',
      links: [
        { href: '/care-plans',    label: 'Care Plans',    icon: Icons.carePlans },
        { href: '/documentation', label: 'Documentation', icon: Icons.documentation },
      ],
    },
    {
      section: 'Finance',
      links: [
        { href: '/timesheets', label: 'Timesheets', icon: Icons.timesheets },
        { href: '/billing',    label: 'Billing',    icon: Icons.billing },
        { href: '/claims',     label: 'Claims',     icon: Icons.claims },
      ],
    },
    {
      section: 'Reports',
      links: [{ href: '/reports', label: 'Reports', icon: Icons.reports }],
    },
    {
      section: 'System',
      links: [{ href: '/settings', label: 'Settings', icon: Icons.admin }],
    },
  ];
}

const SUPER_ADMIN_NAV: NavGroup[] = [
  {
    section: 'Platform',
    links: [
      { href: '/super-admin', label: 'Super Admin', icon: Icons.superAdmin, exact: true },
      { href: '/super-admin/plans', label: 'Plans', icon: Icons.plans },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const nav = user?.role === 'super_admin' ? SUPER_ADMIN_NAV : buildAgencyNav(user?.agency_tier);

  return (
    <aside className="sidebar">
      <div className="brand" style={{ display: 'flex', alignItems: 'center' }}>
        <Image src="/logo.png" alt="SeriqCare logo" width={28} height={28} style={{ borderRadius: 4, flexShrink: 0, marginRight: 8 }} />Seriq<span>Care</span>
      </div>
      <nav>
        {nav.map((group) => (
          <div key={group.section ?? 'top'}>
            {group.section && (
              <div className="nav-section-title">{group.section}</div>
            )}
            {group.links.map((link) => {
              const isActive = pathname === link.href || (!link.exact && pathname.startsWith(link.href + '/'));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`nav-link${isActive ? ' active' : ''}`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {user && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--line)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            {user.display_name || user.username}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {user.email || user.username}
          </div>
          <button className="btn secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
