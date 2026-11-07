'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Invalid or missing reset token. Please request a new link.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Something went wrong. Please try again.');
        return;
      }
      setDone(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <>
        <h1 className="login-title">Invalid link</h1>
        <p className="login-subtitle">
          This password reset link is invalid. Please{' '}
          <Link href="/forgot-password" style={{ color: 'var(--primary)' }}>request a new one</Link>.
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h1 className="login-title">Password updated</h1>
        <p className="login-subtitle">Your password has been reset successfully.</p>
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13 }}>
          <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
            Log in with your new password
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="login-title">Set a new password</h1>
      <p className="login-subtitle">Choose a strong password — at least 8 characters.</p>

      <form onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <div className="form-group">
          <label className="label" htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>

        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}

        <button
          className="btn"
          type="submit"
          style={{ width: '100%', height: 46, marginTop: 16 }}
          disabled={submitting}
        >
          {submitting ? 'Updating…' : 'RESET PASSWORD'}
        </button>
      </form>

      <div style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
        Remembered it?{' '}
        <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
          Log in
        </Link>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="login-shell">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SeriqCare logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <div className="brand" style={{ margin: 0 }}>Seriq<span>Care</span></div>
        </div>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
