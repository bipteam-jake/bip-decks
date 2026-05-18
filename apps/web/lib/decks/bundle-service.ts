// Orchestrates view-time bundle serving: resolve a deck, check the cache,
// build if needed, persist to cache, return the HTML + metadata for the
// route handler.
//
// Phase 2.1b: resolves the deck's pinned brand-kit version into a CSS block
// of custom properties (`--brand-color-*`, etc.) injected at the top of the
// bundled document. Cache key includes the version id so re-pinning evicts.

import type { Deck } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { bundleDeck } from '@/lib/decks/bundler';
import { getCachedBundle, putCachedBundle } from '@/lib/decks/bundle-cache';
import { getDeckBySlug } from '@/lib/decks/service';
import { parseTokens, resolveTokensToCss } from '@/lib/brand-kits/tokens';

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
 * Resolve the deck's pinned brand-kit version into an injectable CSS block.
 * Returns null when no kit is bound or the bound version was deleted.
 * Bad/invalid token JSON degrades to null with no thrown error — a missing
 * brand kit must never break view-time bundling.
 */
async function resolveBrandKitCss(
  brandKitVersionId: string | null,
): Promise<{ css: string; label: string } | null> {
  if (!brandKitVersionId) return null;
  const version = await prisma.brandKitVersion.findUnique({
    where: { id: brandKitVersionId },
    select: {
      id: true,
      versionLabel: true,
      tokens: true,
      brandKit: { select: { slug: true } },
    },
  });
  if (!version) return null;
  try {
    const tokens = parseTokens(version.tokens);
    const css = resolveTokensToCss(tokens);
    return { css, label: `brand-kit:${version.brandKit.slug}@${version.versionLabel}` };
  } catch {
    return null;
  }
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
  const brandKitVersionId = deck.brandKitVersionId ?? null;

  if (!options.bypassCache) {
    const cached = await getCachedBundle(deck.id, commitSha, brandKitVersionId);
    if (cached !== null) {
      return { deck, commitSha, html: cached, cacheHit: true };
    }
  }

  const brand = await resolveBrandKitCss(brandKitVersionId);

  const html = await bundleDeck({
    repoPath: deck.repoPath,
    commitSha,
    slug: deck.slug,
    brandKitCss: brand?.css,
    brandKitLabel: brand?.label,
  });

  if (!options.bypassCache) {
    await putCachedBundle(deck.id, commitSha, brandKitVersionId, html);
  }

  return { deck, commitSha, html, cacheHit: false };
}
