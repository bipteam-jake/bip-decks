// Slug generation for deck URLs.
//
// Per data-model §3.3: "slug is the human-readable URL segment (acme-series-a).
// Unique across all decks including soft-deleted ones to prevent slug
// recycling collisions."

import { prisma } from '@/lib/prisma';

const MAX_SLUG_LENGTH = 60;

/**
 * Lowercase, ASCII-ish, hyphen-separated. Strips diacritics and any character
 * that isn't [a-z0-9-]. Collapses runs of hyphens, trims leading/trailing.
 * Truncates to MAX_SLUG_LENGTH so suffixes still fit in the unique column.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, MAX_SLUG_LENGTH) || 'deck';
}

/**
 * Pick a slug derived from `title` that doesn't collide with any existing
 * deck — including soft-deleted ones, per the uniqueness rule above.
 * Appends -2, -3, ... on collision (up to 1000 attempts).
 */
export async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  for (let i = 2; i <= 1000; i++) {
    const existing = await prisma.deck.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    const suffix = `-${i}`;
    candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }
  throw new Error(`Could not find an available slug derived from "${title}"`);
}
