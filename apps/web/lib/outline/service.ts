// Outline-first deck generation service (Phase 2.5,
// docs/bip-deck-platform-phasing.md §3 item 3).
//
// Flow:
//   1. User picks "Outline-first" in the new-deck dialog, fills the brief
//      (title, audience, goal, talking points + optional fields).
//   2. We create a blank deck (existing createDeck path) and an
//      AIConversation(kind=OUTLINE) seeded with the brief.
//   3. We immediately run the first Claude turn synchronously and persist
//      both messages. The page renders chat + structured outline preview.
//   4. The user iterates with Claude. Every assistant turn may include a
//      revised full outline (always the complete set, never partial).
//   5. On "Approve", we read the latest outline from the most recent
//      assistant message, scaffold one HTML stub per slide into the deck's
//      git repo with the title rendered and notes as an HTML comment,
//      rewrite deck.json, and commit. Mark the conversation approvedAt.
//
// Persistence shape for AIMessage.content (this conversation kind only):
//   USER initial brief:
//     { kind: 'brief', text: string, brief: OutlineBrief }
//   USER subsequent turn:
//     { kind: 'user', text: string }
//   ASSISTANT success:
//     { kind: 'assistant', raw, payload: OutlineTurnPayload }
//   ASSISTANT parse-fail / gateway error:
//     { kind: 'assistant_error', raw, userMessage, error }

import path from 'node:path';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';

import type { AIConversation, AIMessage, Deck, Prisma, User } from '@bip/db';
import {
  buildOutlineKickoff,
  generateOutlineTurn,
  type ClaudeMessage,
  type OutlineBrief,
  type OutlineDraft,
  type OutlineSlide,
  type OutlineTurnPayload,
} from '@bip/ai-gateway';

import { prisma } from '@/lib/prisma';
import { getDeckById } from '@/lib/decks/service';
import { invalidateCachedBundle } from '@/lib/decks/bundle-cache';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// AIMessage content shapes (outline-conversation flavor)
// ---------------------------------------------------------------------------

export type OutlineUserContent =
  | { kind: 'brief'; text: string; brief: OutlineBrief }
  | { kind: 'user'; text: string }
  /**
   * Manual outline edit — the user bypassed the chat and directly
   * mutated the outline in the preview pane. `outline` is the full new
   * draft (always complete, never partial). On replay we emit a Claude
   * user-turn carrying the new JSON so subsequent assistant turns honor
   * the user's edits as the new baseline.
   */
  | { kind: 'edit'; text: string; outline: OutlineDraft };

export type OutlineAssistantContent =
  | { kind: 'assistant'; raw: string; payload: OutlineTurnPayload }
  | {
      kind: 'assistant_error';
      raw: string;
      userMessage: string;
      error: { kind: 'parse' | 'gateway'; message: string };
    };

export type OutlineMessageContent = OutlineUserContent | OutlineAssistantContent;

function asOutlineContent(value: unknown): OutlineMessageContent {
  return value as OutlineMessageContent;
}

// ---------------------------------------------------------------------------
// Conversation + turn helpers
// ---------------------------------------------------------------------------

/**
 * Replay persisted messages back into the Claude messages array. Error
 * assistant rows are skipped (don't poison context). The brief becomes a
 * plain text user message — Claude doesn't need the structured form on
 * replay, only the original prose.
 */
function buildOutlineHistory(messages: AIMessage[]): ClaudeMessage[] {
  const history: ClaudeMessage[] = [];
  for (const m of messages) {
    const c = asOutlineContent(m.content);
    if (m.role === 'USER' && (c.kind === 'brief' || c.kind === 'user')) {
      history.push({ role: 'user', content: c.text });
    } else if (m.role === 'USER' && c.kind === 'edit') {
      // Surface the new outline to Claude as a user turn so the next
      // assistant response uses it as the baseline.
      history.push({
        role: 'user',
        content: `${c.text}\n\nHere is the full outline after my edits as JSON (use this as the new baseline):\n\n${JSON.stringify(
          { kind: 'outline', outline: c.outline },
          null,
          2,
        )}`,
      });
    } else if (m.role === 'ASSISTANT' && c.kind === 'assistant') {
      history.push({ role: 'assistant', content: c.raw });
    }
  }
  return history;
}

/**
 * Latest outline in the conversation, or null. Considers both assistant
 * `outline` payloads and user manual `edit` messages, whichever is most
 * recent — that's the draft the user is currently looking at and will
 * approve.
 */
