'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ActiveVisit {
  visit_id: number;
  schedule_id: number;
  client_name: string;
  clocked_in: string;
}

type VisitState = { owner: string; visit: ActiveVisit | null; status: 'checking' | 'ready' | 'error' };

export function useActiveVisit(owner: string | null, apiFetch: (url: string) => Promise<Response>) {
  const [state, setState] = useState<VisitState | null>(null);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const revision = useRef(0);

  const refreshActiveVisit = useCallback(async () => {
    if (!owner) return;
    const request = ++revision.current;
    setState(previous => ({ owner, visit: previous?.owner === owner ? previous.visit : null, status: 'checking' }));
    try {
      const response = await apiFetch('/api/visits/active');
      if (!response.ok) throw new Error('Could not verify the active visit.');
      const visit: ActiveVisit | null = await response.json();
      if (currentOwner.current === owner && revision.current === request) setState({ owner, visit, status: 'ready' });
    } catch {
      if (currentOwner.current === owner && revision.current === request) setState({ owner, visit: null, status: 'error' });
    }
  }, [owner, apiFetch]);

  // Use only after a successful clock-in/out response, never from cached browser state.
  const setConfirmedActiveVisit = useCallback((visit: ActiveVisit | null) => {
    if (!owner || currentOwner.current !== owner) return;
    revision.current++;
    setState({ owner, visit, status: 'ready' });
  }, [owner]);

  useEffect(() => {
    // Retire the old shared cache; it could belong to a different signed-in user.
    try { sessionStorage.removeItem('seriqcare_active_visit'); } catch { /* Storage is optional. */ }
    if (!owner) { setState(null); return; }
    void refreshActiveVisit();
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshActiveVisit(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [owner, refreshActiveVisit]);

  return {
    activeVisit: state?.owner === owner ? state?.visit ?? null : null,
    activeVisitStatus: state?.owner === owner ? state.status : 'checking',
    refreshActiveVisit, setConfirmedActiveVisit,
  };
}
