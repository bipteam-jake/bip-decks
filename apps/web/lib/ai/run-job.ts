// runAIEditJob — worker entry point for an AI_EDIT job. Called from the
// BullMQ Worker dispatcher (apps/worker/src/handlers/ai-edit.ts).
//
// This is the asynchronous half of what was previously `postUserMessage`
// in apps/web/lib/ai/service.ts. The web API now persists the user
// message and enqueues a Job row; the worker picks the job up and runs
// the actual Claude call + proposal materialization here.
//
// Behavior contract:
//   - Flip Job to RUNNING with startedAt at the very top so the queue
//     panel reflects "working" within one poll.
//   - Re-resolve the deck, brand-kit version, and conversation history
//     fresh from the DB. The worker process is long-lived so we never
//     trust in-memory state across jobs.
//   - On any failure (timeout, parse, gateway, git): persist an
//     assistant_error AIMessage so the chat shows the failure inline,
//     and set the Job to FAILED with `error`. We do NOT auto-retry;
//     retries are an explicit user action (re-send the message).
//   - On success without changes (Claude answered without proposing
//     edits): persist the assistant message, set Job to DONE.
//   - On success with changes: call `buildProposal`, which flips the
//     job to AWAITING_REVIEW. The UI poll picks it up and renders the
//     diff/accept/reject controls.

import type { Job, Prisma, User } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { getDeckById } from '@/lib/decks/service';
import { listPatterns } from '@/lib/brand-kits/patterns-service';
import { parseTokens, parseVoice } from '@/lib/brand-kits/tokens';
import {
  buildBrandContextSystemPrompt,
  buildPatternSystemPrompt,
  callModel,
  type ClaudeMessage,
} from '@bip/ai-gateway';

import { AI_EDITOR_SYSTEM_PROMPT } from './system-prompt';
import { buildDeckStateBlock } from './context';
import { buildProposal, asJobInput, type AIEditJobInput } from './proposal';
import {
  parseClaudeResponse,
  failureToUserMessage,
  type AIEditResponse,
  type ParseFailure,
} from './response-parser';

// ---------------------------------------------------------------------------
// Mirror the AIMessage content shapes from service.ts so the worker can
// persist rows without importing the Next-side service module (which
// would pull route handlers into the worker bundle path).
// ---------------------------------------------------------------------------

type UserMessageContent = { kind: 'user'; text: string; slideId?: string };

type AssistantMessageContent =
  | { kind: 'assistant'; raw: string; parsed: AIEditResponse }
  | {
      kind: 'assistant_error';
      raw: string;
      userMessage: string;
      error: ParseFailure | { kind: 'gateway'; message: string };
    };

// ---------------------------------------------------------------------------
// System prompt assembly. Duplicated intentionally from service.ts because
// service.ts won't be reachable from the worker once we strip the legacy
// sync path. Both copies stay aligned; if you change one, change the
// other.
// ---------------------------------------------------------------------------