export function findLatestOutline(messages: AIMessage[]): OutlineDraft | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const c = asOutlineContent(m.content);
    if (m.role === 'ASSISTANT' && c.kind === 'assistant' && c.payload.kind === 'outline') {
      return c.payload.outline;
    }
    if (m.role === 'USER' && c.kind === 'edit') {
      return c.outline;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create + first turn
// ---------------------------------------------------------------------------

export interface CreateOutlineConversationInput {
  deckId: string;
  user: User;
  brief: OutlineBrief;
  /** Propagated through gateway for log correlation. */
  requestId?: string;
}

export interface OutlineConversationWithMessages {
  conversation: AIConversation;
  deck: Deck;
  messages: AIMessage[];
}

/**
 * Create a new outline conversation for the deck, persist the brief as the
 * first USER message, run the first Claude turn synchronously, persist the
 * assistant reply. Returns the full conversation state for the UI to render.
 *
 * One outline conversation per deck. Re-calling on a deck that already has
 * one is a ConflictError — outline-first is a one-shot, not an ongoing flow.
 */
export async function createOutlineConversation(
  input: CreateOutlineConversationInput,
): Promise<OutlineConversationWithMessages> {
  const deck = await getDeckById(input.deckId);
  const existing = await prisma.aIConversation.findFirst({
    where: { deckId: deck.id, kind: 'OUTLINE' },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      'This deck already has an outline conversation',
      'outline_conversation_exists',
      { conversationId: existing.id },
    );
  }

  const conversation = await prisma.aIConversation.create({
    data: {
      deckId: deck.id,
      createdById: input.user.id,
      kind: 'OUTLINE',
      title: input.brief.title,
    },
  });

  const kickoff = buildOutlineKickoff(input.brief);
  await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: {
        kind: 'brief',
        text: kickoff.content,
        brief: input.brief,
      } satisfies OutlineUserContent as unknown as Prisma.InputJsonValue,
    },
  });

  await runOutlineTurn({
    conversationId: conversation.id,
    requestId: input.requestId,
  });

  return getOutlineConversation(conversation.id);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function getOutlineConversation(id: string): Promise<OutlineConversationWithMessages> {
  const conversation = await prisma.aIConversation.findUnique({ where: { id } });
  if (!conversation || conversation.kind !== 'OUTLINE') {
    throw new NotFoundError('Outline conversation not found', 'outline_conversation_not_found');
  }
  const deck = await getDeckById(conversation.deckId);
  const messages = await prisma.aIMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
  });
  return { conversation, deck, messages };
}

