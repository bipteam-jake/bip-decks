// AI conversation service. Routes are thin; this module owns the rules.
//
// Phase 1 scope per docs/bip-deck-platform-ai-editor.md §3 steps 1-3:
//   1. Create AIConversation for a deck
//   2. Post a user message: persist user msg -> assemble context -> call Claude
//      -> parse response -> persist assistant msg (with model/tokens/cost).
//   3. Retrieve conversation history.
//
// Out of scope for this session per the prompt:
//   - Creating the git working branch (step 4 of §3) — if Claude returns
//     changes, we just log them and persist the parsed structure.
//   - Job rows — wired in the next session along with the branch.

import type { AIConversation, AIMessage, Deck, Prisma, User } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { getDeckById } from '@/lib/decks/service';
import { NotFoundError } from '@/lib/errors';
import { callClaude, type ClaudeMessage } from '@bip/ai-gateway';

import { AI_EDITOR_SYSTEM_PROMPT } from './system-prompt';
import { buildDeckStateBlock } from './context';
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
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const conversation = await prisma.aIConversation.findUnique({ where: { id } });
  if (!conversation) {
    throw new NotFoundError('Conversation not found', 'conversation_not_found');
  }
  const deck = await getDeckById(conversation.deckId);
  const messages = await prisma.aIMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
  });
  return { conversation, deck, messages };
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
}

export interface PostMessageResult {
  userMessage: AIMessage;
  assistantMessage: AIMessage;
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

  // 1. Build deck state from the CURRENT head before we mutate anything.
  //    If the deck changes mid-turn (acceptance of a parallel proposal) we
  //    don't try to detect it in Phase 1 — the lock from §9 lands later.
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

  try {
    const response = await callClaude(claudeMessages, AI_EDITOR_SYSTEM_PROMPT, {
      requestId: input.requestId,
    });
    model = response.model;
    tokensIn = response.tokensIn;
    tokensOut = response.tokensOut;
    costCents = response.costCents;

    const parseResult = parseClaudeResponse(response.content);
    if (parseResult.ok) {
      assistantContent = {
        kind: 'assistant',
        raw: response.content,
        parsed: parseResult.value,
      };

      // Per the session prompt: if the response includes changes, just log
      // them. The git working branch is the next session's job.
      if (parseResult.value.changes && parseResult.value.changes.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            scope: 'ai-editor',
            event: 'changes_proposed_not_applied',
            conversationId: conversation.id,
            deckId: deck.id,
            requestId: input.requestId ?? null,
            count: parseResult.value.changes.length,
            files: parseResult.value.changes.map((c) => ({
              file: c.file,
              operation: c.operation,
              bytes: c.content.length,
            })),
          }),
        );
      }
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
    const isTimeout =
      message.includes('aborted') || message.toLowerCase().includes('timeout');
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

  const assistantMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      // Cast through Prisma.InputJsonValue: our discriminated union has
      // optional fields the strict InputJsonValue type doesn't model, but we
      // own the shape and round-trip it ourselves.
      content: assistantContent as unknown as Prisma.InputJsonValue,
      model,
      tokensIn,
      tokensOut,
      costCents,
    },
  });

  // Touch the conversation so listings sort right.
  await prisma.aIConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return { userMessage, assistantMessage };
}
