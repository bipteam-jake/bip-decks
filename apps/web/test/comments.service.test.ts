// Comments service tests. Hits real Postgres; uses tagged emails / slug
// prefixes for cleanup so this can run alongside other test files.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TMP_REPOS = mkdtempSync(path.join(tmpdir(), 'bip-comments-test-'));
process.env.DECK_REPOS_PATH = TMP_REPOS;

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import { createDeck } from '@/lib/decks/service';
import {
  createComment,
  listComments,
  updateCommentStatus,
  voteComment,
} from '@/lib/comments/service';
import type { CommentViewer } from '@/lib/comments/viewer';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { Deck, User } from '@bip/db';

const TEST_TAG = '+commentvitest@bip.test';
const TEST_SLUG_PREFIX = 'cvt-';
const SLIDE_A = 'slide-a';
const SLIDE_B = 'slide-b';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}
function uniqueTitle(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'author'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `Comment Test ${label}`,
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
  // Votes + comments cascade via deck deletion; deck deletion cascades from
  // user only if the user is hard-deleted (they are not — soft delete only).
  // Wipe in dependency order.
  await prisma.vote.deleteMany({
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

describe('createComment', () => {
  it('persists a team-authored comment with XOR fields set', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'Looks good',
      viewer: teamViewer(user),
    });
    expect(c.authorUserId).toBe(user.id);
    expect(c.authorRecipientId).toBeNull();
    expect(c.authorDisplayName).toBe(user.name);
    expect(c.status).toBe('OPEN');
  });

  it('rejects empty body', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    await expect(
      createComment({ deckId: deck.id, slideId: SLIDE_A, body: '   ', viewer: teamViewer(user) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects reply on a different slide than parent', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const parent = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'parent',
      viewer: teamViewer(user),
    });
    await expect(
      createComment({
        deckId: deck.id,
        slideId: SLIDE_B,
        body: 'reply',
        parentId: parent.id,
        viewer: teamViewer(user),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when deck does not exist', async () => {
    const user = await makeUser();
    await expect(
      createComment({
        deckId: '00000000-0000-0000-0000-000000000000',
        slideId: SLIDE_A,
        body: 'orphan',
        viewer: teamViewer(user),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listComments', () => {
  it('builds a tree of top-level + replies with vote tallies', async () => {
    const author = await makeUser('a');
    const voter = await makeUser('b');
    const deck = await makeDeck(author);
    const top = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'top',
      viewer: teamViewer(author),
    });
    const reply = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'reply',
      parentId: top.id,
      viewer: teamViewer(voter),
    });
    await voteComment({ commentId: top.id, direction: 1, viewer: teamViewer(voter) });
    await voteComment({ commentId: top.id, direction: 1, viewer: teamViewer(author) });

    const tree = await listComments({
      deckId: deck.id,
      slideId: SLIDE_A,
      viewer: teamViewer(voter),
    });
    expect(tree).toHaveLength(1);
    expect(tree[0]!.comment.id).toBe(top.id);
    expect(tree[0]!.replies).toHaveLength(1);
    expect(tree[0]!.replies[0]!.comment.id).toBe(reply.id);
    expect(tree[0]!.votes.score).toBe(2);
    expect(tree[0]!.votes.count).toBe(2);
    expect(tree[0]!.votes.viewerDirection).toBe(1);
  });

  it('filters by slideId', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'a',
      viewer: teamViewer(user),
    });
    await createComment({
      deckId: deck.id,
      slideId: SLIDE_B,
      body: 'b',
      viewer: teamViewer(user),
    });
    const a = await listComments({ deckId: deck.id, slideId: SLIDE_A, viewer: teamViewer(user) });
    const b = await listComments({ deckId: deck.id, slideId: SLIDE_B, viewer: teamViewer(user) });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.comment.slideId).toBe(SLIDE_A);
    expect(b[0]!.comment.slideId).toBe(SLIDE_B);
  });
});

describe('voteComment', () => {
  it('is idempotent: same direction twice produces one vote', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'x',
      viewer: teamViewer(user),
    });
    await voteComment({ commentId: c.id, direction: 1, viewer: teamViewer(user) });
    const r2 = await voteComment({ commentId: c.id, direction: 1, viewer: teamViewer(user) });
    expect(r2.summary.score).toBe(1);
    expect(r2.summary.count).toBe(1);
  });

  it('flips from upvote to downvote without leaving a duplicate', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'x',
      viewer: teamViewer(user),
    });
    await voteComment({ commentId: c.id, direction: 1, viewer: teamViewer(user) });
    const flipped = await voteComment({ commentId: c.id, direction: -1, viewer: teamViewer(user) });
    expect(flipped.summary.score).toBe(-1);
    expect(flipped.summary.count).toBe(1);
    expect(flipped.summary.viewerDirection).toBe(-1);
  });

  it('direction=0 clears the viewer\u2019s vote', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'x',
      viewer: teamViewer(user),
    });
    await voteComment({ commentId: c.id, direction: 1, viewer: teamViewer(user) });
    const cleared = await voteComment({ commentId: c.id, direction: 0, viewer: teamViewer(user) });
    expect(cleared.vote).toBeNull();
    expect(cleared.summary.score).toBe(0);
    expect(cleared.summary.count).toBe(0);
  });
});

describe('updateCommentStatus', () => {
  it('updates status for team viewers', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'x',
      viewer: teamViewer(user),
    });
    const updated = await updateCommentStatus({
      commentId: c.id,
      status: 'PLANNED',
      viewer: teamViewer(user),
    });
    expect(updated.status).toBe('PLANNED');
  });

  it('rejects recipient-kind viewers with ForbiddenError', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const c = await createComment({
      deckId: deck.id,
      slideId: SLIDE_A,
      body: 'x',
      viewer: teamViewer(user),
    });
    // Fabricate a recipient-kind viewer without a real recipient row; status
    // update should reject before any DB read.
    const fakeRecipient: CommentViewer = {
      kind: 'recipient',
      recipient: { id: 'fake' } as never,
      displayName: 'External',
    };
    await expect(
      updateCommentStatus({ commentId: c.id, status: 'DONE', viewer: fakeRecipient }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