/** Locate the (deck's) outline conversation, if any. */
export async function findOutlineConversationForDeck(
  deckId: string,
): Promise<AIConversation | null> {
  return prisma.aIConversation.findFirst({
    where: { deckId, kind: 'OUTLINE' },
    orderBy: { createdAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Post user message
// ---------------------------------------------------------------------------

export interface PostOutlineMessageInput {
  conversationId: string;
  user: User;
  text: string;
  requestId?: string;
}

export async function postOutlineMessage(
  input: PostOutlineMessageInput,
): Promise<OutlineConversationWithMessages> {
  const { conversation } = await getOutlineConversation(input.conversationId);
  if (conversation.approvedAt) {
    throw new ConflictError(
      'Outline has already been approved; further edits use the AI editor',
      'outline_already_approved',
    );
  }
  const text = input.text.trim();
  if (!text) throw new ValidationError('Message text is required');

  await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: {
        kind: 'user',
        text,
      } satisfies OutlineUserContent as unknown as Prisma.InputJsonValue,
    },
  });

  await runOutlineTurn({
    conversationId: conversation.id,
    requestId: input.requestId,
  });

  return getOutlineConversation(conversation.id);
}

// ---------------------------------------------------------------------------
// Manual edit (user edits the outline directly in the preview pane)
// ---------------------------------------------------------------------------

export interface EditOutlineInput {
  conversationId: string;
  user: User;
  outline: OutlineDraft;
}

/**
 * Persist a user-authored outline revision. Stored as a USER message with
 * `kind: 'edit'` so the chat can render it distinctly and Claude sees it
 * as the new baseline on the next turn. Validates structure + emptiness;
 * does NOT run a Claude turn.
 */
export async function editOutline(
  input: EditOutlineInput,
): Promise<OutlineConversationWithMessages> {
  const { conversation } = await getOutlineConversation(input.conversationId);
  if (conversation.approvedAt) {
    throw new ConflictError(
      'Outline has already been approved; further edits use the AI editor',
      'outline_already_approved',
    );
  }

  const cleaned = sanitizeOutline(input.outline);

  await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: {
        kind: 'edit',
        text: 'I edited the outline directly.',
        outline: cleaned,
      } satisfies OutlineUserContent as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.aIConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return getOutlineConversation(conversation.id);
}

/**
 * Normalize a user-submitted outline: trim strings, drop empty data points,
 * renumber ids to s1..sN so the scaffold guarantees match (see
 * `buildOutlineFiles`). Throws ValidationError on structural problems.
 */
function sanitizeOutline(outline: OutlineDraft): OutlineDraft {
  if (!outline || !Array.isArray(outline.slides) || outline.slides.length === 0) {
    throw new ValidationError('Outline must include at least one slide', 'empty_outline');
  }
  if (outline.slides.length > 50) {
    throw new ValidationError('Outline cannot exceed 50 slides', 'outline_too_long');
  }
  const slides: OutlineSlide[] = outline.slides.map((s, i) => {
    const title = (s.title ?? '').trim();
    const notes = (s.notes ?? '').trim();
    if (!title) {
      throw new ValidationError(`Slide ${i + 1} is missing a title`, 'slide_title_required');
    }
    if (!notes) {
      throw new ValidationError(`Slide ${i + 1} is missing notes`, 'slide_notes_required');
    }
    if (title.length > 200) {
      throw new ValidationError(
        `Slide ${i + 1} title is too long (max 200 chars)`,
        'slide_title_too_long',
      );
    }
    if (notes.length > 2000) {
      throw new ValidationError(
        `Slide ${i + 1} notes are too long (max 2000 chars)`,
        'slide_notes_too_long',
      );
    }
    const layoutHint = s.layoutHint?.trim() || null;
    const dataPoints = (s.dataPoints ?? []).map((d) => d.trim()).filter((d) => d.length > 0);
    return {
      id: `s${i + 1}`,
      title,
      notes,
      ...(layoutHint ? { layoutHint } : {}),
      ...(dataPoints.length ? { dataPoints } : {}),
    };
  });
  return { slides };
}

// ---------------------------------------------------------------------------
// Internal: one Claude turn + persist assistant message
// ---------------------------------------------------------------------------

interface RunOutlineTurnInput {
  conversationId: string;
  requestId?: string;
}

async function runOutlineTurn(input: RunOutlineTurnInput): Promise<void> {
  const messages = await prisma.aIMessage.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { createdAt: 'asc' },
  });
  const history = buildOutlineHistory(messages);

  let content: OutlineAssistantContent;
  let model: string | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let costCents: number | null = null;

  try {
    const turn = await generateOutlineTurn(history, { requestId: input.requestId });
    model = turn.model;
    tokensIn = turn.tokensIn;
    tokensOut = turn.tokensOut;
    costCents = turn.costCents;
    if (turn.payload) {
      content = { kind: 'assistant', raw: turn.raw, payload: turn.payload };
    } else {
      content = {
        kind: 'assistant_error',
        raw: turn.raw,
        userMessage: 'I had trouble producing a valid outline. Could you rephrase?',
        error: { kind: 'parse', message: turn.parseError ?? 'unknown parse error' },
      };
    }
  } catch (err) {
    const message = (err as Error).message;
    content = {
      kind: 'assistant_error',
      raw: '',
      userMessage: 'Something went wrong reaching the model. Try again in a moment.',
      error: { kind: 'gateway', message },
    };
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'outline',
        event: 'gateway_error',
        conversationId: input.conversationId,
        requestId: input.requestId ?? null,
        message,
      }),
    );
  }

  await prisma.aIMessage.create({
    data: {
      conversationId: input.conversationId,
      role: 'ASSISTANT',
      content: content as unknown as Prisma.InputJsonValue,
      model,
      tokensIn,
      tokensOut,
      costCents,
    },
  });
  await prisma.aIConversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Approve: scaffold slide stubs from the latest outline
// ---------------------------------------------------------------------------

export interface ApproveOutlineInput {
  conversationId: string;
  user: User;
}

export interface ApproveOutlineResult {
  deck: Deck;
  commitSha: string;
  slideCount: number;
}

/**
 * Render the approved outline into the deck's git repo. Writes one slide
 * HTML stub per outline.slide with the title rendered in an <h1> and the
 * notes/dataPoints/layoutHint preserved as HTML comments for the AI editor
 * to pick up later. Rewrites deck.json to match. Direct commit on `main`
 * — outline approval is the only time we treat a generated artifact as
 * "trusted enough to ship without a proposal/review loop", and the deck is
 * still in OUTLINE/DRAFT stage so nobody is sharing it yet.
 */
