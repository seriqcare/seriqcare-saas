'use client';

import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import TurnstileWidget, { turnstileEnabled } from '@/components/turnstile-widget';
import type { TurnstileInstance } from '@marsidev/react-turnstile';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const [cfToken, setCfToken] = useState('');
  const turnstileRef = useRef<TurnstileInstance>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError('');
    setServerError('');

    if (!email.trim()) {
      setEmailError('Enter your email');
      return;
    }

    if (turnstileEnabled && !cfToken) {
      setServerError('Please complete the security check.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          ...(cfToken ? { cf_turnstile_token: cfToken } : {}),
        }),
      });
      if (res.status === 404) {
        setEmailError('No account found with that email address.');
        setCfToken('');
        turnstileRef.current?.reset();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServerError(data.detail ?? 'Something went wrong. Please try again.');
        setCfToken('');
        turnstileRef.current?.reset();
        return;
      }
      setSubmitted(true);
    } catch {
      setServerError('Something went wrong. Please try again.');
      setCfToken('');
      turnstileRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SeriqCare logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <div className="brand" style={{ margin: 0 }}>Seriq<span>Care</span></div>
        </div>

        {submitted ? (
          <>
            <h1 className="login-title">Check your email</h1>
            <p className="login-subtitle">
              If an account exists for <strong>{email}</strong>, you will receive a password
              reset link shortly. The link expires in one hour.
            </p>
            <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
              <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                Back to Log in
              </Link>
            </div>
          </>
        ) : (
          <>
            <h3 className="login-title">Want to reset your password?</h3>
            <p className="login-subtitle">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={onSubmit} noValidate>
              <div className="form-group" style={{ marginTop: 20 }}>
                <label className="label" htmlFor="email">
                  <span style={{ color: '#c0392b' }}>*</span> Email
                </label>
                <input
                  id="email"
                  type="email"
                  className={`input${emailError ? ' input-error' : ''}`}
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                  disabled={submitting}
                  autoComplete="email"
                  style={emailError ? { borderColor: '#c0392b' } : undefined}
                />
                {emailError && (
                  <div style={{
                    color: '#c0392b',
                    background: '#fdf3f2',
                    padding: '6px 10px',
                    fontSize: 13,
                    marginTop: 2,
                    borderRadius: 2,
                  }}>
                    {emailError}
                  </div>
                )}
              </div>

              <TurnstileWidget
                ref={turnstileRef}
                onSuccess={setCfToken}
                onExpire={() => setCfToken('')}
                onError={() => setCfToken('')}
              />

              {serverError && (
                <div className="error-text" style={{ marginTop: 8 }}>{serverError}</div>
              )}

              <button
                className="btn"
                type="submit"
                style={{ width: '100%', height: 46, marginTop: 16 }}
                disabled={submitting || (turnstileEnabled && !cfToken)}
              >
                {submitting ? 'Sending…' : 'RESET PASSWORD'}
              </button>
            </form>

            <div style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
              Don&apos;t need to reset your password?{' '}
              <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                Log in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
