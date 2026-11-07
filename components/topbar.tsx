'use client';

import { useAuth } from './auth-context';

export function HeaderUser() {
  const { user, signOut } = useAuth();

  return (
    <button className="btn secondary" onClick={signOut}>
      Sign out
    </button>
  );
}
