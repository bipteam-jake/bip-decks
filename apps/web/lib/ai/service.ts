// AI conversation service. Routes are thin; this module owns the rules.
//
// Per docs/bip-deck-platform-ai-editor.md §3 the full turn:
//   1. Create AIConversation for a deck.
//   2. Post a user message: persist user msg -> auto-reject any pending
//      proposal (§7) -> acquire lock (§9) -> assemble context -> call Claude
//      -> parse response -> if changes: build proposal (job + branch + cache)
//      -> persist assistant msg (with model/tokens/cost + relatedJobId).
//   3. Retrieve conversation history.

import type { AIConversation, AIMessage, Deck, Job, Prisma, User } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { getDeckById } from '@/lib/decks/service';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { buildPatternSystemPrompt, callClaude, type ClaudeMessage } from '@bip/ai-gateway';
import { listPatterns } from '@/lib/brand-kits/patterns-service';

import { AI_EDITOR_SYSTEM_PROMPT } from './system-prompt';
import { buildDeckStateBlock } from './context';
import { acquireOrRefreshLock } from './lock';
import {
  autoRejectPendingForConversation,
  buildProposal,
  listPendingForConversation,
} from './proposal';
import {
  parseClaudeResponse,
  failureToUserMessage,
  type AIEditResponse,
  type ParseFailure,
} from './response-parser';

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
}

export interface PostMessageResult {
  userMessage: AIMessage;
  assistantMessage: AIMessage;
  job: Job | null;
  /** Job ids that were auto-canceled because of `supersedePending`. */
  supersededJobIds: string[];
}

/**
 * Assemble the system prompt for an AI turn. The base editor prompt is
 * always included; if the deck is bound to a brand-kit version with
 * approved patterns, the pattern catalog is appended so Claude can reach
 * for them by slug. See packages/ai-gateway buildPatternSystemPrompt for
 * the prompt block shape.
 */
async function assembleSystemPrompt(brandKitVersionId: string | null): Promise<string> {
  if (!brandKitVersionId) return AI_EDITOR_SYSTEM_PROMPT;
  const patterns = await listPatterns({ brandKitVersionId, approvedOnly: true, limit: 200 });
  return buildPatternSystemPrompt(
    AI_EDITOR_SYSTEM_PROMPT,
    patterns.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      category: p.category,
      parameters: p.parameters,
    })),
  );
}

/**
 * Turn replay: convert persisted AIMessage rows back into a Claude messages
 * array. Skips error assistant messages (we don't want Claude to "see" its
 * own bad output) and any system rows (unused in Phase 1). Strips deck_state
 * from prior user messages — only the current turn gets fresh context.
 */
function buildHistory(messages: AIMessage[]): ClaudeMessage[] {
  const history: ClaudeMessage[] = [];
  for (const m of messages) {
    const c = asMessageContent(m.content);
    if (m.role === 'USER' && c.kind === 'user') {
      history.push({ role: 'user', content: c.text });
    } else if (m.role === 'ASSISTANT' && c.kind === 'assistant') {
      history.push({ role: 'assistant', content: c.raw });
    }
    // assistant_error and SYSTEM intentionally skipped.
  }
  return history;
}

/**
 * Run one chat-depth turn. Always persists a user AIMessage row and an
 * assistant AIMessage row, even if Claude failed — the assistant row carries
 * a user-friendly message inside its `assistant_error` content per §10, and
 * the route returns success either way. The UI distinguishes success from
 * error by inspecting `content.kind`. This keeps the chat reactive (no
 * silent dropped turns) and matches the §10 table where every failure
 * surfaces in chat rather than via HTTP error.
 */
