// Route-handler authentication helpers.
//
// Phase 1 has only one role (UserKind.TEAM). When CLIENT lands in Phase 3 the
// `requireTeam` helper here is the place to enforce the distinction.

import { UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { readSessionCookie, setSessionCookie } from '@/lib/auth/cookies';
import { validateSessionToken, type SessionContext } from '@/lib/auth/session';
import type { User } from '@bip/db';

/**
 * Returns the current session context if the request is authenticated, else null.
 * Side effect: refreshes the session cookie when the rolling-refresh logic
 * extended the server-side expiry.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const raw = await readSessionCookie();
  if (!raw) return null;
  const ctx = await validateSessionToken(raw);
  if (!ctx) return null;
  if (ctx.refreshed) {
    // Re-issue the cookie so its client-side maxAge tracks the server expiry.
    // Next 15 forbids cookies().set() from Server Components, so the refresh
    // is best-effort: it succeeds in Route Handlers / Server Actions, and is
    // silently skipped when called from a Server Component (e.g. the admin
    // layout). The next mutating request will pick it up.
    try {
      await setSessionCookie(raw);
    } catch {
      // Server Component context — ignore.
    }
  }
  return ctx;
}

/**
 * Returns the authenticated user or throws UnauthorizedError. Use this in
 * routes that require a logged-in caller.
 */
export async function requireUser(): Promise<User> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx.user;
}

/**
 * Same as requireUser but additionally enforces UserKind.TEAM. In Phase 1
 * every user is TEAM, so this is functionally identical to requireUser; the
 * separation is here so Phase 3 (CLIENT users) doesn't require touching every
 * call site.
 */
export async function requireTeamUser(): Promise<User> {
  const user = await requireUser();
  if (user.kind !== 'TEAM') throw new ForbiddenError('Team access required');
  return user;
}
