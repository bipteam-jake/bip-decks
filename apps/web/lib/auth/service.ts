// Auth business logic: signup, login, logout. API routes are thin wrappers
// around these.

import { Prisma, type User } from '@bip/db';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, invalidateSessionByToken, type CreatedSession } from '@/lib/auth/session';
import { ConflictError, InvalidCredentialsError, ValidationError } from '@/lib/errors';

export interface SignupInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface LoginResult {
  user: User;
  session: CreatedSession;
}

const MIN_PASSWORD_LENGTH = 12;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPasswordStrength(password: string): void {
  // Minimal Phase 1 policy: length only. The architecture doc doesn't pin a
  // policy; we take the OWASP "long over complex" stance. Tighten later if BIP
  // security requires it.
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, {
      field: 'password',
    });
  }
}

/**
 * Create a new TEAM user. Caller is responsible for authorization (Phase 1
 * policy: only an existing authenticated team user may invoke this).
 */
export async function createUser(input: SignupInput): Promise<User> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (name.length === 0) {
    throw new ValidationError('Name is required', { field: 'name' });
  }
  assertPasswordStrength(input.password);

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.user.create({
      data: { email, name, passwordHash, kind: 'TEAM' },
    });
  } catch (e) {
    // Prisma unique-constraint violation on email.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictError('A user with that email already exists', 'email_taken');
    }
    throw e;
  }
}

/**
 * Verify credentials and issue a session. Returns the raw token alongside the
 * session row so the caller can set the cookie.
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  const user = await prisma.user.findUnique({ where: { email } });

  // Always run a hash verification, even on miss, to keep response timing
  // independent of whether the email exists.
  const dummyHash =
    '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$' +
    'A8qzkD8R9I2sZQzj0iWb0H3zXCQ6oXqfTYQpPbq2Z8s';
  const stored = user?.passwordHash ?? dummyHash;
  const ok = await verifyPassword(input.password, stored);

  if (!user || user.deletedAt || !user.passwordHash || !ok) {
    throw new InvalidCredentialsError();
  }

  const session = await createSession({
    userId: user.id,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
  });

  // Best-effort lastLoginAt update; failure shouldn't block login.
  await prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  return { user, session };
}

export async function logout(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  await invalidateSessionByToken(rawToken);
}
