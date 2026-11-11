'use client';

import { useAuth } from './auth-context';
import { Sidebar } from './sidebar';

export function ProtectedLayout({ children, scrollable = false }: { children: React.ReactNode; scrollable?: boolean }) {
  const { isLoading, user } = useAuth();

  if (isLoading || !user) {
    return <div className="login-shell"><div className="login-subtitle">Loading...</div></div>;
  }

  return (
    <div className={`app-shell${scrollable ? ' app-shell-scrollable' : ''}`}>
      <Sidebar />
      <main className="main-area" data-page-scroll={scrollable ? 'true' : undefined}
        tabIndex={scrollable ? 0 : undefined} aria-label={scrollable ? 'Page content' : undefined}>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
