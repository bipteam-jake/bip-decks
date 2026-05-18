// Cookie helpers for the session token. Centralized so attribute changes only
// happen in one place.
//
// Per phasing doc §6: "HTTP-only, secure, SameSite cookies for sessions."

import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { SESSION_LIFETIME_MS } from '@/lib/auth/session';

export const SESSION_COOKIE_NAME = 'bip_session';

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Secure cookies can't be sent over plain HTTP in dev. Production is HTTPS
    // (per deployment doc §5: "nginx ... terminates TLS").
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_LIFETIME_MS / 1000),
  };
}

export async function setSessionCookie(rawToken: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, rawToken, baseOptions());
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, '', { ...baseOptions(), maxAge: 0 });
}

export async function readSessionCookie(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
}
