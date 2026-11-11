import { NextRequest, NextResponse } from 'next/server';

// JS-readable presence cookie set by auth-context.tsx on the frontend domain (localhost:3000).
// The backend's HttpOnly seriqcare-rt cookie belongs to 127.0.0.1:8000 (different origin in dev)
// and is invisible to this middleware. The presence cookie is the authoritative session indicator here.
const SESSION_COOKIE = 'seriqcare-session';

// Routes that never require auth
const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password', '/clock'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The clock has its own sign-in screen and stays available during an active session.
  if (pathname === '/clock' || pathname.startsWith('/clock/') || pathname === '/clock.webmanifest') {
    return NextResponse.next();
  }

  // Pass through Next.js internals, API routes, and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/img/') ||
    /\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  // The presence cookie is the authoritative session indicator for the middleware.
  // If it's absent the user has no active session.
  const hasSession = !!request.cookies.get(SESSION_COOKIE)?.value;

  if (!isPublic && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isPublic && hasSession) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
