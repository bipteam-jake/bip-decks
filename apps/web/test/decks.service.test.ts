// Deck service tests. Use the real Postgres + filesystem; each test uses a
// temp dir for DECK_REPOS_PATH so it doesn't touch ./deck-repos.
//
// IMPORTANT: this file mutates process.env.DECK_REPOS_PATH at module load
// time, BEFORE importing lib/decks/service, so the cached env getter picks
// up the temp path.

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TMP_REPOS = mkdtempSync(path.join(tmpdir(), 'bip-deck-test-'));
process.env.DECK_REPOS_PATH = TMP_REPOS;

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import {
  archiveDeck,
  createDeck,
  getDeckById,
  listDecks,
  softDeleteDeck,
  unarchiveDeck,
  updateDeck,
} from '@/lib/decks/service';
import { generateUniqueSlug, slugify } from '@/lib/decks/slug';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { User } from '@bip/db';

const TEST_TAG = '+deckvitest@bip.test';
const TEST_SLUG_PREFIX = 'vt-';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}

function uniqueTitle(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'creator'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `Deck Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
});

afterEach(async () => {
  // Cascade: deleting users with deletedAt null/notnull deletes their decks
  // via createdBy? No — createdBy has no cascade. Wipe decks first, then users.
  await prisma.deck.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

afterAll(() => {
  rmSync(TMP_REPOS, { recursive: true, force: true });
});

describe('slug helpers', () => {
  it('slugifies titles to URL-safe segments', () => {
    expect(slugify('Acme Series A!')).toBe('acme-series-a');
    expect(slugify('  hello   world  ')).toBe('hello-world');
    expect(slugify('Café é à')).toBe('cafe-e-a');
    expect(slugify('---')).toBe('deck');
  });

  it('appends a numeric suffix on slug collisions', async () => {
    const user = await makeUser();
    const title = uniqueTitle('collide');
    const a = await createDeck({ title }, user);
    const next = await generateUniqueSlug(title);
    expect(next).toBe(`${a.slug}-2`);
  });
});

describe('createDeck', () => {
  it('creates a deck, inits a git repo with starter files, and stores headCommitSha', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('create') }, user);

    expect(deck.id).toBeTruthy();
    expect(deck.slug.startsWith(TEST_SLUG_PREFIX)).toBe(true);
    expect(deck.repoPath).toBe(path.join(TMP_REPOS, deck.slug));
    expect(deck.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(deck.lifecycleStage).toBe('DRAFT');
    expect(deck.createdById).toBe(user.id);

    // Files on disk
    expect(existsSync(path.join(deck.repoPath, '.git'))).toBe(true);
    expect(existsSync(path.join(deck.repoPath, 'slides/s1.html'))).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(deck.repoPath, 'deck.json'), 'utf8'));
    expect(manifest.title).toBe(deck.title);
    expect(manifest.slides).toHaveLength(1);
    expect(manifest.slides[0]).toMatchObject({ id: 's1', title: 'Untitled slide' });
  });

  it('rejects an empty title', async () => {
    const user = await makeUser();
    await expect(createDeck({ title: '   ' }, user)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid explicit slug', async () => {
    const user = await makeUser();
    await expect(
      createDeck({ title: uniqueTitle('badslug'), slug: 'NotValid_Slug' }, user),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a slug already in use (including by soft-deleted decks)', async () => {
    const user = await makeUser();
    const a = await createDeck({ title: uniqueTitle('dup') }, user);
    await softDeleteDeck(a.id);
    await expect(
      createDeck({ title: 'New title', slug: a.slug }, user),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('listDecks', () => {
  it('excludes soft-deleted decks always and archived decks by default', async () => {
    const user = await makeUser();
    const live = await createDeck({ title: uniqueTitle('live') }, user);
    const archived = await createDeck({ title: uniqueTitle('arch') }, user);
    await archiveDeck(archived.id);
    const deleted = await createDeck({ title: uniqueTitle('gone') }, user);
    await softDeleteDeck(deleted.id);

    const defaultList = await listDecks();
    const defaultIds = new Set(defaultList.map((d) => d.id));
    expect(defaultIds.has(live.id)).toBe(true);
    expect(defaultIds.has(archived.id)).toBe(false);
    expect(defaultIds.has(deleted.id)).toBe(false);

    const withArchived = await listDecks({ includeArchived: true });
    const withArchivedIds = new Set(withArchived.map((d) => d.id));
    expect(withArchivedIds.has(archived.id)).toBe(true);
    expect(withArchivedIds.has(deleted.id)).toBe(false);
  });
});

describe('getDeckById', () => {
  it('returns the deck when found', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('get') }, user);
    const fetched = await getDeckById(deck.id);
    expect(fetched.id).toBe(deck.id);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(getDeckById('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFoundError for a soft-deleted deck', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('softgone') }, user);
    await softDeleteDeck(deck.id);
    await expect(getDeckById(deck.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateDeck', () => {
  it('renames a deck without changing its slug', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('rename') }, user);
    const updated = await updateDeck(deck.id, { title: 'A New Title' });
    expect(updated.title).toBe('A New Title');
    expect(updated.slug).toBe(deck.slug);
  });

  it('sets the lifecycle stage', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('stage') }, user);
    const updated = await updateDeck(deck.id, { lifecycleStage: 'REVIEWING' });
    expect(updated.lifecycleStage).toBe('REVIEWING');
  });

  it('rejects an empty title', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('empty') }, user);
    await expect(updateDeck(deck.id, { title: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('archive / unarchive', () => {
  it('round-trips archivedAt', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('archroundtrip') }, user);
    expect(deck.archivedAt).toBeNull();

    const archived = await archiveDeck(deck.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);

    // Idempotent re-archive returns the same archivedAt.
    const archivedAgain = await archiveDeck(deck.id);
    expect(archivedAgain.archivedAt!.getTime()).toBe(archived.archivedAt!.getTime());

    const unarchived = await unarchiveDeck(deck.id);
    expect(unarchived.archivedAt).toBeNull();
  });
});

describe('softDeleteDeck', () => {
  it('sets deletedAt and subsequently 404s', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('softdel') }, user);
    await softDeleteDeck(deck.id);

    await expect(getDeckById(deck.id)).rejects.toBeInstanceOf(NotFoundError);
    // Re-deleting a deleted deck looks like a 404 to the caller.
    await expect(softDeleteDeck(deck.id)).rejects.toBeInstanceOf(NotFoundError);

    // Row still exists in the DB (just flagged) — verify directly.
    const raw = await prisma.deck.findUnique({ where: { id: deck.id } });
    expect(raw?.deletedAt).toBeInstanceOf(Date);
  });
});
