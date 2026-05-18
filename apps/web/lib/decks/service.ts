// Deck CRUD service. Routes call into here; this module owns the rules.
//
// Phase 1 scope (per docs/bip-deck-platform-phasing.md §1):
//   "Deck CRUD: create from blank, name/rename, set lifecycle stage
//    (purely informational), archive"
// Plus soft-delete from data-model §3.3.
//
// What this module deliberately does NOT do:
//   - Hard delete (cron, Phase 1 follow-up)
//   - Edit-lock acquisition (AI editor concern)
//   - Bundling / view-time HTML assembly (next prompt)

import path from 'node:path';
import type { Deck, LifecycleStage, Prisma, User } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { initRepo, removeRepo } from '@/lib/git';
import { generateUniqueSlug } from '@/lib/decks/slug';
import { buildStarterFiles } from '@/lib/decks/scaffold';

export interface CreateDeckInput {
  title: string;
  /** Optional explicit slug. If omitted, derived from the title. */
  slug?: string;
}

export interface ListDecksOptions {
  /** Include archived decks (soft-deleted are always excluded). Default false. */
  includeArchived?: boolean;
  /** Limit/offset for pagination. Defaults: limit 50, offset 0. */
  limit?: number;
  offset?: number;
}

export interface UpdateDeckInput {
  title?: string;
  lifecycleStage?: LifecycleStage;
}

function deckRepoPath(slug: string): string {
  return path.join(env.deckReposPath, slug);
}

function assertNotDeleted(deck: Deck): void {
  if (deck.deletedAt) throw new NotFoundError('Deck not found', 'deck_not_found');
}

/**
 * Create a deck: pick a unique slug, init the git repo on disk with starter
 * files, persist the row. The git init and DB insert are not transactional
 * (one's a filesystem op, the other Postgres). On DB failure we roll back the
 * filesystem side; on FS failure we never reach the DB.
 */
export async function createDeck(input: CreateDeckInput, creator: User): Promise<Deck> {
  const title = input.title.trim();
  if (!title) throw new ValidationError('Title is required');

  const slug = input.slug?.trim() || (await generateUniqueSlug(title));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ValidationError(
      'Slug must be lowercase, hyphen-separated, no leading/trailing hyphens',
    );
  }

  // Re-check slug uniqueness in case the caller passed an explicit one.
  const collision = await prisma.deck.findUnique({ where: { slug }, select: { id: true } });
  if (collision) throw new ConflictError('Slug already in use', 'slug_taken');

  const repoPath = deckRepoPath(slug);
  const { files } = buildStarterFiles({ title });

  // 1. Filesystem first. If this throws, no DB row exists yet — nothing to clean up.
  const { commitSha } = await initRepo({
    absPath: repoPath,
    author: { name: creator.name, email: creator.email },
    initialCommitMessage: 'Initial deck scaffold',
    files,
  });

  // 2. DB insert. If this throws, undo the filesystem side so a retry can succeed.
  try {
    return await prisma.deck.create({
      data: {
        slug,
        title,
        repoPath,
        headCommitSha: commitSha,
        createdById: creator.id,
      },
    });
  } catch (err) {
    await removeRepo(repoPath).catch(() => undefined);
    throw err;
  }
}

/**
 * List decks. Excludes soft-deleted by default; excludes archived unless
 * `includeArchived` is true. Ordered by most-recently-updated.
 */
export async function listDecks(options: ListDecksOptions = {}): Promise<Deck[]> {
  const where: Prisma.DeckWhereInput = { deletedAt: null };
  if (!options.includeArchived) where.archivedAt = null;
  return prisma.deck.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: Math.min(options.limit ?? 50, 200),
    skip: options.offset ?? 0,
  });
}

/** Fetch by id, treating soft-deleted as 404. */
export async function getDeckById(id: string): Promise<Deck> {
  const deck = await prisma.deck.findUnique({ where: { id } });
  if (!deck) throw new NotFoundError('Deck not found', 'deck_not_found');
  assertNotDeleted(deck);
  return deck;
}

/** Fetch by slug, treating soft-deleted as 404. */
export async function getDeckBySlug(slug: string): Promise<Deck> {
  const deck = await prisma.deck.findUnique({ where: { slug } });
  if (!deck) throw new NotFoundError('Deck not found', 'deck_not_found');
  assertNotDeleted(deck);
  return deck;
}

/**
 * Rename and/or set lifecycle stage. Slug is intentionally NOT changed on
 * rename — share-link URLs would break. (A "change slug" op can be added
 * later if needed.)
 */
export async function updateDeck(id: string, input: UpdateDeckInput): Promise<Deck> {
  const existing = await getDeckById(id);

  const data: Prisma.DeckUpdateInput = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ValidationError('Title cannot be empty');
    data.title = title;
  }
  if (input.lifecycleStage !== undefined) {
    data.lifecycleStage = input.lifecycleStage;
  }

  if (Object.keys(data).length === 0) return existing;

  return prisma.deck.update({ where: { id }, data });
}

/** Set archivedAt to now. No-op if already archived. */
export async function archiveDeck(id: string): Promise<Deck> {
  const deck = await getDeckById(id);
  if (deck.archivedAt) return deck;
  return prisma.deck.update({ where: { id }, data: { archivedAt: new Date() } });
}

/** Clear archivedAt. No-op if not archived. */
export async function unarchiveDeck(id: string): Promise<Deck> {
  const deck = await getDeckById(id);
  if (!deck.archivedAt) return deck;
  return prisma.deck.update({ where: { id }, data: { archivedAt: null } });
}

/**
 * Soft-delete. Per data-model §3.3, the on-disk git repo is preserved; a
 * separate cron hard-deletes records older than 30 days and removes the repo
 * at that point. Re-deleting a deleted deck is treated as "not found" so
 * callers don't observe deleted state.
 */
export async function softDeleteDeck(id: string): Promise<void> {
  const deck = await getDeckById(id); // throws 404 if already deleted
  await prisma.deck.update({
    where: { id: deck.id },
    data: { deletedAt: new Date() },
  });
}
