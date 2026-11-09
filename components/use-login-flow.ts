'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, type SignInResult } from '@/components/auth-context';
import { waitForReadiness } from '@/lib/readiness';

export function useLoginFlow() {
  const { apiBases, signIn } = useAuth();
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'signing-in'>('idle');
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => {
    active.current?.abort();
  }, []);

  const submit = useCallback(async (username: string, password: string, cfToken?: string): Promise<SignInResult | null> => {
    if (active.current) return null;
    const controller = new AbortController();
    active.current = controller;
    setPhase('connecting');
    try {
      const base = await waitForReadiness(apiBases, controller.signal);
      if (controller.signal.aborted) return null;
      setPhase('signing-in');
      const result = await signIn(username, password, base, cfToken);
      return controller.signal.aborted ? null : result;
    } catch (error) {
      if (controller.signal.aborted) return null;
      return { ok: false, error: error instanceof Error ? error.message : 'Readiness check failed.' };
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setPhase('idle');
    }
  }, [apiBases, signIn]);

  return { phase, submit };
}
