// Slide-level comments service.
//
// Phase 1: per docs/bip-deck-platform-architecture.md §11 and §3 of
// docs/bip-deck-platform-data-model.md. Element-level anchoring (the
// `elementAnchor` column) is intentionally ignored here; it lands in
// Phase 2 (phasing doc §2).
//
// Identity model. Every comment and vote belongs to either a team `User` or
// a `ShareLinkRecipient` (magic-link visitor). Schema-level XOR is enforced
// by the `comment_exactly_one_author` / `vote_exactly_one_voter` CHECK
// constraints; this layer enforces it before hitting the DB so we surface a
// proper ValidationError instead of a 500.

import { prisma } from '@/lib/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { CommentViewer } from '@/lib/comments/viewer';
import type { Comment, CommentStatus, Vote } from '@bip/db';

// ---------------------------------------------------------------------------
// Types returned to the client
// ---------------------------------------------------------------------------

export interface VoteSummary {
  /** Sum of all vote directions on this comment. */
  score: number;
  /** Total votes cast (|+1| + |-1|), useful for "N votes" displays. */
  count: number;
  /** The current viewer's vote direction, or 0 if none. */
  viewerDirection: -1 | 0 | 1;
}

export interface CommentNode {
  comment: Comment;
  replies: CommentNode[];
  votes: VoteSummary;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List comments for a deck, optionally narrowed to one slide. Returns a
 * tree of top-level comments with their replies (one level deep is enough
 * for the existing tool's UX; deeper nesting can be added later by walking
 * `parentId` recursively).
 *
 * Ordering: top-level by `createdAt` ascending (oldest first — matches the
 * existing tool); replies same.
 *
 * Vote summaries are computed per comment with a single GROUP BY query so
 * a thread of N comments takes 1 list query + 1 vote query, not N+1.
 */
export async function listComments(input: {
  deckId: string;
  slideId?: string;
  viewer: CommentViewer | null;
}): Promise<CommentNode[]> {
  const { deckId, slideId, viewer } = input;

  const where = slideId ? { deckId, slideId } : { deckId };
  const rows = await prisma.comment.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });

  if (rows.length === 0) return [];

  // Aggregate votes for all comments in one round trip.
  const ids = rows.map((r) => r.id);
  const voteRows = await prisma.vote.findMany({
    where: { commentId: { in: ids } },
    select: { commentId: true, direction: true, userId: true, recipientId: true },
  });

  const summaryByCommentId = new Map<string, VoteSummary>();
  for (const id of ids) {
    summaryByCommentId.set(id, { score: 0, count: 0, viewerDirection: 0 });
  }
  for (const v of voteRows) {
    const s = summaryByCommentId.get(v.commentId)!;
    s.score += v.direction;
    s.count += 1;
    if (viewer) {
      const isViewer =
        viewer.kind === 'team'
          ? v.userId === viewer.user.id
          : v.recipientId === viewer.recipient.id;
      if (isViewer) s.viewerDirection = v.direction === 1 ? 1 : -1;
    }
  }

  // Two-pass tree build. Parent must precede children in a sorted-by-createdAt
  // list, but we don't rely on that — bucket by parentId explicitly.
  const byId = new Map<string, CommentNode>();
  for (const c of rows) {
    byId.set(c.id, { comment: c, replies: [], votes: summaryByCommentId.get(c.id)! });
  }
  const roots: CommentNode[] = [];
  for (const c of rows) {
    const node = byId.get(c.id)!;
    if (c.parentId) {
      const parent = byId.get(c.parentId);
      if (parent) parent.replies.push(node);
      else roots.push(node); // Orphaned: parent on different slide filter — surface anyway.
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Write — comments
// ---------------------------------------------------------------------------

export interface CreateCommentInput {
  deckId: string;
  slideId: string;
  body: string;
  /** Optional: when set, this comment is a reply to that comment. */
  parentId?: string;
  viewer: CommentViewer;
}

/**
 * Create a top-level comment or a reply. Validates:
 *  - body is non-empty (after trim).
 *  - deck exists and isn't soft-deleted.
 *  - parent (if set) belongs to the same deck AND the same slideId
 *    (the existing tool's invariant; not a DB constraint, app-enforced
 *    per data-model.md §3.5 notes).
 */
export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const body = input.body.trim();
  if (!body) throw new ValidationError('Comment body is required');
  if (body.length > 5000) throw new ValidationError('Comment body too long (max 5000 chars)');
  if (!input.slideId) throw new ValidationError('slideId is required');

  const deck = await prisma.deck.findFirst({
    where: { id: input.deckId, deletedAt: null },
    select: { id: true },
  });
  if (!deck) throw new NotFoundError('Deck not found');

  if (input.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: input.parentId },
      select: { deckId: true, slideId: true },
    });
    if (!parent) throw new NotFoundError('Parent comment not found');
    if (parent.deckId !== input.deckId) {
      throw new ValidationError('Parent comment belongs to a different deck');
    }
    if (parent.slideId !== input.slideId) {
      throw new ValidationError('Reply must be on the same slide as its parent');
    }
  }

  const authorFields =
    input.viewer.kind === 'team'
      ? { authorUserId: input.viewer.user.id, authorRecipientId: null }
      : { authorUserId: null, authorRecipientId: input.viewer.recipient.id };

  return prisma.comment.create({
    data: {
      deckId: input.deckId,
      slideId: input.slideId,
      body,
      parentId: input.parentId ?? null,
      authorDisplayName: input.viewer.displayName,
      ...authorFields,
    },
  });
}

