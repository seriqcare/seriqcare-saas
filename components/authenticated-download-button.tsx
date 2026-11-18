'use client';
import { useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { authenticatedDownload } from '@/lib/authenticated-download';

export function AuthenticatedDownloadButton({ endpoint, filename }: { endpoint: string; filename: string }) {
  const { apiFetch } = useAuth();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await authenticatedDownload(endpoint, filename, apiFetch); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to download CSV.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div><button type="button" className="btn secondary" disabled={busy} onClick={download}>{busy ? 'Downloading…' : 'Export CSV'}</button>
    {error && <div role="alert" className="error-text">{error}</div>}</div>;
}
