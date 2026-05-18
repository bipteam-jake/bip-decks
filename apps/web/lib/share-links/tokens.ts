// Random token for share-link URLs.
//
// Per data-model.md §3.7: "`token` is an opaque random string (32 bytes,
// base64url encoded)". Generated server-side with crypto.randomBytes so
// it's cryptographically random, not predictable.

import { randomBytes } from 'node:crypto';

export function generateShareLinkToken(): string {
  return randomBytes(32).toString('base64url');
}