// ---------------------------------------------------------------------------
// Status / admin note
// ---------------------------------------------------------------------------

export interface UpdateStatusInput {
  commentId: string;
  /** Omit to leave the status unchanged. */
  status?: CommentStatus;
  /** `undefined` = no change; `null` = clear; string = set. */
  adminNote?: string | null;
  viewer: CommentViewer;
}

/**
 * Set the moderation status (and optionally the admin-only note) of a
 * comment. Team-only — recipients can't move tickets along. Per
 * architecture §11: `open → in_review → planned → done → dismissed`.
 *
 * The schema doesn't enforce transition order (intentional, per arch §4
 * "Transitions are not enforced"). Any status → any status is allowed.
 */
export async function updateCommentStatus(input: UpdateStatusInput): Promise<Comment> {
  if (input.viewer.kind !== 'team') {
    throw new ForbiddenError('Only team users can change comment status');
  }
  if (input.status === undefined && input.adminNote === undefined) {
    throw new ValidationError('Provide status and/or adminNote');
  }
  const existing = await prisma.comment.findUnique({
    where: { id: input.commentId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Comment not found');

  return prisma.comment.update({
    where: { id: input.commentId },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      // Distinguish "leave note as-is" (undefined) from "clear it" (null).
      ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export interface VoteInput {
  commentId: string;
  /** +1 upvote, -1 downvote, 0 = clear the viewer's vote. */
  direction: -1 | 0 | 1;
  viewer: CommentViewer;
}

export interface VoteResult {
  /** The viewer's resulting vote row, or null if cleared. */
  vote: Vote | null;
  /** Refreshed tally so the client can update without re-listing. */
  summary: VoteSummary;
}

/**
 * Idempotent vote upsert. Same viewer voting again with the same direction
 * is a no-op; with the opposite direction it flips; with 0 it deletes.
 *
 * Concurrency: two simultaneous upserts from the same viewer would race on
 * the partial unique index. We use upsert per the (commentId, userId|recipientId)
 * unique constraint so Postgres handles the race.
 */
export async function voteComment(input: VoteInput): Promise<VoteResult> {
  if (input.direction !== -1 && input.direction !== 0 && input.direction !== 1) {
    throw new ValidationError('direction must be -1, 0, or 1');
  }
  const comment = await prisma.comment.findUnique({
    where: { id: input.commentId },
    select: { id: true },
  });
  if (!comment) throw new NotFoundError('Comment not found');

  const isTeam = input.viewer.kind === 'team';
  const voterId = input.viewer.kind === 'team' ? input.viewer.user.id : input.viewer.recipient.id;

  let vote: Vote | null;
  if (input.direction === 0) {
    // Clear. deleteMany so missing row is a no-op (no P2025 error).
    await prisma.vote.deleteMany({
      where: {
        commentId: input.commentId,
        ...(isTeam ? { userId: voterId } : { recipientId: voterId }),
      },
    });
    vote = null;
  } else if (isTeam) {
    vote = await prisma.vote.upsert({
      where: { commentId_userId: { commentId: input.commentId, userId: voterId } },
      create: {
        commentId: input.commentId,
        userId: voterId,
        recipientId: null,
        direction: input.direction,
      },
      update: { direction: input.direction },
    });
  } else {
    vote = await prisma.vote.upsert({
      where: { commentId_recipientId: { commentId: input.commentId, recipientId: voterId } },
      create: {
        commentId: input.commentId,
        userId: null,
        recipientId: voterId,
        direction: input.direction,
      },
      update: { direction: input.direction },
    });
  }

  // Recompute summary for the response.
  const all = await prisma.vote.findMany({
    where: { commentId: input.commentId },
    select: { direction: true, userId: true, recipientId: true },
  });
  let score = 0;
  let count = 0;
  let viewerDirection: -1 | 0 | 1 = 0;
  for (const v of all) {
    score += v.direction;
    count += 1;
    const isViewer = isTeam ? v.userId === voterId : v.recipientId === voterId;
    if (isViewer) viewerDirection = v.direction === 1 ? 1 : -1;
  }
  return { vote, summary: { score, count, viewerDirection } };
}
