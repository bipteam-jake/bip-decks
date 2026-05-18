// Orchestrates view-time bundle serving: resolve a deck, check the cache,
// build if needed, persist to cache, return the HTML + metadata for the
// route handler.

import type { Deck } from '@bip/db';

import { NotFoundError } from '@/lib/errors';
import { bundleDeck } from '@/lib/decks/bundler';
import { getCachedBundle, putCachedBundle } from '@/lib/decks/bundle-cache';
import { getDeckBySlug } from '@/lib/decks/service';

export interface ServedBundle {
  deck: Deck;
  commitSha: string;
  html: string;
  /** True if served from Redis without re-reading the git tree. */
  cacheHit: boolean;
}

export interface GetBundleOptions {
  /** Skip cache reads + writes. Used in tests; not exposed via query string yet. */
  bypassCache?: boolean;
}

/**
 * Build (or fetch cached) HTML for the deck at `slug` at its current head.
 * Throws NotFoundError if the slug doesn't exist, the deck is soft-deleted,
 * or the deck has no commit yet (shouldn't happen — createDeck always commits).
 */
export async function getBundleBySlug(
  slug: string,
  options: GetBundleOptions = {},
): Promise<ServedBundle> {
  const deck = await getDeckBySlug(slug);
  if (!deck.headCommitSha) {
    throw new NotFoundError('Deck has no published content', 'deck_no_head');
  }
  return getBundleForDeck(deck, deck.headCommitSha, options);
}

/**
 * Low-level bundle accessor — given a resolved deck + commit, return HTML.
 * Exposed for tests and for the future preview/share-link paths which
 * already know the deck.
 */
export async function getBundleForDeck(
  deck: Deck,
  commitSha: string,
  options: GetBundleOptions = {},
): Promise<ServedBundle> {
  if (!options.bypassCache) {
    const cached = await getCachedBundle(deck.id, commitSha);
    if (cached !== null) {
      return { deck, commitSha, html: cached, cacheHit: true };
    }
  }

  const html = await bundleDeck({ repoPath: deck.repoPath, commitSha });

  if (!options.bypassCache) {
    await putCachedBundle(deck.id, commitSha, html);
  }

  return { deck, commitSha, html, cacheHit: false };
}
