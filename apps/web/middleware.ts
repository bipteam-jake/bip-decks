// Edge middleware: cheap session-cookie presence check for the admin shell.
//
// This does NOT validate the session — that requires Node APIs (HMAC, DB) and
// happens in apps/web/app/(admin)/layout.tsx via getSessionContext(). The
// middleware exists to short-circuit obviously-anonymous requests with a
// redirect, per the Session 6 prompt: "Session middleware redirects
// unauthenticated requests to login."
//
// Protected paths: `/`, `/decks`, `/decks/*`. The login page, API routes,
// public deck-view route `/d/*`, and static assets pass through.

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'bip_session';

// Paths the middleware actively gates. Anything else short-circuits.
const PROTECTED_PREFIXES = ['/decks'];
const PROTECTED_EXACT = new Set(['/']);

function isProtected(pathname: string): boolean {
  if (PROTECTED_EXACT.has(pathname)) return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  if (req.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  // Preserve where the user was trying to go so we can bounce back post-login.
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals + API routes + public viewer + static assets. The
  // layout's server-side auth check covers everything else, but we still keep
  // the matcher narrow so unrelated routes don't pay the cookie-read cost.
  matcher: ['/', '/decks/:path*'],
};
