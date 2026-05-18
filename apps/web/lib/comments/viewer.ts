// Resolves the identity of whoever is viewing the deck runtime — either a
// team `User` (admin/internal) or a `ShareLinkRecipient` (magic-link visitor).
// Comments and votes belong to one or the other (schema §3.5/§3.6 XOR).
//
// The recipient branch is deck-scoped: a recipient cookie is keyed per deck
// (one signed cookie per `bip_r_<deckId>`), so the resolver needs the
// deckId to know which cookie to read.

import { prisma } from '@/lib/prisma';
import { getSessionContext } from '@/lib/auth/middleware';
import { readRecipientCookie } from '@/lib/share-links/cookies';
import { loadActiveRecipientForDeck } from '@/lib/share-links/service';
import type { User, ShareLinkRecipient } from '@bip/db';

/**
 * Discriminated union: a comment author/voter is either a team user or a
 * share-link recipient. The runtime overlay and comment endpoints accept
 * either; the service layer enforces the XOR when persisting.
 */
export type CommentViewer =
  | { kind: 'team'; user: User; displayName: string }
  | { kind: 'recipient'; recipient: ShareLinkRecipient; displayName: string };

export interface GetCommentViewerOptions {
  /** Required to resolve a share-link recipient cookie. Team-only flows
   *  may omit it. */
  deckId?: string;
}

/**
 * Resolve the current viewer for the deck runtime. Returns null if the
 * caller is unauthenticated.
 *
 * Order: team session first (the common case in Phase 1 — admins authoring
 * their own decks), then per-deck recipient cookie when a deckId is given.
 */
export async function getCommentViewer(
  opts: GetCommentViewerOptions = {},
): Promise<CommentViewer | null> {
  const teamCtx = await getSessionContext();
  if (teamCtx) {
    return {
      kind: 'team',
      user: teamCtx.user,
      displayName: teamCtx.user.name,
    };
  }

  if (opts.deckId) {
    const recipientId = await readRecipientCookie(opts.deckId);
    if (recipientId) {
      const recipient = await loadActiveRecipientForDeck(recipientId, opts.deckId);
      if (recipient) {
        return {
          kind: 'recipient',
          recipient,
          displayName: recipient.displayName,
        };
      }
    }
  }

  return null;
}

/**
 * Convenience: pull just the bits the runtime overlay needs to render the
 * composer (no PII beyond the display name; the actor id is server-side).
 */
export function viewerForClient(viewer: CommentViewer): {
  kind: 'team' | 'recipient';
  displayName: string;
  /** Lets the client hide admin-only controls (status menu, admin notes). */
  canModerate: boolean;
} {
  return {
    kind: viewer.kind,
    displayName: viewer.displayName,
    canModerate: viewer.kind === 'team',
  };
}

/**
 * Internal: resolves the recipient row for a comment by id. Returns null
 * if not found. Kept thin — the prisma client is the source of truth.
 */
export async function loadRecipient(id: string): Promise<ShareLinkRecipient | null> {
  return prisma.shareLinkRecipient.findUnique({ where: { id } });
}
