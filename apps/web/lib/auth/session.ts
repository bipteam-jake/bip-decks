// Session lifecycle: create, validate (with rolling refresh), invalidate.
//
// Per phasing doc §1: "90-day rolling sessions in HTTP-only cookies."
// Per data model §3.2: rolling means each successful validation extends
// expires_at and updates last_used_at. To avoid hammering the DB, we throttle
// the refresh: only update if more than REFRESH_THROTTLE_MS has passed since
// last_used_at.

import { prisma } from '@/lib/prisma';
import { generateRawToken, hashToken } from '@/lib/auth/tokens';
import type { Session, User } from '@bip/db';

export const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const REFRESH_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

export interface SessionContext {
  user: User;
  session: Session;
  /** True if the rolling-refresh logic touched the DB on this validation. */
  refreshed: boolean;
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface CreatedSession {
  session: Session;
  rawToken: string;
}

/**
 * Issue a new session. Returns the raw token (to be set in the cookie) and the
 * persisted session row (which only stores the hash).
 */
export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      lastUsedAt: now,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });
  return { session, rawToken };
}

/**
 * Look up a session by raw token, verify it's not expired, and (if past the
 * throttle window) refresh its expiry. Returns null on any failure path —
 * never throws on bad/missing/expired tokens.
 *
 * Soft-deleted users are treated as logged out.
 */
export async function validateSessionToken(rawToken: string): Promise<SessionContext | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.user.deletedAt) return null;

  const now = new Date();
  if (session.expiresAt <= now) {
    // Expired — clean it up so the table doesn't grow unbounded.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const sinceLastUse = now.getTime() - session.lastUsedAt.getTime();
  if (sinceLastUse < REFRESH_THROTTLE_MS) {
    return { user: session.user, session, refreshed: false };
  }

  const refreshed = await prisma.session.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    },
  });
  return { user: session.user, session: refreshed, refreshed: true };
}

/**
 * Invalidate a single session by its raw token. Idempotent.
 */
export async function invalidateSessionByToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

/**
 * Nuke every session for a user (e.g. after a password change). Not wired to
 * an endpoint yet — exposed for future use.
 */
export async function invalidateAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
