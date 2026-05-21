// AI conversation service. Routes are thin; this module owns the rules.
//
// As of Phase 3 chunk 1 the turn is asynchronous:
//   1. Create AIConversation for a deck.
//   2. Post a user message: persist user msg -> auto-reject any pending
//      proposal (§7) -> acquire lock (§9) -> ENQUEUE an AI_EDIT Job
//      and return immediately. The Claude call + proposal build runs in
//      the worker (see apps/web/lib/ai/run-job.ts) and the UI polls the
//      conversation endpoint to pick up the assistant message + job
//      state transitions.
//   3. Retrieve conversation history.

import type { AIConversation, AIMessage, Deck, Job, Prisma, User } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { getDeckById } from '@/lib/decks/service';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { enqueueJob } from '@/lib/queue';
import type { AIEditResponse, ParseFailure } from './response-parser';

import { acquireOrRefreshLock } from './lock';
import { autoRejectPendingForConversation, listPendingForConversation } from './proposal';
import type { AIEditJobInput } from './proposal';

// ---------------------------------------------------------------------------
// AIMessage.content shape
//
// The schema stores `content` as Json, so we can pick the shape. Decisions:
//   - USER messages: { kind: 'user', text, slideId? }. Only `text` is replayed
//     to Claude on subsequent turns — the deck_state block is rebuilt fresh
//     for the current turn (§4 "fresh context every turn").
//   - ASSISTANT success: { kind: 'assistant', raw, parsed }. We store both
//     `raw` (for replay to Claude) and `parsed` (for UI rendering).
//   - ASSISTANT error: { kind: 'assistant_error', raw, error, userMessage }.
//     Not replayed on future turns — failed turns shouldn't poison context.
// ---------------------------------------------------------------------------

export type UserMessageContent = {
  kind: 'user';
  text: string;
  slideId?: string;
};

export type AssistantMessageContent =
  | {
      kind: 'assistant';
      raw: string;
      parsed: AIEditResponse;
    }
  | {
      kind: 'assistant_error';
      raw: string;
      userMessage: string;
      error: ParseFailure | { kind: 'gateway'; message: string };
    };

export type MessageContent = UserMessageContent | AssistantMessageContent;

function asMessageContent(value: unknown): MessageContent {
  // Prisma returns Json as `unknown`; we own the shape so a cast is safe.
  return value as MessageContent;
}

// ---------------------------------------------------------------------------
// Conversation CRUD
// ---------------------------------------------------------------------------

export async function createConversation(input: {
  deckId: string;
  user: User;
  title?: string | null;
}): Promise<AIConversation> {
  const deck = await getDeckById(input.deckId);
  return prisma.aIConversation.create({
    data: {
      deckId: deck.id,
      createdById: input.user.id,
      title: input.title ?? null,
    },
  });
}

export interface ConversationWithMessages {
  conversation: AIConversation;
  deck: Deck;
  messages: AIMessage[];
  /**
   * Map of jobId -> Job for every job referenced by a message.relatedJobId.
   * Lets the UI render proposal cards without an extra round trip.
   */
  jobs: Record<string, Job>;
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const conversation = await prisma.aIConversation.findUnique({ where: { id } });
  if (!conversation || conversation.kind !== 'EDITOR') {
    throw new NotFoundError('Conversation not found', 'conversation_not_found');
  }
  const deck = await getDeckById(conversation.deckId);
  const messages = await prisma.aIMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
  });
  const jobIds = messages.map((m) => m.relatedJobId).filter((id): id is string => id !== null);
  const jobRows = jobIds.length ? await prisma.job.findMany({ where: { id: { in: jobIds } } }) : [];
  const jobs: Record<string, Job> = {};
  for (const j of jobRows) jobs[j.id] = j;
  return { conversation, deck, messages, jobs };
}

/**
 * List conversations for a deck, newest first. Used by the editor UI to
 * pick up where the user left off across page reloads.
 */
