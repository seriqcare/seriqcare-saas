'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function LiveVisitRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (pending || document.visibilityState !== 'visible') return;
      if (document.querySelector('dialog[open], [role="dialog"], input:focus, select:focus, textarea:focus')) return;
      startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, pending, startTransition]);
  return null;
}
