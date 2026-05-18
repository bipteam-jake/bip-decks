// Resolves the identity of whoever is viewing the deck runtime — either a
// team `User` (admin/internal) or a `ShareLinkRecipient` (magic-link visitor).
// Comments and votes belong to one or the other (schema §3.5/§3.6 XOR).
//
// Phase 1 only wires the team path here. The share-link redemption flow that
// produces a ShareLinkRecipient cookie is not built yet (phasing doc §1
// "One sharing flow: magic-link invite…" — separate session). When that
// lands, this is the single place to add the recipient branch.

import { prisma } from '@/lib/prisma';
import { getSessionContext } from '@/lib/auth/middleware';
import type { User, ShareLinkRecipient } from '@bip/db';

/**
 * Discriminated union: a comment author/voter is either a team user or a
 * share-link recipient. The runtime overlay and comment endpoints accept
 * either; the service layer enforces the XOR when persisting.
 */
export type CommentViewer =
  | { kind: 'team'; user: User; displayName: string }
  | { kind: 'recipient'; recipient: ShareLinkRecipient; displayName: string };

/**
 * Resolve the current viewer for the deck runtime. Returns null if the caller
 * is unauthenticated (no team session, no recipient cookie).
 *
 * Order: team session first (admins authoring their own decks are the
 * common case in Phase 1), then recipient cookie.
 */
export async function getCommentViewer(): Promise<CommentViewer | null> {
  const teamCtx = await getSessionContext();
  if (teamCtx) {
    return {
      kind: 'team',
      user: teamCtx.user,
      displayName: teamCtx.user.name,
    };
  }

  // TODO(phase 1, share-link session): once the magic-link redemption flow
  // ships, read the recipient cookie here, validate the signed token, and
  // load the ShareLinkRecipient row. Until then, no recipient identity
  // exists yet.
  // See docs/bip-deck-platform-architecture.md §8 (Reviewer link type).
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
 * Internal: resolves the recipient row for a comment by id. Used by the
 * service for vote attribution. Returns null for team-authored votes.
 * Kept thin — the prisma client is the source of truth.
 */
export async function loadRecipient(id: string): Promise<ShareLinkRecipient | null> {
  return prisma.shareLinkRecipient.findUnique({ where: { id } });
}
