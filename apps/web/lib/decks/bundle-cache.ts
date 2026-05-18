// Redis-backed cache for view-time deck bundles.
//
// Per architecture doc §7: "Look up the cache for (deck_id, commit_sha).
// If present, serve cached HTML. Otherwise: ... assemble ... write to cache,
// serve."
//
// Bundles are content-addressed by commit SHA, so entries are immutable once
// written. We set a long TTL (30 days) so cold decks naturally evict; a
// re-request rebuilds in milliseconds.
//
// Phase 2.1b: cache key extended with the deck's bound brand-kit version so
// re-pinning to a new kit/version doesn't serve stale CSS. Bumped to v2.

import { redis } from '@/lib/redis';

const KEY_PREFIX = 'deck-bundle:v2';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function key(deckId: string, commitSha: string, brandKitVersionId: string | null): string {
  return `${KEY_PREFIX}:${deckId}:${commitSha}:${brandKitVersionId ?? 'none'}`;
}

/** Ensure the lazy-connect ioredis client has an open socket. */
async function ensureReady(): Promise<boolean> {
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    return true;
  } catch {
    return false;
  }
}

export async function getCachedBundle(
  deckId: string,
  commitSha: string,
  brandKitVersionId: string | null,
): Promise<string | null> {
  if (!(await ensureReady())) return null;
  try {
    return await redis.get(key(deckId, commitSha, brandKitVersionId));
  } catch {
    return null;
  }
}

export async function putCachedBundle(
  deckId: string,
  commitSha: string,
  brandKitVersionId: string | null,
  html: string,
): Promise<void> {
  if (!(await ensureReady())) return;
  try {
    await redis.set(key(deckId, commitSha, brandKitVersionId), html, 'EX', TTL_SECONDS);
  } catch {
    // Cache failure should never break serving.
  }
}

/**
 * Drop a single (deck, commit, brandKitVersion) entry. Used on AI-edit
 * accept (the old head SHA is no longer reachable) and on brand-kit re-pin.
 */
export async function invalidateCachedBundle(
  deckId: string,
  commitSha: string,
  brandKitVersionId: string | null,
): Promise<void> {
  if (!(await ensureReady())) return;
  try {
    await redis.del(key(deckId, commitSha, brandKitVersionId));
  } catch {
    // Same rationale as put: cache misses are recoverable.
  }
}
