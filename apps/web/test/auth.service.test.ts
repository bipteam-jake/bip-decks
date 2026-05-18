// Auth service tests. Run against the real dev Postgres (which the local
// docker-compose brings up). Each test creates uniquely-named users so suites
// can run in parallel against the same DB; cleanup happens in afterEach.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createUser, login, logout } from '@/lib/auth/service';
import {
  createSession,
  invalidateAllSessionsForUser,
  validateSessionToken,
  REFRESH_THROTTLE_MS,
  SESSION_LIFETIME_MS,
} from '@/lib/auth/session';
import { ConflictError, InvalidCredentialsError, ValidationError } from '@/lib/errors';

const TEST_TAG = '+vitest@bip.test';
const PASSWORD = 'correct-horse-battery-staple-42';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}

beforeAll(async () => {
  // Sanity: refuse to run if not pointed at a local-looking DB.
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('DATABASE_URL not set; cannot run auth tests');
});

afterEach(async () => {
  // Wipe anything the test created. The TEST_TAG suffix isolates us from real
  // application data even if someone runs this against a populated dev DB.
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

describe('createUser (signup)', () => {
  it('creates a TEAM user with a hashed password', async () => {
    const email = uniqueEmail('signup');
    const user = await createUser({ email, name: 'Test User', password: PASSWORD });

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.email).toBe(email);
    expect(user.kind).toBe('TEAM');
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
  });

  it('lower-cases and trims the email', async () => {
    const email = uniqueEmail('CASE');
    const user = await createUser({
      email: `  ${email.toUpperCase()}  `,
      name: 'Case Test',
      password: PASSWORD,
    });
    expect(user.email).toBe(email.toLowerCase());
  });

  it('rejects a duplicate email with ConflictError', async () => {
    const email = uniqueEmail('dup');
    await createUser({ email, name: 'First', password: PASSWORD });
    await expect(createUser({ email, name: 'Second', password: PASSWORD })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rejects a too-short password with ValidationError', async () => {
    await expect(
      createUser({ email: uniqueEmail('weak'), name: 'Weak', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a blank name with ValidationError', async () => {
    await expect(
      createUser({ email: uniqueEmail('blank'), name: '   ', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('login', () => {
  it('happy path: returns user + session with raw token', async () => {
    const email = uniqueEmail('login');
    await createUser({ email, name: 'Login User', password: PASSWORD });
    const result = await login({ email, password: PASSWORD });

    expect(result.user.email).toBe(email);
    expect(result.session.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url(32 bytes)
    expect(result.session.session.userId).toBe(result.user.id);
    expect(result.session.session.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + SESSION_LIFETIME_MS - 60_000,
    );

    const refreshed = await prisma.user.findUnique({ where: { id: result.user.id } });
    expect(refreshed?.lastLoginAt).not.toBeNull();
  });

  it('captures user agent and IP', async () => {
    const email = uniqueEmail('login-meta');
    await createUser({ email, name: 'Meta', password: PASSWORD });
    const result = await login({
      email,
      password: PASSWORD,
      userAgent: 'vitest/1.0',
      ipAddress: '203.0.113.42',
    });
    expect(result.session.session.userAgent).toBe('vitest/1.0');
    expect(result.session.session.ipAddress).toBe('203.0.113.42');
  });

  it('rejects wrong password with InvalidCredentialsError', async () => {
    const email = uniqueEmail('badpw');
    await createUser({ email, name: 'BadPW', password: PASSWORD });
    await expect(login({ email, password: 'wrong-password-99' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('rejects unknown email with InvalidCredentialsError (no user-enumeration leak)', async () => {
    await expect(login({ email: uniqueEmail('ghost'), password: PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('refuses login for a soft-deleted user', async () => {
    const email = uniqueEmail('deleted');
    const user = await createUser({ email, name: 'Deleted', password: PASSWORD });
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    await expect(login({ email, password: PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});

describe('session validation and rolling refresh', () => {
  it('validates a fresh token and returns the user', async () => {
    const email = uniqueEmail('validate');
    const user = await createUser({ email, name: 'Validate', password: PASSWORD });
    const { rawToken } = await createSession({ userId: user.id });

    const ctx = await validateSessionToken(rawToken);
    expect(ctx).not.toBeNull();
    expect(ctx!.user.id).toBe(user.id);
    expect(ctx!.refreshed).toBe(false); // within throttle window
  });

  it('returns null for an unknown token', async () => {
    const ctx = await validateSessionToken('totally-bogus-token');
    expect(ctx).toBeNull();
  });

  it('returns null and deletes an expired session', async () => {
    const email = uniqueEmail('expired');
    const user = await createUser({ email, name: 'Expired', password: PASSWORD });
    const { session, rawToken } = await createSession({ userId: user.id });
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await validateSessionToken(rawToken)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
  });

  it('refreshes expiry once last_used_at exceeds the throttle window', async () => {
    const email = uniqueEmail('refresh');
    const user = await createUser({ email, name: 'Refresh', password: PASSWORD });
    const { session, rawToken } = await createSession({ userId: user.id });

    // Backdate last_used_at past the throttle. expires_at stays in the future —
    // rolling refresh only applies to sessions that are still valid.
    const old = new Date(Date.now() - REFRESH_THROTTLE_MS - 1000);
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: old },
    });

    const ctx = await validateSessionToken(rawToken);
    expect(ctx).not.toBeNull();
    expect(ctx!.refreshed).toBe(true);
    expect(ctx!.session.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + SESSION_LIFETIME_MS - 60_000,
    );
  });
});

describe('logout', () => {
  it('invalidates the session row', async () => {
    const email = uniqueEmail('logout');
    const user = await createUser({ email, name: 'Logout', password: PASSWORD });
    const { session, rawToken } = await createSession({ userId: user.id });

    await logout(rawToken);

    expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await validateSessionToken(rawToken)).toBeNull();
  });

  it('is a no-op for a missing or unknown token', async () => {
    await expect(logout(null)).resolves.toBeUndefined();
    await expect(logout('not-a-real-token')).resolves.toBeUndefined();
  });
});

describe('invalidateAllSessionsForUser', () => {
  it('removes every session for the given user', async () => {
    const email = uniqueEmail('all');
    const user = await createUser({ email, name: 'All', password: PASSWORD });
    await createSession({ userId: user.id });
    await createSession({ userId: user.id });
    await createSession({ userId: user.id });

    await invalidateAllSessionsForUser(user.id);
    const remaining = await prisma.session.count({ where: { userId: user.id } });
    expect(remaining).toBe(0);
  });
});
