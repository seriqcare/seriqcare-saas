'use client';

import { useCallback, useEffect, useState } from 'react';
import { ProtectedLayout } from '@/components/protected-layout';
import { HeaderUser } from '@/components/topbar';
import { useAuth } from '@/components/auth-context';

/* ── Types ──────────────────────────────────────── */
type Tab = 'overview' | 'agencies' | 'users' | 'audit' | 'api-log';

interface Overview {
  total_agencies: number;
  active_agencies: number;
  total_users: number;
  visits_today: number;
  logins_today: number;
  failed_logins_today: number;
  clock_ins_today: number;
  recent_events: Record<string, unknown>[];
}

interface Agency {
  id: number;
  agency_code: string;
  name: string;
  tier: string;
  aggregator: string | null;
  state_provider_id: string | null;
  sandata_provider_id: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  is_active: boolean;
  created_at: string;
  user_count: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  agency_id: number | null;
  agency_name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

interface AuditRow {
  id: number;
  created_at: string;
  action: string;
  table_name: string | null;
  record_id: number | null;
  changed_by: number | null;
  changed_by_name: string | null;
  agency_id: number | null;
  client_type: string | null;
  ip_address: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  detail: string | null;
}

interface ApiLogRow {
  id: number;
  created_at: string;
  method: string;
  path: string;
  query_string: string | null;
  status_code: number;
  duration_ms: number | null;
  user_id: number | null;
  username: string | null;
  agency_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
}

/* ── Helpers ────────────────────────────────────── */
function fmtDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function tierLabel(t: string) {
  const map: Record<string, string> = { core: 'Core', evv: 'EVV', evvplus: 'EVV+' };
  return map[t] ?? t;
}
function statusBadge(active: boolean) {
  return <span className={`sa-badge ${active ? 'sa-badge-active' : 'sa-badge-inactive'}`}>{active ? 'Active' : 'Inactive'}</span>;
}
function httpMethodBadge(method: string) {
  const cls = method === 'GET' ? 'sa-method-get' : method === 'POST' ? 'sa-method-post' : method === 'DELETE' ? 'sa-method-delete' : 'sa-method-other';
  return <span className={`sa-method ${cls}`}>{method}</span>;
}
function statusCodeBadge(code: number) {
  const cls = code < 300 ? 'sa-status-ok' : code < 400 ? 'sa-status-redir' : code < 500 ? 'sa-status-client' : 'sa-status-server';
  return <span className={`sa-status-code ${cls}`}>{code}</span>;
}

/* ── Component ──────────────────────────────────── */
export default function SuperAdminPage() {
  const { user, apiFetch } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);

  // Overview
  const [overview, setOverview] = useState<Overview | null>(null);

  // Agencies
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [showCreateAgency, setShowCreateAgency] = useState(false);
  const [editingAgency, setEditingAgency] = useState<Agency | null>(null);

