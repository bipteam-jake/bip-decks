// Session token generation and hashing.
//
// Per data model §3.2: "Token plaintext lives in an HTTP-only cookie on the
// client; the database stores a hash. Token hashed server-side with HMAC-SHA256
// using a secret from environment."
//
// Hash strategy: HMAC-SHA256(rawToken, SESSION_SECRET). HMAC (not bare SHA-256)
// so that a database leak of token_hash values cannot be brute-forced offline
// without also knowing SESSION_SECRET.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const TOKEN_BYTES = 32; // 256 bits of entropy

export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHmac('sha256', env.sessionSecret).update(rawToken).digest('hex');
}

/**
 * Constant-time hash comparison. The DB lookup is by hash so this isn't
 * strictly required (no per-character info leak in a unique-index lookup), but
 * keep it on principle for any direct comparisons.
 */
export function safeHashEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
