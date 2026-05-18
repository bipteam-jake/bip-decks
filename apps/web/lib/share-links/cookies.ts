// Recipient identity cookie for share-link visitors.
//
// One cookie per deck (`bip_r_<deckId>`) so the same browser can have
// distinct reviewer identities for distinct decks open in different tabs.
// Per data-model.md §3.8: "`clientId` is a UUID generated client-side,
// persisted in localStorage plus a cookie. On revisit the client sends it
// back so we resolve to the same recipient."
//
// We sign the cookie value with HMAC-SHA256 keyed by SESSION_SECRET so a
// stolen cookie can't be forged by another viewer. Format:
//   `<recipientId>.<sig>` where sig = base64url(HMAC(secret, recipientId|deckId))

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';

const COOKIE_PREFIX = 'bip_r_';
// 30 days; matches the default share-link expiry per architecture §8
// ("Expiry (default 30 days, configurable)"). Recipients re-claim if it
// lapses — cheap UX since the magic link can be re-issued.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function cookieName(deckId: string): string {
  return `${COOKIE_PREFIX}${deckId}`;
}

function sign(recipientId: string, deckId: string): string {
  const h = createHmac('sha256', env.sessionSecret);
  h.update(`${recipientId}|${deckId}`);
  return h.digest('base64url');
}

export function setRecipientCookie(opts: { deckId: string; recipientId: string }): void {
  const value = `${opts.recipientId}.${sign(opts.recipientId, opts.deckId)}`;
  cookies().set(cookieName(opts.deckId), value, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearRecipientCookie(deckId: string): void {
  cookies().set(cookieName(deckId), '', {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Read + verify the recipient cookie for `deckId`. Returns the recipient id
 * if the signature matches, else null.
 */
export function readRecipientCookie(deckId: string): string | null {
  const raw = cookies().get(cookieName(deckId))?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const recipientId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(recipientId, deckId);
  if (sig.length !== expected.length) return null;
  try {
    const ok = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    return ok ? recipientId : null;
  } catch {
    return null;
  }
}
