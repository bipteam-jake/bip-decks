// Mentions + inbox service tests. Real Postgres; tagged emails / slug
// prefixes for cleanup.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TMP_REPOS = mkdtempSync(path.join(tmpdir(), 'bip-mentions-test-'));
process.env.DECK_REPOS_PATH = TMP_REPOS;

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import { createDeck } from '@/lib/decks/service';
import { createComment, updateCommentStatus } from '@/lib/comments/service';
import {
  countUnreadInbox,
  listInbox,
  listMentionableUsers,
  markAllInboxRead,
  markInboxRead,
  parseMentions,
} from '@/lib/comments/mentions-service';
import type { CommentViewer } from '@/lib/comments/viewer';
import type { Deck, User } from '@bip/db';

const TEST_TAG = '+mentionvitest@bip.test';
const TEST_SLUG_PREFIX = 'mvt-';
const SLIDE_A = 'slide-a';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}
function uniqueTitle(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
async function makeUser(label = 'user'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `Mention Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}
function teamViewer(user: User): CommentViewer {
  return { kind: 'team', user, displayName: user.name };
}
async function makeDeck(creator: User): Promise<Deck> {
  return createDeck({ title: uniqueTitle('deck') }, creator);
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
});

afterEach(async () => {
  // CommentMention cascades from comment; comment from deck. Wipe in
  // dependency order including the soft-delete-immune users table.
  await prisma.commentMention.deleteMany({
    where: { comment: { deck: { slug: { startsWith: TEST_SLUG_PREFIX } } } },
  });
  await prisma.comment.deleteMany({
    where: { deck: { slug: { startsWith: TEST_SLUG_PREFIX } } },
  });
  await prisma.deck.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

afterAll(() => {
  rmSync(TMP_REPOS, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('parseMentions', () => {
  it('extracts a single mention by email', () => {
    expect(parseMentions('hey @alice@bip.com take a look')).toEqual(['alice@bip.com']);
  });
  it('extracts multiple unique mentions in order', () => {
    expect(
      parseMentions('cc @bob@bip.com and @alice@bip.com and again @bob@bip.com'),
    ).toEqual(['bob@bip.com', 'alice@bip.com']);
  });
  it('lowercases mentions', () => {
    expect(parseMentions('ping @Alice@BIP.com')).toEqual(['alice@bip.com']);
  });
  it('does not mistake an email inline for a mention', () => {
    expect(parseMentions('contact alice@bip.com directly')).toEqual([]);
  });
  it('parses across multiple source strings', () => {
    expect(parseMentions('body @a@x.io', null, 'note @b@x.io')).toEqual([
      'a@x.io',
      'b@x.io',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('createComment with mentions', () => {
  it('creates a CommentMention row for each known mentioned user', async () => {
    const author = await makeUser('author');
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const deck = await makeDeck(author);

    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: `please review @${alice.email} and @${bob.email}`,
      viewer: teamViewer(author),
    });

    const rows = await prisma.commentMention.findMany({
      where: { commentId: c.id },
      select: { mentionedUserId: true },
    });
    const ids = rows.map((r) => r.mentionedUserId).sort();
    expect(ids).toEqual([alice.id, bob.id].sort());
  });

  it('ignores self-mentions', async () => {
    const author = await makeUser('selfauthor');
    const deck = await makeDeck(author);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: `note to self @${author.email}`,
      viewer: teamViewer(author),
    });
    const count = await prisma.commentMention.count({ where: { commentId: c.id } });
    expect(count).toBe(0);
  });

  it('silently skips unknown emails', async () => {
    const author = await makeUser('author2');
    const deck = await makeDeck(author);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'hey @ghost@nowhere.example what about this',
      viewer: teamViewer(author),
    });
    const count = await prisma.commentMention.count({ where: { commentId: c.id } });
    expect(count).toBe(0);
  });
});

describe('updateCommentStatus mentions', () => {
  it('parses mentions out of the admin note', async () => {
    const author = await makeUser('author3');
    const carol = await makeUser('carol');
    const deck = await makeDeck(author);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'no mentions here',
      viewer: teamViewer(author),
    });
    // Pre-condition: no mention rows.
    expect(await prisma.commentMention.count({ where: { commentId: c.id } })).toBe(0);

    await updateCommentStatus({
      commentId: c.id,
      adminNote: `@${carol.email} please follow up`,
      viewer: teamViewer(author),
    });
    const rows = await prisma.commentMention.findMany({
      where: { commentId: c.id },
      select: { mentionedUserId: true },
    });
    expect(rows.map((r) => r.mentionedUserId)).toEqual([carol.id]);
  });
});

// ---------------------------------------------------------------------------

describe('inbox listing + mark-read', () => {
  it('lists newest first and counts unread correctly', async () => {
    const author = await makeUser('author4');
    const target = await makeUser('target');
    const deck = await makeDeck(author);

    await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: `first @${target.email}`,
      viewer: teamViewer(author),
    });
    await new Promise((r) => setTimeout(r, 10));
    await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: `second @${target.email}`,
      viewer: teamViewer(author),
    });

    const inbox = await listInbox({ userId: target.id });
    expect(inbox.length).toBe(2);
    expect(inbox[0]!.comment.body).toBe(`second @${target.email}`);
    expect(await countUnreadInbox(target.id)).toBe(2);
  });

  it('markInboxRead is idempotent and ownership-checked', async () => {
    const author = await makeUser('author5');
    const target = await makeUser('target2');
    const intruder = await makeUser('intruder');
    const deck = await makeDeck(author);

    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: `hi @${target.email}`,
      viewer: teamViewer(author),
    });
    const mention = await prisma.commentMention.findFirstOrThrow({
      where: { commentId: c.id, mentionedUserId: target.id },
    });

    // Intruder can't mark it.
    expect(
      await markInboxRead({ mentionId: mention.id, userId: intruder.id }),
    ).toBe(false);
    expect(await countUnreadInbox(target.id)).toBe(1);

    // Owner can.
    expect(
      await markInboxRead({ mentionId: mention.id, userId: target.id }),
    ).toBe(true);
    expect(await countUnreadInbox(target.id)).toBe(0);

    // Idempotent second call returns false (no rows updated).
    expect(
      await markInboxRead({ mentionId: mention.id, userId: target.id }),
    ).toBe(false);
  });

  it('markAllInboxRead clears every unread row for the user', async () => {
    const author = await makeUser('author6');
    const target = await makeUser('target3');
    const deck = await makeDeck(author);
    for (let i = 0; i < 3; i++) {
      await createComment({
        deckId: deck.id,
        slideId: SLIDE_A,
        body: `n${i} @${target.email}`,
        viewer: teamViewer(author),
      });
    }
    expect(await countUnreadInbox(target.id)).toBe(3);
    const updated = await markAllInboxRead(target.id);
    expect(updated).toBe(3);
    expect(await countUnreadInbox(target.id)).toBe(0);
  });

  it('hides mentions whose deck is soft-deleted', async () => {
    const author = await makeUser('author7');
    const target = await makeUser('target4');
    const deck = await makeDeck(author);
    await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: `hey @${target.email}`,
      viewer: teamViewer(author),
    });
    expect(await countUnreadInbox(target.id)).toBe(1);
    await prisma.deck.update({
      where: { id: deck.id },
      data: { deletedAt: new Date() },
    });
    expect(await countUnreadInbox(target.id)).toBe(0);
    expect(await listInbox({ userId: target.id })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('listMentionableUsers', () => {
  it('filters by name or email substring', async () => {
    const a = await makeUser('searchable');
    await makeUser('other');
    const results = await listMentionableUsers({ query: 'searchable' });
    expect(results.some((u) => u.id === a.id)).toBe(true);
  });
});
