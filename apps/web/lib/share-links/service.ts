// Share-link service: issuance, revocation, lookup, claim.
//
// Phase 1 scope per docs/bip-deck-platform-architecture.md §8 and
// docs/bip-deck-platform-phasing.md §1 ("One sharing flow: magic-link
// invite that lets a recipient view the deck and comment. No portal for
// recipients yet"). Only AudienceType.REVIEWER is emitted; only
// VersionBinding.LIVE is supported (snapshots/roll-forward land in Phase 3).
//
// The link's URL embeds the random token; the deck runtime resolves the
// token to a ShareLink row, walks back to the deck, and (if the visitor
// hasn't claimed yet) redirects them to the claim page to register a
// display name.

import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email';
import { generateShareLinkToken } from '@/lib/share-links/tokens';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import type { Deck, ShareLink, ShareLinkRecipient, User } from '@bip/db';

const DEFAULT_EXPIRY_DAYS = 30;

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface IssueShareLinkInput {
  deckId: string;
  recipientEmail: string;
  /** Optional personal note prepended to the email body. */
  message?: string;
  /** Optional override; defaults to 30 days from now. Null = never expires. */
  expiresAt?: Date | null;
  /** Block PDF print/right-click save when the deck loads. */
  downloadsDisabled?: boolean;
  createdBy: User;
}

export interface IssuedShareLink {
  shareLink: ShareLink;
  /** Fully-qualified URL the recipient clicks. */
  url: string;
}

/**
 * Create a new REVIEWER share link and email the magic-link URL. Always
 * LIVE-bound (snapshot binding is Phase 3). Email failure does NOT roll
 * back the link insert — the issuer can re-send from the admin UI.
 */
export async function issueShareLink(input: IssueShareLinkInput): Promise<IssuedShareLink> {
  const email = input.recipientEmail.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new ValidationError('recipientEmail is required');
  }

  const deck = await prisma.deck.findFirst({
    where: { id: input.deckId, deletedAt: null },
    select: { id: true, slug: true, title: true },
  });
  if (!deck) throw new NotFoundError('Deck not found');

  const expiresAt =
    input.expiresAt === null
      ? null
      : input.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const token = generateShareLinkToken();
  const shareLink = await prisma.shareLink.create({
    data: {
      deckId: deck.id,
      token,
      audienceType: 'REVIEWER',
      versionBinding: 'LIVE',
      boundCommitSha: null,
      createdById: input.createdBy.id,
      expiresAt,
      downloadsDisabled: input.downloadsDisabled ?? false,
    },
  });

  const url = buildShareLinkUrl(deck.slug, token);

  // Best-effort email; we don't roll back the link if delivery fails since
  // the admin can re-send. Service errors propagate so the API surfaces them.
  await sendInvitationEmail({
    to: email,
    deckTitle: deck.title,
    inviterName: input.createdBy.name,
    note: input.message,
    url,
    expiresAt,
  });

  return { shareLink, url };
}

function buildShareLinkUrl(slug: string, token: string): string {
  // The token rides in the path-qualified URL so it's the first thing the
  // deck runtime sees. Architecture §8 just calls it a "share-link URL";
  // we picked `/d/{slug}?st={token}` because the runtime already lives at
  // `/d/{slug}` and `st` (share-token) is short. The claim flow strips `st`
  // and replaces it with a cookie.
  const base = env.appBaseUrl.replace(/\/$/, '');
  return `${base}/d/${encodeURIComponent(slug)}?st=${encodeURIComponent(token)}`;
}

async function sendInvitationEmail(opts: {
  to: string;
  deckTitle: string;
  inviterName: string;
  note?: string;
  url: string;
  expiresAt: Date | null;
}): Promise<void> {
  const expiry = opts.expiresAt
    ? `This link expires on ${opts.expiresAt.toUTCString()}.`
    : 'This link does not expire.';
  const noteBlock = opts.note ? `\n\n"${opts.note}"\n\n— ${opts.inviterName}\n` : '';
  const text = [
    `${opts.inviterName} has shared a deck with you on the BIP Deck Platform.`,
    '',
    `Deck: ${opts.deckTitle}`,
    noteBlock,
    `Open the deck: ${opts.url}`,
    '',
    expiry,
  ]
    .filter(Boolean)
    .join('\n');
  await sendEmail({
    to: opts.to,
    subject: `${opts.inviterName} shared a deck with you: ${opts.deckTitle}`,
    text,
  });
}

// ---------------------------------------------------------------------------
// List + revoke
// ---------------------------------------------------------------------------

