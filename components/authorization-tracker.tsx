'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { DashboardAuthorization } from '@/lib/queries/dashboard';
import styles from '@/app/dashboard.module.css';

const fmt = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function AuthorizationTracker({ items, error }: { items: DashboardAuthorization[]; error?: string | null }) {
  const [requestedPage, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(3);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!card.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      // Short dashboard panels use fewer rows instead of clipping or scrolling.
      const height = entry.contentRect.height;
      setPageSize(height >= 190 ? 3 : height >= 150 ? 2 : 1);
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return <section ref={card} className={`card ${styles.trackerCard}`} aria-label="Authorization Tracker">
    <div className={styles.trackerHeader}>
      <div><div className="card-title">Authorization Tracker</div>
        <div className="card-subtitle">Completed service units used and remaining</div></div>
      <span className={styles.trackerCount}>{items.length} authorizations</span>
    </div>
    {error ? <p role="alert">{error}</p> : !items.length ? <div className="coming-soon-wrap">No active authorizations for this agency.</div>
      : <>
        <table className={styles.trackerTable}>
          <thead><tr><th>Client / Service</th><th>Used</th><th>Remaining</th><th>Expires</th></tr></thead>
          <tbody>{items.slice(start, start + pageSize).map(auth => {
            const remaining = auth.authorized_units - auth.used_units;
            const days = auth.days_until_expiry;
            const expiry = days == null ? 'Not set' : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `In ${days}d`;
            const warning = remaining <= auth.authorized_units * .1 || (days != null && days <= 30);
            return <tr key={auth.auth_id}>
              <td><Link href={`/clients/${auth.client_id}`} title={auth.client_name}>{auth.client_name}</Link>
                <div className={styles.trackerService} title={auth.auth_number || undefined}>{auth.service_code || 'Service'}{auth.auth_number ? ` · ${auth.auth_number}` : ''}</div>
                <progress className={styles.authorizationProgress} max={Math.max(auth.authorized_units, 1)} value={Math.max(0, Math.min(auth.used_units, auth.authorized_units))}
                  data-warning={warning} aria-label={`${auth.client_name}: ${fmt(auth.used_units)} of ${fmt(auth.authorized_units)} units used`} />
                {!!auth.unassigned_visits && <span className={styles.trackerWarning} title="Overlapping authorizations: select an authorization for these visits in Billing.">{auth.unassigned_visits} visit{auth.unassigned_visits === 1 ? ' needs' : 's need'} assignment</span>}
              </td>
              <td>{fmt(auth.used_units)} <span className={styles.trackerTotal}>/ {fmt(auth.authorized_units)}</span></td>
              <td data-warning={remaining < 0}><strong>{fmt(remaining)}</strong></td>
              <td><span className={styles.trackerExpiry} data-warning={days != null && days <= 30}>{expiry}</span></td>
            </tr>;
          })}</tbody>
        </table>
        <nav className={styles.trackerPagination} aria-label="Authorization pages">
          <span>{start + 1}–{Math.min(start + pageSize, items.length)} of {items.length}</span>
          <div><button type="button" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous authorizations">Previous</button>
            <span>{page} / {totalPages}</span>
            <button type="button" onClick={() => setPage(page + 1)} disabled={page === totalPages} aria-label="Next authorizations">Next</button></div>
        </nav>
      </>}
  </section>;
}
