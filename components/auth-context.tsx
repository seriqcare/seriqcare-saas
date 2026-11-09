'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AuthUser = {
  token: string;           // current access token (10-min JWT, in-memory only)
  username: string;
  email: string | null;
  display_name: string | null;
  role: 'caregiver' | 'coordinator' | 'agency_admin' | 'super_admin';
  agency_id: number | null;
  employee_id: number | null;
  agency_tier: string | null;       // 'core' | 'evv' | 'evvplus' | null (super_admin)
  agency_aggregator: string | null; // 'sandata' | 'hhax' | null
};

export type SignInResult = { ok: true } | { ok: false; error: string; retryAfter?: number };

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (username: string, password: string, base: string, cfToken?: string) => Promise<SignInResult>;
  apiBases: string[];
  signOut: () => void;
  /** Authenticated fetch — adds Bearer token, silently refreshes on 401. */
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AUTH_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_AUTH_TIMEOUT_MS ?? 4500);
const AUTH_BOOT_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_AUTH_BOOT_TIMEOUT_MS ?? 6000);
const REFRESH_CHECK_MS = 30 * 1000;
const PROACTIVE_REFRESH_MS = 8.5 * 60 * 1000; // 8.5 min — refresh before 10-min AT expires

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildApiBases(currentHost?: string): string[] {
  const hostBase = currentHost ? `http://${currentHost}:8000` : undefined;
  const configured = [
    process.env.NEXT_PUBLIC_API_BASE_URL,
    process.env.API_BASE_URL,
  ].filter((v): v is string => Boolean(v));
  const preferred = configured.length ? configured : [
    hostBase,
    'http://127.0.0.1:8000',
    'http://localhost:8000',
  ].filter((v): v is string => Boolean(v));

  const expanded = preferred.flatMap((base) => {
    const normalized = trimSlash(base);
    // Keep local API cookies on the browser's hostname (SameSite=Lax).
    const loopbackHosts = ['localhost', '127.0.0.1'];
    if (currentHost && loopbackHosts.includes(currentHost)) {
      const parsed = new URL(normalized);
      if (loopbackHosts.includes(parsed.hostname)) {
        parsed.hostname = currentHost;
        return [trimSlash(parsed.toString())];
      }
    }
    return normalized.includes('localhost')
      ? [normalized, normalized.replace('localhost', '127.0.0.1')]
      : [normalized];
  });

  return [...new Set(expanded)];
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAuthAcrossBases(
  bases: string[],
  path: string,
  init: RequestInit,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<Response> {
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    return fetchWithTimeout(`${bases[0]}${path}`, init, timeoutMs);
  }
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      return await fetchWithTimeout(`${base}${path}`, init, timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Auth API unreachable');
}

// JS-readable presence cookie on the FRONTEND domain (localhost:3000).
// The middleware checks this — it cannot read the backend's HttpOnly cookie
// because that belongs to 127.0.0.1:8000, a different origin.
const SESSION_PRESENCE = 'seriqcare-session';
const SESSION_API_BASE = 'seriqcare-api-base';

function setPresenceCookie() {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${SESSION_PRESENCE}=1; path=/; expires=${expires}; SameSite=Lax`;
}

function clearPresenceCookie() {
  document.cookie = `${SESSION_PRESENCE}=; path=/; max-age=0; SameSite=Lax`;
}

// Short-lived access-token cookie so Server Components can make authenticated requests.
// NOT HttpOnly — Next.js server reads it via cookies() from next/headers.
// Expires with the access token (10 minutes).
const AT_COOKIE = 'seriqcare-at';

function setTokenCookie(token: string) {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toUTCString();
  document.cookie = `${AT_COOKIE}=${encodeURIComponent(token)}; path=/; expires=${expires}; SameSite=Lax`;
}

function clearTokenCookie() {
  document.cookie = `${AT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const apiBases = useMemo(
    () => buildApiBases(typeof window !== 'undefined' ? window.location.hostname : undefined),
    [],
  );

  // In-memory access token — never touches localStorage or a JS-readable cookie
  const accessTokenRef = useRef<string | null>(null);
  const activeBaseRef = useRef(apiBases[0]);
  const lastRefreshAtRef = useRef(0);

  // Deduplication: if multiple callers hit 401 simultaneously, share one refresh call
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  // Cross-tab coordination via BroadcastChannel
  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(SESSION_API_BASE);
      if (saved && apiBases.includes(saved)) activeBaseRef.current = saved;
    } catch (error) {
      console.warn('Unable to restore the session API endpoint.', error);
    }
  }, [apiBases]);

  // ---------------------------------------------------------------------------
  // Silent refresh — called on mount and on 401
  // ---------------------------------------------------------------------------
  const silentRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const p = (async () => {
      try {
        const res = await fetchAuthAcrossBases([activeBaseRef.current], '/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',    // sends HttpOnly "seriqcare-rt" cookie
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok && res.status !== 401) {
          // Server errors and rate limits do not invalidate the refresh session.
          return null;
        }
        if (res.status === 401) {
          // Definitive server rejection — session is truly invalid
          accessTokenRef.current = null;
          clearPresenceCookie();
          clearTokenCookie();
          setUser(null);
          return null;
        }
        const data = await res.json();
        const nextUser: AuthUser = {
          token: data.access_token,
          username: data.username,
          email: data.email ?? null,
          display_name: data.display_name,
          role: data.role,
          agency_id: data.agency_id,
          employee_id: data.employee_id,
          agency_tier: data.agency_tier ?? null,
          agency_aggregator: data.agency_aggregator ?? null,
        };
        accessTokenRef.current = data.access_token;
        lastRefreshAtRef.current = Date.now();
        setPresenceCookie();
        setTokenCookie(data.access_token);
        setUser(nextUser);
        // Broadcast new token to other tabs so they don't race on /refresh
        bcRef.current?.postMessage({ type: 'TOKEN_REFRESHED', token: data.access_token, user: nextUser, base: activeBaseRef.current });
        return data.access_token as string;
      } catch {
        // Network/timeout error — backend unreachable, preserve existing state.
        // Don't clear the token or user; the AT may still be valid for a bit longer.
        // Retry renewal later; only a refresh 401 confirms the session is invalid.
        return null;
      }
    })();

    refreshPromiseRef.current = p;
    const result = await p;
    refreshPromiseRef.current = null;
    return result;
  }, [apiBases]);

  // Restore session on mount (reads from HttpOnly cookie via /refresh).
  // Capped to keep login screen responsive even if backend is slow/cold.
  useEffect(() => {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_BOOT_TIMEOUT_MS));
    Promise.race([silentRefresh(), timeout]).finally(() => setIsLoading(false));
  }, [silentRefresh]);

  // Cross-tab coordination: receive token updates and logout signals from other tabs.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bc = new BroadcastChannel('seriqcare-auth');
    bcRef.current = bc;
    bc.onmessage = (evt) => {
      if (evt.data?.type === 'TOKEN_REFRESHED') {
        if (typeof evt.data.base === 'string' && apiBases.includes(evt.data.base)) {
          activeBaseRef.current = evt.data.base;
        }
        accessTokenRef.current = evt.data.token;
        lastRefreshAtRef.current = Date.now();
        setTokenCookie(evt.data.token);
        setPresenceCookie();
        setUser(evt.data.user);
      } else if (evt.data?.type === 'SIGNED_OUT') {
        accessTokenRef.current = null;
        clearPresenceCookie();
        clearTokenCookie();
        setUser(null);
      }
    };
    return () => { bc.close(); bcRef.current = null; };
  }, [apiBases]);

  // Proactive token refresh — keeps the session alive without waiting for a 401.
  useEffect(() => {
    const refreshIfDue = () => {
      const hasSession = accessTokenRef.current || document.cookie.includes(`${SESSION_PRESENCE}=`);
      if (hasSession && Date.now() - lastRefreshAtRef.current >= PROACTIVE_REFRESH_MS) {
        void silentRefresh();
      }
    };
    // Once renewal is due, retry transient failures every 30 seconds.
    const id = setInterval(refreshIfDue, REFRESH_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfDue();
    };
    window.addEventListener('online', refreshIfDue);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', refreshIfDue);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [silentRefresh]);

  // Client-side route guard (backup to middleware).
  // Only redirects to /login when the server has confirmed no valid session
  // (presence cookie absent). A network failure during refresh is not grounds
  // for redirect — the middleware already handles server-side protection.
  useEffect(() => {
    if (isLoading) return;
    const isClockPage = pathname === '/clock' || pathname.startsWith('/clock/');
    if (isClockPage) return;
    const isPublicPage = ['/login', '/signup', '/forgot-password', '/reset-password'].some(
      (p) => pathname === p || pathname.startsWith(p + '/')
    );
    const hasPresenceCookie = document.cookie.includes(`${SESSION_PRESENCE}=`);
    if (!user && !hasPresenceCookie && !isPublicPage) router.replace('/login');
    if (user && isPublicPage) {
      router.replace(user.role === 'super_admin' ? '/super-admin' : '/');
    }
  }, [isLoading, pathname, router, user]);

  // ---------------------------------------------------------------------------
  // apiFetch — adds Bearer token + automatic retry on 401
  // ---------------------------------------------------------------------------
  const apiFetch = useCallback(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const token = accessTokenRef.current;
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const fullUrl = url.startsWith('http') ? url : `${activeBaseRef.current}${url}`;
    let res = await fetch(fullUrl, { ...init, headers, credentials: 'include' });

    if (res.status === 401) {
      const newToken = await silentRefresh();
      if (!newToken) {
        // Preserve the session on timeouts/server errors for a later retry.
        if (!accessTokenRef.current && !document.cookie.includes(`${SESSION_PRESENCE}=`)) {
          router.replace('/login');
        }
        return res;
      }
      headers.set('Authorization', `Bearer ${newToken}`);
      if (!init.method || ['GET', 'HEAD'].includes(init.method.toUpperCase())) {
        res = await fetch(fullUrl, { ...init, headers, credentials: 'include' });
      }
    }

    return res;
  }, [apiBases, silentRefresh, router]);

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------
  const signOut = useCallback(() => {
    const token = accessTokenRef.current;
    fetchAuthAcrossBases(
      [activeBaseRef.current],
      '/api/auth/logout',
      {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      2500,
    ).catch(() => {});
    accessTokenRef.current = null;
    clearPresenceCookie();
    clearTokenCookie();
    setUser(null);
    bcRef.current?.postMessage({ type: 'SIGNED_OUT' });
    const nextRoute = pathname === '/clock' || pathname.startsWith('/clock/') ? '/clock' : '/login';
    router.replace(nextRoute);
  }, [apiBases, pathname, router]);

  // ---------------------------------------------------------------------------
  // signIn
  // ---------------------------------------------------------------------------
  const signIn = useCallback(async (username: string, password: string, base: string, cfToken?: string): Promise<SignInResult> => {
    try {
      const res = await fetchWithTimeout(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',   // receive HttpOnly refresh token cookie
        body: JSON.stringify({ username, password, client_type: 'web', ...(cfToken ? { cf_turnstile_token: cfToken } : {}) }),
      }, AUTH_TIMEOUT_MS);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        return { ok: false, error: body?.detail ?? 'Invalid username or password.', retryAfter };
      }

      const data = await res.json();
      activeBaseRef.current = base;
      try {
        window.sessionStorage.setItem(SESSION_API_BASE, base);
      } catch (error) {
        console.warn('Unable to save the session API endpoint.', error);
      }
      accessTokenRef.current = data.access_token;
      lastRefreshAtRef.current = Date.now();
      setPresenceCookie();
      setTokenCookie(data.access_token);
      setUser({
        token: data.access_token,
        username: data.username,
        email: data.email ?? null,
        display_name: data.display_name,
        role: data.role,
        agency_id: data.agency_id,
        employee_id: data.employee_id,
        agency_tier: data.agency_tier ?? null,
        agency_aggregator: data.agency_aggregator ?? null,
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Cannot connect to server. Is the backend running?' };
    }
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({ user, isLoading, signIn, signOut, apiFetch, apiBases }),
    [user, isLoading, signIn, signOut, apiFetch, apiBases],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
