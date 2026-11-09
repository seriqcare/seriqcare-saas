'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth-context';
import { useLoginFlow } from '@/components/use-login-flow';
import TurnstileWidget, { turnstileEnabled } from '@/components/turnstile-widget';
import type { TurnstileInstance } from '@marsidev/react-turnstile';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { phase, submit } = useLoginFlow();
  const submitting = phase !== 'idle';
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [cfToken, setCfToken] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const { isLoading } = useAuth();
  const router = useRouter();

  // Countdown ticker while locked
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setCountdown(secs);
      if (secs === 0) {
        setLockedUntil(null);
        setError('');
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [lockedUntil]);

  const isLocked = lockedUntil !== null && countdown > 0;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLocked || submitting) return;

    if (turnstileEnabled && !cfToken) {
      setError('Please complete the security check.');
      return;
    }

    setError('');
    const result = await submit(email, password, cfToken || undefined);
    if (!result) return;

    if (!result.ok) {
      if (result.retryAfter) {
        setLockedUntil(Date.now() + result.retryAfter * 1000);
      }
      setError(result.error);
      // Reset Turnstile so user can get a fresh token for the next attempt
      setCfToken('');
      turnstileRef.current?.reset();
      return;
    }

    router.replace('/');
  };

  if (isLoading) return null;

  const fmtCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        {/* Brand — centred with logo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SeriqCare logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <div className="brand" style={{ margin: 0 }}>Seriq<span>Care</span></div>
        </div>

        <h3 className="login-title" style={{ textAlign: 'center' }}>Welcome back</h3>
        <p className="login-subtitle" style={{ textAlign: 'center' }}>Sign in to access the home care operations dashboard.</p>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting || isLocked}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="label" htmlFor="password">Password</label>
              <Link href="/forgot-password" style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="input"
                style={{ paddingRight: 40 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting || isLocked}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: 'var(--muted)', lineHeight: 0,
                }}
              >
                {showPassword ? (
                  // Eye-off icon
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  // Eye icon
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={setCfToken}
            onExpire={() => setCfToken('')}
            onError={() => setCfToken('')}
          />
          {phase === 'connecting' && (
            <p role="status">Connecting… Waking the server and database may take a couple of minutes.</p>
          )}

          <button
            className="btn"
            type="submit"
            style={{ width: '100%', height: 42, marginTop: 14 }}
            disabled={submitting || isLocked || (turnstileEnabled && !cfToken)}
          >
            {isLocked
              ? `Locked — try again in ${fmtCountdown(countdown)}`
              : submitting
              ? phase === 'connecting' ? 'Connecting…' : 'Signing in…'
              : 'Sign in'}
          </button>
        </form>

        {error ? (
          <div
            className="error-text"
            style={isLocked ? { color: '#b45309', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 4, padding: '8px 10px', marginTop: 12 } : undefined}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
