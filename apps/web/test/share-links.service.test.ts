// Share-link service tests. Real Postgres; uses a tmp DECK_REPOS_PATH and
// EMAIL_PROVIDER=console so issuance never actually sends mail.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TMP_REPOS = mkdtempSync(path.join(tmpdir(), 'bip-deck-sharelink-test-'));
process.env.DECK_REPOS_PATH = TMP_REPOS;
// Force the console email sink no matter what .env.local says — tests must
// not depend on (or hit) the live email provider.
process.env.EMAIL_PROVIDER = 'console';
process.env.EMAIL_FROM = 'tests@bip.test';

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import { createDeck } from '@/lib/decks/service';
import {
  claimShareLink,
  issueShareLink,
  listShareLinksForDeck,
  loadActiveRecipientForDeck,
  resolveActiveShareLink,
  revokeShareLink,
} from '@/lib/share-links/service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import type { User } from '@bip/db';

const TEST_TAG = '+sharelinkvitest@bip.test';
const TEST_SLUG_PREFIX = 'slvt-';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}
function uniqueTitle(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'issuer'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `ShareLink Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}

async function makeDeck(user: User) {
  return createDeck({ title: uniqueTitle('deck') }, user);
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
});

afterEach(async () => {
  // Recipients FK→shareLink FK→deck; comments FK→deck; users have no
  // cascade from createdBy/createdById. Wipe in dependency order.
  const decks = await prisma.deck.findMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    select: { id: true },
  });
  const deckIds = decks.map((d) => d.id);
  if (deckIds.length > 0) {
    const links = await prisma.shareLink.findMany({
      where: { deckId: { in: deckIds } },
      select: { id: true },
    });
    const linkIds = links.map((l) => l.id);
    if (linkIds.length > 0) {
      await prisma.shareLinkRecipient.deleteMany({ where: { shareLinkId: { in: linkIds } } });
      await prisma.shareLink.deleteMany({ where: { id: { in: linkIds } } });
    }
    await prisma.comment.deleteMany({ where: { deckId: { in: deckIds } } });
    await prisma.deck.deleteMany({ where: { id: { in: deckIds } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

afterAll(() => {
  rmSync(TMP_REPOS, { recursive: true, force: true });
});

describe('issueShareLink', () => {
  it('creates a REVIEWER link with default 30d expiry and returns the URL', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const before = Date.now();
    const { shareLink, url } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'reviewer@example.com',
      createdBy: user,
    });

    expect(shareLink.audienceType).toBe('REVIEWER');
    expect(shareLink.versionBinding).toBe('LIVE');
    expect(shareLink.boundCommitSha).toBeNull();
    expect(shareLink.createdById).toBe(user.id);
    expect(shareLink.revokedAt).toBeNull();
    expect(shareLink.expiresAt).not.toBeNull();
    // ~30 days out, allow a generous slop.
    const days = (shareLink.expiresAt!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    expect(url).toContain(`/d/${deck.slug}`);
    expect(url).toContain(`st=${encodeURIComponent(shareLink.token)}`);
  });

  it('honors expiresAt=null (never expires)', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const { shareLink } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'reviewer@example.com',
      expiresAt: null,
      createdBy: user,
    });
    expect(shareLink.expiresAt).toBeNull();
  });

  it('rejects empty/invalid email', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    await expect(
      issueShareLink({ deckId: deck.id, recipientEmail: '', createdBy: user }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      issueShareLink({ deckId: deck.id, recipientEmail: 'not-an-email', createdBy: user }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects unknown deck', async () => {
    const user = await makeUser();
    await expect(
      issueShareLink({
        deckId: '00000000-0000-0000-0000-000000000000',
        recipientEmail: 'r@example.com',
        createdBy: user,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listShareLinksForDeck + revokeShareLink', () => {
  it('lists links newest first and revokes idempotently', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const first = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'a@example.com',
      createdBy: user,
    });
    // Ensure createdAt differs.
    await new Promise((r) => setTimeout(r, 10));
    const second = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'b@example.com',
      createdBy: user,
    });

    const list = await listShareLinksForDeck(deck.id);
    expect(list.map((l) => l.id)).toEqual([second.shareLink.id, first.shareLink.id]);

    const revoked = await revokeShareLink(first.shareLink.id);
    expect(revoked.revokedAt).not.toBeNull();
    // Idempotent.
    const again = await revokeShareLink(first.shareLink.id);
    expect(again.revokedAt!.getTime()).toBe(revoked.revokedAt!.getTime());
  });

  it('throws NotFound for an unknown id', async () => {
    await expect(revokeShareLink('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('resolveActiveShareLink', () => {
  it('returns the link + deck for an active token', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const { shareLink } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    const resolved = await resolveActiveShareLink(shareLink.token);
    expect(resolved).not.toBeNull();
    expect(resolved!.deck.id).toBe(deck.id);
    expect(resolved!.shareLink.id).toBe(shareLink.id);
  });

  it('returns null for revoked, expired, missing, and deleted-deck cases', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    // Missing.
    expect(await resolveActiveShareLink('does-not-exist-token-string-1234567890')).toBeNull();

    // Revoked.
    const revoked = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    await revokeShareLink(revoked.shareLink.id);
    expect(await resolveActiveShareLink(revoked.shareLink.token)).toBeNull();

    // Expired (set expiry to the past via direct update).
    const expired = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    await prisma.shareLink.update({
      where: { id: expired.shareLink.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveActiveShareLink(expired.shareLink.token)).toBeNull();

    // Deleted deck.
    const live = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    await prisma.deck.update({ where: { id: deck.id }, data: { deletedAt: new Date() } });
    expect(await resolveActiveShareLink(live.shareLink.token)).toBeNull();
    // Undo so afterEach can find/delete the deck.
    await prisma.deck.update({ where: { id: deck.id }, data: { deletedAt: null } });
  });
});

describe('claimShareLink', () => {
  it('creates a recipient and is idempotent on the same clientId', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const { shareLink } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    const clientId = crypto.randomUUID();
    const first = await claimShareLink({
      token: shareLink.token,
      displayName: 'Alice',
      clientId,
    });
    expect(first.recipient.shareLinkId).toBe(shareLink.id);
    expect(first.recipient.displayName).toBe('Alice');
    expect(first.recipient.visitCount).toBe(1);

    const second = await claimShareLink({
      token: shareLink.token,
      displayName: 'Alice Updated',
      clientId,
      email: 'alice@example.com',
    });
    expect(second.recipient.id).toBe(first.recipient.id);
    expect(second.recipient.displayName).toBe('Alice Updated');
    expect(second.recipient.email).toBe('alice@example.com');
    expect(second.recipient.visitCount).toBe(2);
  });

  it('rejects cross-link reuse of a clientId with ConflictError', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const linkA = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'a@example.com',
      createdBy: user,
    });
    const linkB = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'b@example.com',
      createdBy: user,
    });
    const clientId = crypto.randomUUID();
    await claimShareLink({ token: linkA.shareLink.token, displayName: 'A', clientId });
    await expect(
      claimShareLink({ token: linkB.shareLink.token, displayName: 'A', clientId }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects invalid payload with ValidationError and inactive links with ForbiddenError', async () => {
    await expect(claimShareLink({ token: 'x', displayName: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const user = await makeUser();
    const deck = await makeDeck(user);
    const { shareLink } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    await revokeShareLink(shareLink.id);
    await expect(
      claimShareLink({ token: shareLink.token, displayName: 'Bob' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('loadActiveRecipientForDeck', () => {
  it('returns the bare recipient when active and matching deck', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const { shareLink } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    const claim = await claimShareLink({
      token: shareLink.token,
      displayName: 'Alice',
      clientId: crypto.randomUUID(),
    });
    const r = await loadActiveRecipientForDeck(claim.recipient.id, deck.id);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(claim.recipient.id);
  });

  it('returns null when the deck id does not match or the link is revoked', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const otherDeck = await makeDeck(user);
    const { shareLink } = await issueShareLink({
      deckId: deck.id,
      recipientEmail: 'r@example.com',
      createdBy: user,
    });
    const claim = await claimShareLink({
      token: shareLink.token,
      displayName: 'Alice',
      clientId: crypto.randomUUID(),
    });

    // Mismatched deck.
    expect(await loadActiveRecipientForDeck(claim.recipient.id, otherDeck.id)).toBeNull();

    // Revoked link.
    await revokeShareLink(shareLink.id);
    expect(await loadActiveRecipientForDeck(claim.recipient.id, deck.id)).toBeNull();
  });

  it('returns null for an unknown recipient id', async () => {
    expect(
      await loadActiveRecipientForDeck('00000000-0000-0000-0000-000000000000', 'whatever'),
    ).toBeNull();
  });
});