export async function listShareLinksForDeck(deckId: string): Promise<ShareLink[]> {
  return prisma.shareLink.findMany({
    where: { deckId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeShareLink(shareLinkId: string): Promise<ShareLink> {
  const existing = await prisma.shareLink.findUnique({ where: { id: shareLinkId } });
  if (!existing) throw new NotFoundError('Share link not found');
  if (existing.revokedAt) return existing; // Idempotent.
  return prisma.shareLink.update({
    where: { id: shareLinkId },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export interface ResolvedShareLink {
  shareLink: ShareLink;
  deck: Deck;
}

/**
 * Look up a share link by its opaque token and verify it's still active
 * (not revoked, not expired). Returns null if missing or inactive.
 *
 * Side effect: bumps `lastUsedAt` on a successful resolve so the admin UI
 * can show "last opened 3 days ago".
 */
export async function resolveActiveShareLink(token: string): Promise<ResolvedShareLink | null> {
  if (!token) return null;
  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    include: { deck: true },
  });
  if (!shareLink) return null;
  if (shareLink.revokedAt) return null;
  if (shareLink.expiresAt && shareLink.expiresAt.getTime() <= Date.now()) return null;
  if (shareLink.deck.deletedAt) return null;
  // Fire-and-forget timestamp bump; ignore failure (write-only metric).
  prisma.shareLink
    .update({ where: { id: shareLink.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return { shareLink, deck: shareLink.deck };
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

const claimSchema = z.object({
  token: z.string().min(20),
  displayName: z.string().trim().min(1).max(120),
  /** Stable UUID generated by the browser so revisits resolve to the same
   *  recipient. If omitted, the server mints one. */
  clientId: z.string().uuid().optional(),
  /** Optional self-supplied email. Phase 1 leaves it nullable; we may know
   *  the invited email from the link issuer side but not from the visitor. */
  email: z.string().email().optional(),
});

export interface ClaimResult {
  recipient: ShareLinkRecipient;
  deck: Deck;
  shareLink: ShareLink;
}

/**
 * "Claim" a share link: resolve the token, find-or-create a
 * ShareLinkRecipient keyed by (clientId), bump visit counters.
 *
 * Idempotent on (shareLinkId, clientId). A revisit with the same clientId
 * updates lastVisitedAt and increments visitCount; a fresh clientId creates
 * a new recipient row.
 */
export async function claimShareLink(input: unknown): Promise<ClaimResult> {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Invalid claim payload', parsed.error.flatten());
  const { token, displayName, email } = parsed.data;
  const clientId = parsed.data.clientId ?? crypto.randomUUID();

  const resolved = await resolveActiveShareLink(token);
  if (!resolved) throw new ForbiddenError('Share link is invalid, revoked, or expired');

  // Find by clientId. clientId is globally unique, so two share links on
  // the same browser get distinct clientIds (issued separately on first
  // claim of each link).
  const existing = await prisma.shareLinkRecipient.findUnique({ where: { clientId } });
  let recipient: ShareLinkRecipient;
  if (existing) {
    if (existing.shareLinkId !== resolved.shareLink.id) {
      // Two different share links can't reuse one clientId without
      // confusing the cookie/identity model. Surface a conflict so the
      // client can mint a new id.
      throw new ConflictError(
        'clientId already bound to a different share link',
        'client_id_collision',
      );
    }
    recipient = await prisma.shareLinkRecipient.update({
      where: { id: existing.id },
      data: {
        displayName,
        ...(email !== undefined ? { email } : {}),
        lastVisitedAt: new Date(),
        visitCount: { increment: 1 },
      },
    });
  } else {
    recipient = await prisma.shareLinkRecipient.create({
      data: {
        shareLinkId: resolved.shareLink.id,
        clientId,
        displayName,
        email: email ?? null,
      },
    });
  }

  return { recipient, deck: resolved.deck, shareLink: resolved.shareLink };
}

// ---------------------------------------------------------------------------
// Recipient lookup (used by viewer.ts to hydrate the cookie identity).
// ---------------------------------------------------------------------------

/**
 * Load the recipient, but only if their share link is still active *and*
 * its deck matches `deckId`. Centralizes the "is this cookie still valid?"
 * check.
 */
export async function loadActiveRecipientForDeck(
  recipientId: string,
  deckId: string,
): Promise<ShareLinkRecipient | null> {
  const recipient = await prisma.shareLinkRecipient.findUnique({
    where: { id: recipientId },
    include: { shareLink: true },
  });
  if (!recipient) return null;
  if (recipient.shareLink.deckId !== deckId) return null;
  if (recipient.shareLink.revokedAt) return null;
  if (
    recipient.shareLink.expiresAt &&
    recipient.shareLink.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  // Strip the joined shareLink to match the bare ShareLinkRecipient type.
  const { shareLink: _omit, ...bare } = recipient;
  return bare as ShareLinkRecipient;
}