export async function postUserMessage(input: PostMessageInput): Promise<PostMessageResult> {
  const { conversation, deck, messages } = await getConversation(input.conversationId);

  if (!deck.headCommitSha) {
    // A deck without a head commit is a broken-init situation; treat it as
    // not-found rather than letting context assembly throw a confusing
    // git-show error.
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
  let supersededJobIds: string[] = [];
  if (pending.length > 0) {
    if (!input.supersedePending) {
      throw new ConflictError('A previous proposal is still pending review', 'pending_proposal', {
        pendingJobIds: pending.map((p) => p.id),
      });
    }
    // Carry these out after we persist the user message — we need that
    // message's id as the supersede marker (§7).
  }

  // 1. Build deck state from the CURRENT head before we mutate anything.
  const { currentSlideId, text: deckState } = await buildDeckStateBlock({
    repoPath: deck.repoPath,
    commitSha: deck.headCommitSha,
    currentSlideId: input.currentSlideId,
  });

  // 2. Persist the user message FIRST, before any external call. If the
  //    Claude call fails the user's message stays in the record.
  const userMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: {
        kind: 'user',
        text: input.text,
        slideId: currentSlideId,
      } satisfies UserMessageContent,
    },
  });

  // 2a. Now that we have the message id, auto-reject any pending proposals
  //     citing it as the supersede marker.
  if (pending.length > 0) {
    supersededJobIds = await autoRejectPendingForConversation({
      conversationId: conversation.id,
      supersedingMessageId: userMessage.id,
    });
  }

  // 3. Assemble the Claude messages array. Historical messages first, then
  //    the new user message with the deck_state block prepended.
  const history = buildHistory(messages);
  const currentTurn: ClaudeMessage = {
    role: 'user',
    content: `${deckState}\n\n${input.text}`,
  };
  const claudeMessages = [...history, currentTurn];

  // 4. Call the gateway. On any failure, persist an assistant_error row
  //    with a friendly user message so the UI can render it inline.
  let assistantContent: AssistantMessageContent;
  let model: string | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let costCents: number | null = null;
  let parsedResponse: AIEditResponse | null = null;

  try {
    const systemPrompt = await assembleSystemPrompt(deck.brandKitVersionId);
    const response = await callClaude(claudeMessages, systemPrompt, {
      requestId: input.requestId,
    });
    model = response.model;
    tokensIn = response.tokensIn;
    tokensOut = response.tokensOut;
    costCents = response.costCents;

    const parseResult = parseClaudeResponse(response.content);
    if (parseResult.ok) {
      parsedResponse = parseResult.value;
      assistantContent = {
        kind: 'assistant',
        raw: response.content,
        parsed: parseResult.value,
      };
    } else {
      assistantContent = {
        kind: 'assistant_error',
        raw: response.content,
        userMessage: failureToUserMessage(parseResult.failure),
        error: parseResult.failure,
      };
    }
  } catch (err) {
    const message = (err as Error).message;
    const isTimeout = message.includes('aborted') || message.toLowerCase().includes('timeout');
    assistantContent = {
      kind: 'assistant_error',
      raw: '',
      userMessage: isTimeout
        ? 'Took too long. Try again or simplify the request.'
        : 'Something went wrong reaching the model. Try again in a moment.',
      error: { kind: 'gateway', message },
    };
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-editor',
        event: 'gateway_error',
        conversationId: conversation.id,
        requestId: input.requestId ?? null,
        message,
      }),
    );
  }

  // 5. Persist the assistant message. We need its id to link the Job
  //    (Job.input.triggeringMessageId), so insert before building the
  //    proposal, then update the row with relatedJobId once we have it.
  let assistantMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: assistantContent as unknown as Prisma.InputJsonValue,
      model,
      tokensIn,
      tokensOut,
      costCents,
    },
  });

  // 6. If the parsed response contains changes, materialize them as a Job +
  //    git working branch. On build failure we mutate the persisted
  //    assistant row into an assistant_error so the UI shows the failure
  //    inline (per §10 git-error row).
  let job: Job | null = null;
  if (parsedResponse && parsedResponse.changes && parsedResponse.changes.length > 0) {
    try {
      const result = await buildProposal({
        deck,
        user: input.user,
        response: parsedResponse,
        conversationId: conversation.id,
        triggeringMessageId: assistantMessage.id,
        requestId: input.requestId,
      });
      job = result.job;
      assistantMessage = await prisma.aIMessage.update({
        where: { id: assistantMessage.id },
        data: { relatedJobId: job.id },
      });
    } catch (err) {
      const message = (err as Error).message;
      const failureContent: AssistantMessageContent = {
        kind: 'assistant_error',
        raw:
          typeof assistantContent === 'object' && 'raw' in assistantContent
            ? assistantContent.raw
            : '',
        userMessage:
          'I drafted a change but couldn’t prepare the preview. Try rephrasing or try again.',
        error: { kind: 'gateway', message },
      };
      assistantMessage = await prisma.aIMessage.update({
        where: { id: assistantMessage.id },
        data: { content: failureContent as unknown as Prisma.InputJsonValue },
      });
    }
  }

  // Touch the conversation so listings sort right.
  await prisma.aIConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return { userMessage, assistantMessage, job, supersededJobIds };
}
