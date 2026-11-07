/**
 * Universal auth header helper.
 *
 * Server-side (Next.js Server Components / Route Handlers):
 *   reads the `seriqcare-at` cookie via `next/headers` (dynamically imported to avoid
 *   polluting client bundles).
 *
 * Client-side (browser / Client Components):
 *   reads the same cookie directly from `document.cookie`.
 *
 * The cookie is written by `auth-context.tsx` on login and each silent-refresh,
 * and mirrors the 10-minute access token lifetime.
 */

const COOKIE_NAME = 'seriqcare-at';

function fromDocumentCookie(): string | undefined {
  try {
    const m = document.cookie.match(/(?:^|;\s*)seriqcare-at=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

export async function getAuthHeaders(): Promise<HeadersInit> {
  // ── Client-side path ──────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    const token = fromDocumentCookie();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // ── Server-side path ──────────────────────────────────────────────────────
  // Dynamic import keeps `next/headers` out of the client bundle.
  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (raw) return { Authorization: `Bearer ${decodeURIComponent(raw)}` };
  } catch {
    // Static-generation context or no cookie — proceed unauthenticated.
  }
  return {};
}
