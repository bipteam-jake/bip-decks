// @mentions + inbox service (Phase 2.4, docs/bip-deck-platform-phasing.md
// §3 item 2). Mentions are parsed out of comment bodies and admin notes by
// email — emails are the only unique handle on User and they're already
// what teammates know each other by. A successful mention creates a
// CommentMention row that lights up the mentioned user's inbox.
//
// Design notes:
//  - Self-mentions are silently dropped. They're never useful and they'd
//    inflate the inbox unread counter for the author.
//  - Recipient (share-link) authors can mention team members too — the
//    syntax is the same, only the parser cares about content not identity.
//  - Sync is destructive: on every comment write we delete all existing
//    mention rows for that comment and re-insert the current set. This
//    keeps the inbox in sync with edits without per-edit diff logic and
//    matches the way the existing tool behaves.
//  - We re-parse adminNote on every updateCommentStatus call — that's how
//    a team member gets pinged when someone @s them in the moderation
//    thread, not just the user-visible body.

import { prisma } from '@/lib/prisma';

// Email-only mention syntax: `@email@host.tld`. The negative lookbehind
// rules out matching the local part of someone *else's* email already in
// the text ("contact alice@bip.com" must not mention "@bip.com"). Allowed
// local-part chars match RFC-5322's common subset; we don't try to handle
// quoted locals or comments.
const MENTION_REGEX = /(?<![\w.+-])@([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi;

/**
 * Extract the unique, lowercased set of email addresses mentioned across
 * the given source strings. Order preserved by first appearance.
 */
export function parseMentions(...sources: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    for (const m of src.matchAll(MENTION_REGEX)) {
      const email = m[1]!.toLowerCase();
      if (!seen.has(email)) {
        seen.add(email);
        out.push(email);
      }
    }
  }
  return out;
}

/**
 * Resolve mention emails to active (non-soft-deleted) team users. Unknown
 * emails are silently skipped — the comment still saves, just without a
 * mention row, which mirrors how Slack handles dead handles.
 */
export async function resolveMentionedUsers(
  emails: string[],
): Promise<{ id: string; email: string; name: string }[]> {
  if (emails.length === 0) return [];
  return prisma.user.findMany({
    where: {
      email: { in: emails, mode: 'insensitive' },
      deletedAt: null,
      kind: 'TEAM',
    },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Replace the mention rows on a comment with the current set parsed from
 * its body + adminNote. Run inside the caller's transaction when possible
 * so the comment write and mention sync commit together.
 *
 * `authorUserId` (if set) is excluded from the resolved set so self-
 * mentions don't generate inbox noise.
 */
export async function syncCommentMentions(args: {
  commentId: string;
  body: string | null;
  adminNote?: string | null;
  authorUserId?: string | null;
}): Promise<{ inserted: number; mentionedUserIds: string[] }> {
  const emails = parseMentions(args.body, args.adminNote);
  const users = await resolveMentionedUsers(emails);
  const toInsert = users.filter((u) => u.id !== args.authorUserId);

  // Destructive sync — delete-then-insert. Could be smarter with a diff,
  // but mention sets are tiny (<10 typical) and this keeps the readAt
  // semantic clean: editing a comment to add a new @ pings that person
  // fresh; removing one stops showing in their inbox.
  await prisma.$transaction(async (tx) => {
    await tx.commentMention.deleteMany({ where: { commentId: args.commentId } });
    if (toInsert.length > 0) {
      await tx.commentMention.createMany({
        data: toInsert.map((u) => ({
          commentId: args.commentId,
          mentionedUserId: u.id,
        })),
        skipDuplicates: true,
      });
    }
  });

  return {
    inserted: toInsert.length,
    mentionedUserIds: toInsert.map((u) => u.id),
  };
}

// ---------------------------------------------------------------------------
// Inbox queries
// ---------------------------------------------------------------------------

export interface InboxEntry {
  id: string;
  createdAt: Date;
  readAt: Date | null;
  comment: {
    id: string;
    body: string;
    slideId: string;
    status: string;
    authorDisplayName: string;
    createdAt: Date;
  };
  deck: {
    id: string;
    slug: string;
    title: string;
  };
}

/** List a user's inbox entries, newest first. */
export async function listInbox(args: {
  userId: string;
  onlyUnread?: boolean;
  limit?: number;
}): Promise<InboxEntry[]> {
  const rows = await prisma.commentMention.findMany({
    where: {
      mentionedUserId: args.userId,
      ...(args.onlyUnread ? { readAt: null } : {}),
      // Don't surface mentions on comments whose decks were soft-deleted.
      comment: { deck: { deletedAt: null } },
    },
    orderBy: { createdAt: 'desc' },
    take: args.limit ?? 100,
    include: {
      comment: {
        select: {
          id: true,
          body: true,
          slideId: true,
          status: true,
          authorDisplayName: true,
          createdAt: true,
          deck: { select: { id: true, slug: true, title: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    readAt: r.readAt,
    comment: {
      id: r.comment.id,
      body: r.comment.body,
      slideId: r.comment.slideId,
      status: r.comment.status,
      authorDisplayName: r.comment.authorDisplayName,
      createdAt: r.comment.createdAt,
    },
    deck: r.comment.deck,
  }));
}

/** Count of unread inbox entries for the nav badge. */
export async function countUnreadInbox(userId: string): Promise<number> {
  return prisma.commentMention.count({
    where: {
      mentionedUserId: userId,
      readAt: null,
      comment: { deck: { deletedAt: null } },
    },
  });
}

/** Mark a single mention as read. No-op if already read or not owned. */
export async function markInboxRead(args: {
  mentionId: string;
  userId: string;
}): Promise<boolean> {
  const res = await prisma.commentMention.updateMany({
    where: { id: args.mentionId, mentionedUserId: args.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count > 0;
}

/** Mark all of a user's unread mentions as read. Returns count updated. */
export async function markAllInboxRead(userId: string): Promise<number> {
  const res = await prisma.commentMention.updateMany({
    where: { mentionedUserId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// Mentionable users (for composer autocomplete)
// ---------------------------------------------------------------------------

/**
 * Suggest team users matching `query` (against name or email prefix). Used
 * by the comment composer's `@` autocomplete. Limited and cheap by design.
 */
export async function listMentionableUsers(args: {
  query?: string;
  limit?: number;
}): Promise<{ id: string; email: string; name: string }[]> {
  const q = args.query?.trim() ?? '';
  return prisma.user.findMany({
    where: {
      kind: 'TEAM',
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: { id: true, email: true, name: true },
    orderBy: { name: 'asc' },
    take: args.limit ?? 20,
  });
}