export async function approveOutline(input: ApproveOutlineInput): Promise<ApproveOutlineResult> {
  const { conversation, deck, messages } = await getOutlineConversation(input.conversationId);
  if (conversation.approvedAt) {
    throw new ConflictError('Outline already approved', 'outline_already_approved');
  }
  const outline = findLatestOutline(messages);
  if (!outline) {
    throw new ValidationError(
      'No outline has been drafted yet — chat with the AI to produce one first',
      'no_outline_yet',
    );
  }

  const files = buildOutlineFiles(deck.title, outline);
  const commitSha = await commitOutlineScaffold({
    repoPath: deck.repoPath,
    user: input.user,
    files,
    outlineConversationId: conversation.id,
  });

  // Drop the bundle cache for the prior head (single-slide starter) since
  // its commit is no longer reachable as the deck's head.
  if (deck.headCommitSha) {
    await invalidateCachedBundle(deck.id, deck.headCommitSha, deck.brandKitVersionId);
  }

  const updatedDeck = await prisma.deck.update({
    where: { id: deck.id },
    data: { headCommitSha: commitSha, lifecycleStage: 'DRAFT' },
  });
  await prisma.aIConversation.update({
    where: { id: conversation.id },
    data: { approvedAt: new Date() },
  });

  return { deck: updatedDeck, commitSha, slideCount: outline.slides.length };
}

// ---------------------------------------------------------------------------
// Scaffold helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Build the file map (relative path -> contents) that an approved outline
 * scaffolds into. Includes a fresh deck.json with the new slide list and
 * one slide HTML stub per outline.slide.
 *
 * Note: we do NOT clean up orphan slide files from the starter scaffold.
 * The starter only ever has `slides/s1.html`, and any approved outline
 * always emits `s1` as its first slide (the parser guarantees ids
 * `s1..sN`), so this works in practice. If outline approval is ever
 * re-allowed on non-starter decks, this needs a tree-aware diff.
 */
export function buildOutlineFiles(
  deckTitle: string,
  outline: OutlineDraft,
): Record<string, string> {
  const manifestSlides = outline.slides.map((s) => ({
    id: s.id,
    title: s.title,
    notes: s.notes,
    ...(s.layoutHint ? { layoutHint: s.layoutHint } : {}),
    ...(s.dataPoints && s.dataPoints.length ? { dataPoints: s.dataPoints } : {}),
  }));
  const manifest = { title: deckTitle, slides: manifestSlides };

  const files: Record<string, string> = {
    'deck.json': JSON.stringify(manifest, null, 2) + '\n',
  };
  for (const slide of outline.slides) {
    files[`slides/${slide.id}.html`] = renderSlideStub(slide);
  }
  return files;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeHtmlComment(s: string): string {
  // HTML comments can't contain `--`. Replace with en-dash to keep meaning.
  return s.replaceAll('--', '\u2013\u2013');
}

function renderSlideStub(slide: OutlineSlide): string {
  const dataAttrs = [
    `class="slide"`,
    `data-slide-id="${escapeHtml(slide.id)}"`,
    `data-slide-title="${escapeHtml(slide.title)}"`,
    ...(slide.layoutHint ? [`data-layout="${escapeHtml(slide.layoutHint)}"`] : []),
  ].join(' ');

  const commentParts: string[] = [`Outline notes: ${slide.notes}`];
  if (slide.layoutHint) commentParts.push(`Layout hint: ${slide.layoutHint}`);
  if (slide.dataPoints && slide.dataPoints.length) {
    commentParts.push('Data points:');
    for (const d of slide.dataPoints) commentParts.push(`  - ${d}`);
  }
  const comment = escapeHtmlComment(commentParts.join('\n  '));

  return [
    `<section ${dataAttrs}>`,
    `  <!--`,
    `  ${comment}`,
    `  -->`,
    `  <h1>${escapeHtml(slide.title)}</h1>`,
    `</section>`,
    '',
  ].join('\n');
}

interface CommitOutlineScaffoldInput {
  repoPath: string;
  user: User;
  files: Record<string, string>;
  outlineConversationId: string;
}

async function commitOutlineScaffold(input: CommitOutlineScaffoldInput): Promise<string> {
  const git = simpleGit({ baseDir: input.repoPath });
  await git.checkout('main');

  for (const [relPath, contents] of Object.entries(input.files)) {
    const abs = path.join(input.repoPath, relPath);
    // Defense in depth: the file map keys are application-controlled, but
    // confirm none escape the repo root before writing.
    const resolved = path.resolve(input.repoPath, relPath);
    if (!resolved.startsWith(path.resolve(input.repoPath) + path.sep)) {
      throw new Error(`outline scaffold: path escapes repo: ${relPath}`);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contents, 'utf8');
    await git.add(relPath);
  }

  await git.commit(
    `Scaffold approved outline (${input.outlineConversationId.slice(0, 8)})`,
    undefined,
    { '--author': `${input.user.name} <${input.user.email}>` },
  );
  return (await git.revparse(['HEAD'])).trim();
}