  // Users
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userFilterAgency, setUserFilterAgency] = useState<string>('');
  const [userFilterRole, setUserFilterRole] = useState<string>('');

  // Audit
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditAction, setAuditAction] = useState('');
  const [auditPage, setAuditPage] = useState(0);

  // API Log
  const [apiLogRows, setApiLogRows] = useState<ApiLogRow[]>([]);
  const [apiLogTotal, setApiLogTotal] = useState(0);
  const [apiLogPage, setApiLogPage] = useState(0);

  const PAGE_SIZE = 50;

  /* ── Fetchers ───────────────────────────────────── */
  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/overview');
      if (res.ok) setOverview(await res.json());
    } finally { setLoading(false); }
  }, [apiFetch]);

  const fetchAgencies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/agencies');
      if (res.ok) setAgencies(await res.json());
    } finally { setLoading(false); }
  }, [apiFetch]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userFilterAgency) params.set('agency_id', userFilterAgency);
      if (userFilterRole) params.set('role', userFilterRole);
      const res = await apiFetch(`/api/super-admin/users?${params}`);
      if (res.ok) setUsers(await res.json());
    } finally { setLoading(false); }
  }, [apiFetch, userFilterAgency, userFilterRole]);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(auditPage * PAGE_SIZE) });
      if (auditAction) params.set('action', auditAction);
      const res = await apiFetch(`/api/super-admin/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAuditRows(data.rows);
        setAuditTotal(data.total);
      }
    } finally { setLoading(false); }
  }, [apiFetch, auditAction, auditPage]);

  const fetchApiLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(apiLogPage * PAGE_SIZE) });
      const res = await apiFetch(`/api/super-admin/api-access-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setApiLogRows(data.rows);
        setApiLogTotal(data.total);
      }
    } finally { setLoading(false); }
  }, [apiFetch, apiLogPage]);

  useEffect(() => {
    if (tab === 'overview') fetchOverview();
    if (tab === 'agencies') fetchAgencies();
    if (tab === 'users') fetchUsers();
    if (tab === 'audit') fetchAudit();
    if (tab === 'api-log') fetchApiLog();
  }, [tab, fetchOverview, fetchAgencies, fetchUsers, fetchAudit, fetchApiLog]);

  /* ── Guard ──────────────────────────────────────── */
  if (user?.role !== 'super_admin') {
    return (
      <ProtectedLayout>
        <div className="topbar"><div><h1 className="page-title">Access Denied</h1></div></div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p>This page is restricted to super administrators.</p>
        </div>
      </ProtectedLayout>
    );
  }

  /* ── Tab renderers ──────────────────────────────── */
  const renderOverview = () => {
    if (!overview) return <div className="sa-loading">Loading...</div>;
    return (
      <>
        <section className="summary-row" style={{ marginBottom: 14 }}>
          <div className="summary-card">
            <div className="summary-label">Total Agencies</div>
            <div className="summary-sub-label">Active</div>
            <div className="summary-value">{overview.total_agencies}</div>
            <div className="summary-sub-value">{overview.active_agencies}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total Users</div>
            <div className="summary-sub-label">Logins Today</div>
            <div className="summary-value">{overview.total_users}</div>
            <div className="summary-sub-value">{overview.logins_today}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Visits Today</div>
            <div className="summary-sub-label">Clock-ins</div>
            <div className="summary-value">{overview.visits_today}</div>
            <div className="summary-sub-value">{overview.clock_ins_today}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Failed Logins</div>
            <div className="summary-sub-label">Today</div>
            <div className="summary-value" style={{ color: overview.failed_logins_today > 0 ? '#d56b6b' : undefined }}>
              {overview.failed_logins_today}
            </div>
            <div className="summary-sub-value">—</div>
          </div>
        </section>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Recent Activity</div>
              <div className="card-subtitle">Last 20 events from the audit log</div>
            </div>
          </div>
          {overview.recent_events.length === 0 ? (
            <div className="sa-empty">No audit events recorded yet.</div>
          ) : (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Table</th>
                    <th>IP</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recent_events.map((e: Record<string, unknown>, i: number) => (
                    <tr key={i}>
                      <td className="sa-nowrap">{fmtDateTime(e.created_at as string)}</td>
                      <td><span className="sa-action-pill">{e.action as string}</span></td>
                      <td>{(e.changed_by_name as string) || '—'}</td>
                      <td>{(e.table_name as string) || '—'}</td>
                      <td className="sa-mono">{(e.ip_address as string) || '—'}</td>
                      <td className="sa-detail">{(e.detail as string) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  };

  const renderAgencies = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn primary" onClick={() => setShowCreateAgency(true)}>+ New Agency</button>
      </div>
      {showCreateAgency && (
        <CreateAgencyForm
          apiFetch={apiFetch}
          onClose={() => setShowCreateAgency(false)}
          onCreated={() => { setShowCreateAgency(false); fetchAgencies(); }}
        />
      )}
      {editingAgency && (
        <EditAgencyForm
          agency={editingAgency}
          apiFetch={apiFetch}
          onClose={() => setEditingAgency(null)}
          onSaved={() => { setEditingAgency(null); fetchAgencies(); }}
        />
      )}
      <div className="card">
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Tier</th>
                <th>State</th>
                <th>Contact</th>
                <th>Users</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agencies.map((a) => (
                <tr key={a.id}>
                  <td className="sa-mono">{a.agency_code}</td>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{tierLabel(a.tier)}</td>
                  <td>{a.state}</td>
                  <td>
                    <div>{a.primary_contact_name || '—'}</div>
                    {a.primary_contact_email && <div className="sa-sub">{a.primary_contact_email}</div>}
                  </td>
                  <td>{a.user_count}</td>
                  <td>{statusBadge(a.is_active)}</td>
                  <td className="sa-nowrap">{fmtDate(a.created_at)}</td>
                  <td>
                    <button className="btn secondary sa-btn-sm" onClick={() => setEditingAgency(a)}>Edit</button>
                  </td>
                </tr>
              ))}
              {agencies.length === 0 && (
                <tr><td colSpan={9} className="sa-empty">No agencies found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderUsers = () => (
    <>
      <div className="sa-filters">
        <select value={userFilterAgency} onChange={(e) => { setUserFilterAgency(e.target.value); }}>
          <option value="">All Agencies</option>
          {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={userFilterRole} onChange={(e) => { setUserFilterRole(e.target.value); }}>
          <option value="">All Roles</option>
          <option value="agency_admin">Agency Admin</option>
          <option value="coordinator">Coordinator</option>
          <option value="caregiver">Caregiver</option>
        </select>
      </div>
      <div className="card">
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Display Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Agency</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="sa-mono">{u.username}</td>
                  <td>{u.display_name || '—'}</td>
                  <td>{u.email || '—'}</td>
                  <td><span className="sa-role-pill">{u.role.replace('_', ' ')}</span></td>
                  <td>{u.agency_name || '—'}</td>
                  <td>{statusBadge(u.is_active)}</td>
                  <td className="sa-nowrap">{fmtDateTime(u.last_login_at)}</td>
                  <td className="sa-nowrap">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={8} className="sa-empty">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderAudit = () => {
    const totalPages = Math.ceil(auditTotal / PAGE_SIZE);
    return (
      <>
        <div className="sa-filters">
          <select value={auditAction} onChange={(e) => { setAuditAction(e.target.value); setAuditPage(0); }}>
            <option value="">All Actions</option>
            <option value="LOGIN">LOGIN</option>
            <option value="FAILED_LOGIN">FAILED_LOGIN</option>
            <option value="CLOCK_IN">CLOCK_IN</option>
            <option value="CLOCK_OUT">CLOCK_OUT</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
          <span className="sa-page-info">{auditTotal} total{totalPages > 1 && ` · Page ${auditPage + 1} of ${totalPages}`}</span>
          {totalPages > 1 && (
            <div className="sa-pager">
              <button className="btn secondary sa-btn-sm" disabled={auditPage === 0} onClick={() => setAuditPage(auditPage - 1)}>Prev</button>
              <button className="btn secondary sa-btn-sm" disabled={auditPage >= totalPages - 1} onClick={() => setAuditPage(auditPage + 1)}>Next</button>
            </div>
          )}
        </div>
        <div className="card">
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>User</th>
                  <th>Table</th>
                  <th>Record</th>
                  <th>Field</th>
                  <th>Old</th>
                  <th>New</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((r) => (
                  <tr key={r.id}>
                    <td className="sa-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td><span className="sa-action-pill">{r.action}</span></td>
                    <td>{r.changed_by_name || '—'}</td>
                    <td>{r.table_name || '—'}</td>
                    <td className="sa-mono">{r.record_id ?? '—'}</td>
                    <td>{r.field_name || '—'}</td>
                    <td className="sa-detail">{r.old_value || '—'}</td>
                    <td className="sa-detail">{r.new_value || '—'}</td>
                    <td className="sa-mono">{r.ip_address || '—'}</td>
                  </tr>
                ))}
                {auditRows.length === 0 && (
                  <tr><td colSpan={9} className="sa-empty">No audit records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  const renderApiLog = () => {
    const totalPages = Math.ceil(apiLogTotal / PAGE_SIZE);
    return (
      <>
        <div className="sa-filters">
          <span className="sa-page-info">{apiLogTotal} total{totalPages > 1 && ` · Page ${apiLogPage + 1} of ${totalPages}`}</span>
          {totalPages > 1 && (
            <div className="sa-pager">
              <button className="btn secondary sa-btn-sm" disabled={apiLogPage === 0} onClick={() => setApiLogPage(apiLogPage - 1)}>Prev</button>
              <button className="btn secondary sa-btn-sm" disabled={apiLogPage >= totalPages - 1} onClick={() => setApiLogPage(apiLogPage + 1)}>Next</button>
            </div>
          )}
        </div>
        <div className="card">
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>User</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {apiLogRows.map((r) => (
                  <tr key={r.id}>
                    <td className="sa-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>{httpMethodBadge(r.method)}</td>
                    <td className="sa-mono sa-path">{r.path}{r.query_string ? `?${r.query_string}` : ''}</td>
                    <td>{statusCodeBadge(r.status_code)}</td>
                    <td className="sa-mono">{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
                    <td>{r.username || '—'}</td>
                    <td className="sa-mono">{r.ip_address || '—'}</td>
                  </tr>
                ))}
                {apiLogRows.length === 0 && (
                  <tr><td colSpan={7} className="sa-empty">No API log entries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'agencies', label: 'Agencies' },
    { key: 'users', label: 'Users' },
    { key: 'audit', label: 'Audit Log' },
    { key: 'api-log', label: 'API Log' },
  ];

  return (
    <ProtectedLayout>
      <div className="topbar">
        <div>
          <h1 className="page-title">Super Admin</h1>
          <p className="page-subtitle">Platform management · All agencies · Audit trail</p>
        </div>
        <div className="top-actions">
          <HeaderUser />
        </div>
      </div>

      <div className="sa-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`sa-tab${tab === t.key ? ' sa-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        {loading && <span className="sa-spinner" />}
      </div>

      <div className="sa-content">
        {tab === 'overview' && renderOverview()}
        {tab === 'agencies' && renderAgencies()}
        {tab === 'users' && renderUsers()}
        {tab === 'audit' && renderAudit()}
        {tab === 'api-log' && renderApiLog()}
      </div>
    </ProtectedLayout>
  );
}

/* ── Create Agency Form ─────────────────────────── */
function CreateAgencyForm({ apiFetch, onClose, onCreated }: {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    agency_code: '', name: '', tier: 'core', aggregator: 'sandata', state: 'PA',
    state_provider_id: '', sandata_provider_id: '',
    address1: '', city: '', zip: '', phone: '',
    primary_contact_name: '', primary_contact_email: '', admin_username: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<{ username: string; email: string; email_sent: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.agency_code.trim() || !form.name.trim()) {
      setError('Agency code and name are required.');
      return;
    }
    if (!form.primary_contact_name.trim() || !form.primary_contact_email.trim()) {
      setError('Contact name and email are required for the admin account.');
      return;
    }
    if (!form.admin_username.trim()) {
      setError('Admin username is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          state_provider_id: form.state_provider_id || null,
          sandata_provider_id: form.sandata_provider_id || null,
          address1: form.address1 || null,
          city: form.city || null,
          zip: form.zip || null,
          phone: form.phone || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || 'Failed to create agency.');
        return;
      }
      const data = await res.json();
      setSuccess({
        username: data.admin_user.username,
        email: data.admin_user.email,
        email_sent: data.email_sent,
      });
    } finally { setSaving(false); }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  if (success) {
    return (
      <div className="sa-modal-backdrop">
        <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
          <div className="sa-modal-header">
            <h3>Agency Created</h3>
          </div>
          <div style={{ padding: '8px 0 16px' }}>
            <div className="sa-success">Agency and admin account created successfully.</div>
            <div className="sa-creds-box">
              <div className="sa-creds-title">Admin Login Details</div>
              <div className="sa-creds-row"><span>Username:</span> <span className="sa-mono">{success.username}</span></div>
              <div className="sa-creds-row"><span>Email:</span> <span className="sa-mono">{success.email}</span></div>
            </div>
            {success.email_sent ? (
              <p style={{ fontSize: 13, color: 'var(--success-text)', margin: '12px 0 0' }}>
                An onboarding email has been sent to <strong>{success.email}</strong> with a link to set their password.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--danger-text)', margin: '12px 0 0' }}>
                Failed to send onboarding email. The admin can use the &quot;Forgot Password&quot; flow on the login page to set their password.
              </p>
            )}
          </div>
          <div className="sa-modal-actions">
            <button className="btn primary" onClick={onCreated}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h3>Create Agency</h3>
          <button className="sa-modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="sa-error">{error}</div>}
          <div className="sa-form-section">Agency Details</div>
          <div className="sa-form-grid">
            <label>Agency Code *<input value={form.agency_code} onChange={set('agency_code')} placeholder="e.g. ACME" /></label>
            <label>Name *<input value={form.name} onChange={set('name')} placeholder="Agency name" /></label>
            <label>Tier
              <select value={form.tier} onChange={set('tier')}>
                <option value="core">Core</option>
                <option value="evv">EVV</option>
                <option value="evvplus">EVV+</option>
              </select>
            </label>
            {(form.tier === 'evv' || form.tier === 'evvplus') && (
              <label>Aggregator
                <select value={form.aggregator} onChange={set('aggregator')}>
                  <option value="sandata">Sandata</option>
                  <option value="hhax">HHAeXchange</option>
                </select>
              </label>
            )}
            <label>State<input value={form.state} onChange={set('state')} placeholder="PA" /></label>
            <label>State Provider ID<input value={form.state_provider_id} onChange={set('state_provider_id')} /></label>
            <label>Sandata Provider ID<input value={form.sandata_provider_id} onChange={set('sandata_provider_id')} /></label>
            <label>Address<input value={form.address1} onChange={set('address1')} /></label>
            <label>City<input value={form.city} onChange={set('city')} /></label>
            <label>ZIP<input value={form.zip} onChange={set('zip')} /></label>
            <label>Phone<input value={form.phone} onChange={set('phone')} /></label>
          </div>
          <div className="sa-form-section">Admin Account</div>
          <div className="sa-form-grid">
            <label>Contact Name *<input value={form.primary_contact_name} onChange={set('primary_contact_name')} placeholder="Full name" /></label>
            <label>Contact Email *<input value={form.primary_contact_email} onChange={set('primary_contact_email')} type="email" placeholder="admin@agency.com" /></label>
            <label>Admin Username *<input value={form.admin_username} onChange={set('admin_username')} placeholder="e.g. jsmith" /></label>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '8px 0 0' }}>
            An onboarding email will be sent to the contact email with a link to set their password.
          </p>
          <div className="sa-modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Creating...' : 'Create Agency'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Edit Agency Form ───────────────────────────── */
function EditAgencyForm({ agency, apiFetch, onClose, onSaved }: {
  agency: Agency;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: agency.name,
    tier: agency.tier,
    aggregator: agency.aggregator || 'sandata',
    is_active: agency.is_active,
    state_provider_id: agency.state_provider_id || '',
    sandata_provider_id: agency.sandata_provider_id || '',
    phone: agency.phone || '',
    primary_contact_name: agency.primary_contact_name || '',
    primary_contact_email: agency.primary_contact_email || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/api/super-admin/agencies/${agency.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          tier: form.tier,
          aggregator: (form.tier === 'core') ? null : form.aggregator,
          is_active: form.is_active,
          state_provider_id: form.state_provider_id || null,
          sandata_provider_id: form.sandata_provider_id || null,
          phone: form.phone || null,
          primary_contact_name: form.primary_contact_name || null,
          primary_contact_email: form.primary_contact_email || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || 'Failed to update agency.');
        return;
      }
      onSaved();
    } finally { setSaving(false); }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h3>Edit Agency — {agency.agency_code}</h3>
          <button className="sa-modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="sa-error">{error}</div>}
          <div className="sa-form-grid">
            <label>Name<input value={form.name} onChange={set('name')} /></label>
            <label>Tier
              <select value={form.tier} onChange={set('tier')}>
                <option value="core">Core</option>
                <option value="evv">EVV</option>
                <option value="evvplus">EVV+</option>
              </select>
            </label>
            {(form.tier === 'evv' || form.tier === 'evvplus') && (
              <label>Aggregator
                <select value={form.aggregator} onChange={set('aggregator')}>
                  <option value="sandata">Sandata</option>
                  <option value="hhax">HHAeXchange</option>
                </select>
              </label>
            )}
            <label>Status
              <select value={String(form.is_active)} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <label>State Provider ID<input value={form.state_provider_id} onChange={set('state_provider_id')} /></label>
            <label>Sandata Provider ID<input value={form.sandata_provider_id} onChange={set('sandata_provider_id')} /></label>
            <label>Phone<input value={form.phone} onChange={set('phone')} /></label>
            <label>Contact Name<input value={form.primary_contact_name} onChange={set('primary_contact_name')} /></label>
            <label>Contact Email<input value={form.primary_contact_email} onChange={set('primary_contact_email')} type="email" /></label>
          </div>
          <div className="sa-modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
