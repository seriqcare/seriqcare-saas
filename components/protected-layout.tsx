'use client';

import { useAuth } from './auth-context';
import { Sidebar } from './sidebar';

export function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useAuth();

  if (isLoading || !user) {
    return <div className="login-shell"><div className="login-subtitle">Loading...</div></div>;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-area">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
