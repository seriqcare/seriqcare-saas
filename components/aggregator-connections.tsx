'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import styles from './aggregator-connections.module.css';

type Connection = { name: string; mode: 'live' | 'simulate'; endpoint: string | null; credentials_configured: boolean | null };

export function AggregatorConnections() {
  const { user, apiFetch } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    let active = true;
    setLoading(true); setError('');
    apiFetch('/api/super-admin/connections', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Unable to load connection details.');
      const data: Connection[] = await response.json();
      if (active) setConnections(data);
    }).catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiFetch, user?.role, revision]);
  if (user?.role !== 'super_admin') return null;
  if (error) return <div className="card" role="alert" style={{ marginBottom: 14 }}>{error} <button className="btn secondary sm" onClick={() => setRevision(value => value + 1)}>Retry</button></div>;
  if (loading) return <div className="card" style={{ marginBottom: 14 }}>Loading connections...</div>;
  return <section className={styles.grid} aria-label="Aggregator connections">
    {connections.map(connection => <article className="card" key={connection.name}>
      <div className="card-header"><div className="card-title">{connection.name}</div>
        <span className={`sa-badge ${connection.mode === 'live' ? 'sa-badge-active' : ''}`}>{connection.mode === 'live' ? 'Live mode' : 'Simulation'}</span>
      </div>
      <dl className={styles.details}>
        <div><dt>Endpoint</dt><dd>{connection.endpoint || (connection.mode === 'simulate' ? 'Built-in simulator' : 'Not configured')}</dd></div>
        <div><dt>Credentials</dt><dd>{connection.credentials_configured == null ? 'Not required in simulation' : connection.credentials_configured ? 'Configured' : 'Not configured'}</dd></div>
      </dl>
      <p className={styles.note}>Server configuration · Connection health not checked</p>
    </article>)}
  </section>;
}
