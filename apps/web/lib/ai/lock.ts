// Soft edit-lock for the deck editor, per docs/bip-deck-platform-ai-editor.md §9.
//
// The lock is two columns on `decks`: `editing_user_id` (who) and
// `editing_heartbeat_at` (when they last pinged). A lock is "held" iff
// the user id is set AND the heartbeat is within STALE_AFTER. The client
// is expected to ping every HEARTBEAT_INTERVAL while the editor is open.
//
// This isn't a transactional lock. Two simultaneous heartbeats can race;
// last writer wins. That's intentional — the lock exists to give the UI
// an honest "Alice is editing" affordance and to prevent the AI editor
// from generating concurrent working branches against the same deck.
// Hard correctness on git ops sits one layer down, in proposal.ts (head
// SHA verification on accept).

import type { Deck } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { ConflictError } from '@/lib/errors';

/** Client is expected to ping at this cadence. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Older than this and the lock is treated as released. */
export const STALE_AFTER_MS = 2 * 60_000;

export interface LockState {
  /** True if a non-stale lock exists owned by someone other than `userId`. */
  heldByOther: boolean;
  /** Id of the lock owner if any (regardless of staleness). */
  ownerUserId: string | null;
  /** Heartbeat timestamp if any. */
  heartbeatAt: Date | null;
  /** Milliseconds since the last heartbeat (null if no lock). */
  ageMs: number | null;
}

function inspect(
  deck: Pick<Deck, 'editingUserId' | 'editingHeartbeatAt'>,
  userId: string,
): LockState {
  const now = Date.now();
  const heartbeat = deck.editingHeartbeatAt ? deck.editingHeartbeatAt.getTime() : null;
  const fresh = heartbeat !== null && now - heartbeat < STALE_AFTER_MS;
  const heldByOther = fresh && deck.editingUserId !== null && deck.editingUserId !== userId;
  return {
    heldByOther,
    ownerUserId: deck.editingUserId ?? null,
    heartbeatAt: deck.editingHeartbeatAt ?? null,
    ageMs: heartbeat ? now - heartbeat : null,
  };
}

export async function getLockState(deckId: string, userId: string): Promise<LockState> {
  const deck = await prisma.deck.findUniqueOrThrow({
    where: { id: deckId },
    select: { editingUserId: true, editingHeartbeatAt: true },
  });
  return inspect(deck, userId);
}

/**
 * Set/refresh the lock for `userId`. If another user holds a fresh lock,
 * throws ConflictError so the UI can show the take-over affordance per §9.
 * The error includes the owner id and heartbeat age in `details`.
 */
export async function acquireOrRefreshLock(deckId: string, userId: string): Promise<void> {
  const state = await getLockState(deckId, userId);
  if (state.heldByOther) {
    throw new ConflictError('Another user is editing this deck', 'deck_locked', {
      ownerUserId: state.ownerUserId,
      heartbeatAt: state.heartbeatAt,
      ageMs: state.ageMs,
    });
  }
  await prisma.deck.update({
    where: { id: deckId },
    data: { editingUserId: userId, editingHeartbeatAt: new Date() },
  });
}

/**
 * Force-acquire the lock for `userId`, blowing away any existing owner.
 * Used when the UI surfaces the "Take over" button on a held-by-other lock.
 */
export async function takeOverLock(deckId: string, userId: string): Promise<void> {
  await prisma.deck.update({
    where: { id: deckId },
    data: { editingUserId: userId, editingHeartbeatAt: new Date() },
  });
}

/**
 * Release the lock — but only if `userId` is the current owner. Avoids the
 * common bug where a stale client's "I navigated away" call yanks a lock
 * from whoever has since taken over.
 */
export async function releaseLock(deckId: string, userId: string): Promise<void> {
  await prisma.deck.updateMany({
    where: { id: deckId, editingUserId: userId },
    data: { editingUserId: null, editingHeartbeatAt: null },
  });
}