export async function listConversationsForDeck(deckId: string): Promise<AIConversation[]> {
  return prisma.aIConversation.findMany({
    where: { deckId, kind: 'EDITOR' },
    orderBy: { updatedAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Turn: post user message -> Claude -> persist assistant message
// ---------------------------------------------------------------------------

export interface PostMessageInput {
  conversationId: string;
  user: User;
  text: string;
  /** Slide the user is currently editing in the preview iframe (per §4). */
  currentSlideId?: string;
  /** Propagated through to the gateway for log correlation. */
  requestId?: string;
  /**
   * Per §7 "Iterating on the same proposal": if a pending proposal exists,
   * the API rejects this call unless the client explicitly confirms it
   * wants to supersede it. The UI surfaces the confirmation; the API does
   * the rest.
   */
  supersedePending?: boolean;
  /**
   * Opt into the full model output budget (~64K tokens) for very large
   * edits. Default is the high-but-not-max 32K cap. The UI sets this when
   * the user retries after a `truncated` failure.
   */
  expandedBudget?: boolean;
  /**
   * Editing scope set by the user in the composer toggle.
   *   - 'slide': Claude must only modify the currentSlideId's HTML.
   *   - 'deck' (default): Claude may touch any slide / global CSS.
   * Only enforced via a hard rule appended to the user-turn content; the
   * response parser still rejects any change outside the deck repo.
   */
  scope?: 'slide' | 'deck';
}

export interface PostMessageResult {
  userMessage: AIMessage;
  /**
   * The QUEUED AI_EDIT job that the worker will pick up. The assistant
   * message lands later — the UI is expected to poll the conversation
   * endpoint until it appears.
   */
  job: Job;
  /** Job ids that were auto-canceled because of `supersedePending`. */
  supersededJobIds: string[];
}

/**
 * Truncate the user's prompt to a label-sized snippet for the Job row.
 * The queue panel renders this so the user can tell which message a
 * running job belongs to.
 */
function jobLabelFromText(text: string, maxLen = 72): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= maxLen ? single : `${single.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Run one chat-depth turn — *asynchronously*. Persists the user message,
 * auto-supersedes any pending proposal, and enqueues an AI_EDIT job. The
 * worker (see lib/ai/run-job.ts) does the Claude call, persists the
 * assistant message, and either flips the job to AWAITING_REVIEW with a
 * proposal branch or to DONE for an advice-only reply. The UI picks up
 * those transitions by polling the conversation GET endpoint.
 *
 * This function intentionally returns BEFORE Claude is called. The chat
 * stays continuous via the pending "thinking…" bubble that the editor
 * shows until the next poll surfaces the assistant row.
 */
export async function postUserMessage(input: PostMessageInput): Promise<PostMessageResult> {
  const { conversation, deck } = await getConversation(input.conversationId);

  if (!deck.headCommitSha) {
    // A deck without a head commit is a broken-init situation; treat it as
    // not-found rather than letting the job pick up a malformed row.
    throw new NotFoundError('Deck has no committed content', 'deck_no_head');
  }

  // 0. Edit-lock (§9). Throws ConflictError with details if another user
  //    holds the lock; the UI surfaces the take-over affordance from that.
  //    Refreshing the lock as a side effect serves as our heartbeat for
  //    the API path, complementing the periodic client pings.
  await acquireOrRefreshLock(deck.id, input.user.id);

  // 0a. Pending-proposal check (§7 "Iterating"). If a pending proposal
  //     exists and the caller didn't pass supersedePending, refuse with a
  //     412 so the UI can confirm and retry. Otherwise auto-reject the
  //     pending job(s) before kicking off this turn.
  const pending = await listPendingForConversation(conversation.id);
  if (pending.length > 0 && !input.supersedePending) {
    throw new ConflictError('A previous proposal is still pending review', 'pending_proposal', {
      pendingJobIds: pending.map((p) => p.id),
    });
  }

  // 1. Determine current slide id for the deck-state snapshot the worker
  //    will rebuild. We don't compute the full deck-state here — that
  //    runs in the worker against the LATEST head at run time (the user
  //    may accept other proposals between enqueue and dispatch).
  const currentSlideId = input.currentSlideId ?? null;

  // 2. Persist the user message FIRST, before any external/queue call.
  //    If enqueue fails the user message stays in the record.
  const userMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: {
        kind: 'user',
        text: input.text,
        slideId: currentSlideId ?? undefined,
      } satisfies UserMessageContent,
    },
  });

  // 2a. Auto-reject any pending proposals citing the new message id as
  //     the supersede marker.
  let supersededJobIds: string[] = [];
  if (pending.length > 0) {
    supersededJobIds = await autoRejectPendingForConversation({
      conversationId: conversation.id,
      supersedingMessageId: userMessage.id,
    });
  }

  // 3. Enqueue the AI_EDIT job. The worker reads job.input to rebuild
  //    everything it needs.
  const jobInput: AIEditJobInput = {
    conversationId: conversation.id,
    triggeringMessageId: userMessage.id,
    text: input.text,
    currentSlideId: currentSlideId ?? undefined,
    scope: input.scope ?? 'deck',
    expandedBudget: Boolean(input.expandedBudget),
    requestId: input.requestId,
  };
  const job = await enqueueJob({
    kind: 'AI_EDIT',
    deckId: deck.id,
    createdBy: input.user,
    label: jobLabelFromText(input.text),
    input: jobInput as unknown as Record<string, unknown>,
  });

  // Touch the conversation so listings sort right.
  await prisma.aIConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return { userMessage, job, supersededJobIds };
}