async function assembleSystemPrompt(brandKitVersionId: string | null): Promise<string> {
  if (!brandKitVersionId) return AI_EDITOR_SYSTEM_PROMPT;

  const [version, identityAssets, patterns] = await Promise.all([
    prisma.brandKitVersion.findUnique({
      where: { id: brandKitVersionId },
      select: {
        versionLabel: true,
        tokens: true,
        voice: true,
        summary: true,
        brandKit: { select: { name: true } },
      },
    }),
    prisma.brandKitIdentityAsset.findMany({
      where: { brandKitVersionId },
      select: { kind: true },
    }),
    listPatterns({ brandKitVersionId, approvedOnly: true, limit: 200 }),
  ]);

  let prompt = AI_EDITOR_SYSTEM_PROMPT;
  if (version) {
    let colors: Record<string, string> = {};
    let fontFamilies: Record<string, string> = {};
    try {
      const tokens = parseTokens(version.tokens);
      colors = tokens.colors;
      fontFamilies = tokens.type.fontFamilies;
    } catch {
      /* invalid tokens — fall through with empty palette/fonts */
    }
    let voice = { tone: '', terminology: '', dos: '', donts: '' };
    try {
      voice = parseVoice(version.voice);
    } catch {
      /* invalid voice — leave defaults */
    }
    prompt = buildBrandContextSystemPrompt(prompt, {
      kitName: version.brandKit.name,
      versionLabel: version.versionLabel,
      summary: version.summary,
      colors,
      fontFamilies,
      voice,
      identityAssetKinds: Array.from(new Set(identityAssets.map((a) => a.kind))),
    });
  }
  return buildPatternSystemPrompt(
    prompt,
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
 * Replay persisted messages as a Claude messages array. Mirrors the
 * service.ts version: skips error rows and SYSTEM rows so Claude never
 * sees its own bad output as "history".
 */
async function buildHistory(conversationId: string): Promise<ClaudeMessage[]> {
  // Only include messages strictly BEFORE the current turn. We exclude the
  // triggering user message and the (future) assistant message by ordering
  // ascending and stopping at the trigger.
  const rows = await prisma.aIMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
  const history: ClaudeMessage[] = [];
  for (const m of rows) {
    const c = m.content as unknown as
      | UserMessageContent
      | AssistantMessageContent
      | { kind: string };
    if (m.role === 'USER' && (c as UserMessageContent).kind === 'user') {
      history.push({ role: 'user', content: (c as UserMessageContent).text });
    } else if (m.role === 'ASSISTANT' && (c as AssistantMessageContent).kind === 'assistant') {
      history.push({
        role: 'assistant',
        content: (c as { raw: string }).raw,
      });
    }
    // assistant_error and SYSTEM intentionally skipped.
  }
  return history;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface RunAIEditJobResult {
  status: 'AWAITING_REVIEW' | 'DONE' | 'FAILED';
  jobId: string;
  /** Set when an assistant message was persisted (always except on a hard pre-Claude failure). */
  assistantMessageId?: string;
}

/**
 * Idempotent enough: re-running on a job already past RUNNING is a no-op.
 * The BullMQ dispatcher should never invoke this twice for the same id
 * with attempts=1, but defensive check is cheap.
 */
export async function runAIEditJob(jobId: string): Promise<RunAIEditJobResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { status: 'FAILED', jobId };
  }
  if (job.kind !== 'AI_EDIT') {
    throw new Error(`runAIEditJob called for non-AI_EDIT job ${jobId} (kind=${job.kind})`);
  }
  if (job.status === 'CANCELED') {
    // User canceled before we picked it up. Nothing to do.
    return { status: 'FAILED', jobId };
  }
  if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
    // Already completed in a prior attempt (or stale-recovery requeued
    // a row that finished). Treat as no-op success.
    return { status: job.status === 'AWAITING_REVIEW' ? 'AWAITING_REVIEW' : 'DONE', jobId };
  }

  const input = asJobInput(job.input);
  if (!input.conversationId || !input.triggeringMessageId || !input.text) {
    await markFailed(job.id, 'Job input is malformed (missing conversation/message/text)');
    return { status: 'FAILED', jobId };
  }
  if (!job.deckId) {
    await markFailed(job.id, 'Job is not bound to a deck');
    return { status: 'FAILED', jobId };
  }

  // Mark RUNNING immediately so the queue panel reflects activity.
  const running = await prisma.job.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: job.startedAt ?? new Date() },
  });

  // Re-resolve fresh state from the DB. The worker process is long-lived;
  // never trust enqueue-time data for anything we can re-read.
  const deck = await getDeckById(job.deckId);
  if (!deck.headCommitSha) {
    await markFailed(running.id, 'Deck has no committed content');
    return { status: 'FAILED', jobId };
  }
  const creator = await prisma.user.findUnique({ where: { id: job.createdById } });
  if (!creator) {
    await markFailed(running.id, 'Job creator no longer exists');
    return { status: 'FAILED', jobId };
  }

  // Build deck-state from CURRENT head (the user may have accepted other
  // proposals while this one waited in the queue).
  const { currentSlideId, text: deckState } = await buildDeckStateBlock({
    repoPath: deck.repoPath,
    commitSha: deck.headCommitSha,
    currentSlideId: input.currentSlideId,
  });

  const history = await buildHistory(input.conversationId);
  const scopeRule =
    input.scope === 'slide'
      ? `\n\nSCOPE: Only modify slides/${currentSlideId}.html for this turn. Do NOT propose changes to any other slide file, styles/global.css, scripts/global.js, or deck.json. If the request implies edits outside that file, ask a clarifying question instead of editing.`
      : '';
  const currentTurn: ClaudeMessage = {
    role: 'user',
    content: `${deckState}\n\n${input.text}${scopeRule}`,
  };
  const claudeMessages = [...history, currentTurn];

  // ----- Claude call + parse ----- //
  let assistantContent: AssistantMessageContent;
  let parsed: AIEditResponse | null = null;
  let model: string | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let costCents: number | null = null;

  try {
    const systemPrompt = await assembleSystemPrompt(deck.brandKitVersionId);
    const maxTokens = input.expandedBudget ? 64_000 : 32_000;
    const timeoutMs = input.expandedBudget ? 300_000 : 180_000;
    const response = await callModel('CHAT_REFINE', claudeMessages, {
      systemPrompt,
      requestId: input.requestId,
      maxTokens,
      timeoutMs,
    });
    model = response.model;
    tokensIn = response.tokensIn;
    tokensOut = response.tokensOut;
    costCents = response.costCents;

    // Mid-flight cancelation check: if the user canceled while Claude was
    // running, abandon the result before persisting anything.
    const recheck = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    if (recheck?.status === 'CANCELED') {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          scope: 'ai-editor',
          event: 'job_canceled_mid_flight',
          jobId: job.id,
          requestId: input.requestId ?? null,
        }),
      );
      return { status: 'FAILED', jobId };
    }

    const parseResult = parseClaudeResponse(response.content, { stopReason: response.stopReason });
    if (parseResult.ok) {
      parsed = parseResult.value;
      assistantContent = { kind: 'assistant', raw: response.content, parsed: parseResult.value };
    } else {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          scope: 'ai-editor',
          event: 'parse_failure',
          conversationId: input.conversationId,
          requestId: input.requestId ?? null,
          failureKind: parseResult.failure.kind,
          stopReason: response.stopReason,
          rawLength: response.content.length,
          rawPreview: response.content.slice(0, 400),
        }),
      );
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
        conversationId: input.conversationId,
        requestId: input.requestId ?? null,
        message,
      }),
    );
  }

  // ----- Persist assistant message ----- //
  let assistantMessage = await prisma.aIMessage.create({
    data: {
      conversationId: input.conversationId,
      role: 'ASSISTANT',
      content: assistantContent as unknown as Prisma.InputJsonValue,
      model,
      tokensIn,
      tokensOut,
      costCents,
    },
  });

  // Stash assistantMessageId on the job input so it's reachable from the
  // row (handy for debugging and for UI that polls the Job).
  const inputWithMsg: AIEditJobInput = { ...input, assistantMessageId: assistantMessage.id };
  await prisma.job.update({
    where: { id: job.id },
    data: { input: inputWithMsg as unknown as Prisma.InputJsonValue },
  });

  // ----- Materialize proposal (if we have changes) ----- //
  if (parsed && parsed.changes && parsed.changes.length > 0) {
    try {
      // Re-read the job so buildProposal sees the assistantMessageId we
      // just stamped.
      const refreshed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      const built = await buildProposal({
        job: refreshed,
        deck,
        user: creator as User,
        response: parsed,
        conversationId: input.conversationId,
        triggeringMessageId: assistantMessage.id,
        requestId: input.requestId,
      });
      await prisma.aIMessage.update({
        where: { id: assistantMessage.id },
        data: { relatedJobId: built.job.id },
      });
      await prisma.aIConversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      return {
        status: 'AWAITING_REVIEW',
        jobId,
        assistantMessageId: assistantMessage.id,
      };
    } catch (err) {
      // buildProposal already flipped the job to FAILED. Rewrite the
      // assistant message so the chat shows the error inline rather than
      // a "preview ready" success bubble.
      const message = (err as Error).message;
      const failureContent: AssistantMessageContent = {
        kind: 'assistant_error',
        raw:
          assistantContent.kind === 'assistant'
            ? assistantContent.raw
            : (assistantContent.raw ?? ''),
        userMessage:
          'I drafted a change but couldn’t prepare the preview. Try rephrasing or try again.',
        error: { kind: 'gateway', message },
      };
      assistantMessage = await prisma.aIMessage.update({
        where: { id: assistantMessage.id },
        data: { content: failureContent as unknown as Prisma.InputJsonValue },
      });
      await prisma.aIConversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      return { status: 'FAILED', jobId, assistantMessageId: assistantMessage.id };
    }
  }

  // ----- No changes: advice-only or error ----- //
  await prisma.job.update({
    where: { id: job.id },
    data: { status: 'DONE', completedAt: new Date() },
  });
  await prisma.aIConversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
  });
  return { status: 'DONE', jobId, assistantMessageId: assistantMessage.id };
}

async function markFailed(jobId: string, error: string): Promise<void> {
  await prisma.job
    .update({
      where: { id: jobId },
      data: { status: 'FAILED', error, completedAt: new Date() },
    })
    .catch(() => undefined);
}
