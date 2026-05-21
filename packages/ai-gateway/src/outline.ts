// Outline-first deck generation (Phase 2.5).
//
// The outline flow is a structured chat: the user supplies a brief (title,
// audience, goal, talking points + optional tone / target slide count /
// brand kit), then Claude either proposes a full outline, asks a single
// clarifying question, or responds to feedback. Each assistant turn returns
// strict JSON; the caller picks the shape apart and renders it.
//
// We intentionally do NOT share the AI-editor response schema — the outline
// stage produces no file edits, only structured narrative metadata. Slide
// stubs are scaffolded by the application after the user clicks "Approve",
// not by Claude directly.

import { callModel } from './gateway';
import { defaultAnthropicModel } from './providers/anthropic';
import type { CallClaudeOptions, ClaudeMessage } from './types';

export interface OutlineBrief {
  title: string;
  audience: string;
  goal: string;
  talkingPoints: string;
  /** Optional. Free text — "formal", "punchy pitch", "conversational". */
  tone?: string | null;
  /** Optional. Suggested slide count; Claude is told this is a hint. */
  targetSlideCount?: number | null;
  /** Optional. Brand-kit voice + identity snippet inlined into the system prompt. */
  brandContext?: string | null;
}

export interface OutlineSlide {
  /**
   * Stable id Claude assigns. Must match /^s\d+$/ so the scaffold layer can
   * map directly to slides/{id}.html filenames without re-numbering.
   */
  id: string;
  title: string;
  /** 1-3 sentence narrative for the slide. */
  notes: string;
  /**
   * Suggested layout key. Free string today; Phase 3 will tie this to the
   * pattern library catalog so the AI editor can drop a pattern in directly.
   */
  layoutHint?: string | null;
  /** Optional bullet-point key data points / facts to include. */
  dataPoints?: string[];
}

export interface OutlineDraft {
  slides: OutlineSlide[];
}

export type OutlineTurnPayload =
  | { kind: 'outline'; message: string; outline: OutlineDraft }
  | { kind: 'question'; message: string }
  | { kind: 'message'; message: string };

export interface OutlineTurnResponse {
  /** Parsed payload, or null if parsing failed. */
  payload: OutlineTurnPayload | null;
  /** Raw model output. Useful for debugging + replaying history. */
  raw: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  parseError?: string;
}

const OUTLINE_SYSTEM_PROMPT = [
  'You are an expert presentation strategist helping a consultant from BIP draft',
  'the OUTLINE for a bespoke web-based deck. You do not write slide HTML — that',
  'happens in a later AI-editing stage. Your job is the narrative skeleton.',
  '',
  '## Output contract',
  '',
  'Every response is a single JSON object, no prose around it, no markdown',
  'fences. Pick exactly one of three shapes:',
  '',
  '1. Outline proposal / refinement (the common case):',
  '```',
  '{',
  '  "kind": "outline",',
  '  "message": "Short note to the user about what changed or why.",',
  '  "outline": {',
  '    "slides": [',
  '      {',
  '        "id": "s1",',
  '        "title": "Cover",',
  '        "notes": "1-3 sentences of narrative.",',
  '        "layoutHint": "cover" | "title-and-body" | "two-column" | "stat" | "quote" | "chart" | "section-divider" | ...,',
  '        "dataPoints": ["optional", "key", "facts"]',
  '      }',
  '    ]',
  '  }',
  '}',
  '```',
  '',
  '2. Clarifying question (use sparingly, only when truly blocked):',
  '```',
  '{ "kind": "question", "message": "One concise question." }',
  '```',
  '',
  '3. Plain reply to non-outline chat ("looks good", "thanks"):',
  '```',
  '{ "kind": "message", "message": "Short reply." }',
  '```',
  '',
  '## Rules for outlines',
  '',
  '- Slide ids are `s1`, `s2`, ... — sequential, no gaps, lowercase `s`.',
  '- Always emit the FULL outline. If the user asks to edit one slide, return',
  '  every slide in order with that one updated.',
  '- Aim for the requested slide count (±2). If the user gave none, default',
  '  to 8-12 for a pitch, 5-7 for a quick update.',
  '- `notes` is what the presenter would say — narrative, not bullet titles.',
  '- `dataPoints` is optional; include only when the slide hinges on specific',
  '  numbers, quotes, or facts the author should source.',
  '- `layoutHint` is your best guess; the author can change it. Use short',
  '  lowercase-hyphen-case strings.',
  '',
  '## Style',
  '',
  '- Audience-first. Match the requested tone.',
  '- Tight, specific narrative. No filler like "we will discuss".',
  '- Open with a strong cover, end with a clear call-to-action or next step.',
].join('\n');

function briefAsUserMessage(brief: OutlineBrief): string {
  const parts: string[] = [
    '# Brief',
    `Title: ${brief.title}`,
    `Audience: ${brief.audience}`,
    `Goal: ${brief.goal}`,
    '',
    '## Key talking points',
    brief.talkingPoints,
  ];
  if (brief.tone) parts.push('', `## Tone`, brief.tone);
  if (brief.targetSlideCount != null) {
    parts.push('', `## Target slide count`, String(brief.targetSlideCount));
  }
  if (brief.brandContext) parts.push('', '## Brand context', brief.brandContext);
  parts.push('', 'Please propose a first-draft outline.');
  return parts.join('\n');
}

/**
 * Build the assembled system prompt for the outline conversation. Caller
 * may pass `brandContext` to inline brand voice/identity hints; we keep it
 * separate from `OUTLINE_SYSTEM_PROMPT` so the base prompt stays cacheable.
 */
export function buildOutlineSystemPrompt(brandContext?: string | null): string {
  if (!brandContext) return OUTLINE_SYSTEM_PROMPT;
  return [OUTLINE_SYSTEM_PROMPT, '', '## Brand context', brandContext].join('\n');
}

/** Convert a brief into the initial user message that opens the chat. */
export function buildOutlineKickoff(brief: OutlineBrief): ClaudeMessage {
  return { role: 'user', content: briefAsUserMessage(brief) };
}

function parseOutlineTurn(
  raw: string,
): { ok: true; value: OutlineTurnPayload } | { ok: false; error: string } {
  // Tolerate accidental markdown fences from Claude.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, error: `JSON parse: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Response is not an object' };
  }
  const obj = parsed as Record<string, unknown>;
  const kind = obj.kind;
  const message = typeof obj.message === 'string' ? obj.message : '';
  if (kind === 'outline') {
    const outline = obj.outline;
    if (!outline || typeof outline !== 'object') {
      return { ok: false, error: 'outline field missing' };
    }
    const slidesRaw = (outline as Record<string, unknown>).slides;
    if (!Array.isArray(slidesRaw) || slidesRaw.length === 0) {
      return { ok: false, error: 'outline.slides must be a non-empty array' };
    }
    const slides: OutlineSlide[] = [];
    for (let i = 0; i < slidesRaw.length; i++) {
      const s = slidesRaw[i];
      if (!s || typeof s !== 'object') {
        return { ok: false, error: `slide ${i} is not an object` };
      }
      const so = s as Record<string, unknown>;
      const id = typeof so.id === 'string' ? so.id : `s${i + 1}`;
      if (!/^s\d+$/.test(id)) {
        return { ok: false, error: `slide ${i} id "${id}" must match /^s\\d+$/` };
      }
      const title = typeof so.title === 'string' ? so.title.trim() : '';
      const notes = typeof so.notes === 'string' ? so.notes.trim() : '';
      if (!title) return { ok: false, error: `slide ${i} title is empty` };
      const layoutHint =
        typeof so.layoutHint === 'string' && so.layoutHint.trim() ? so.layoutHint.trim() : null;
      let dataPoints: string[] | undefined;
      if (Array.isArray(so.dataPoints)) {
        dataPoints = so.dataPoints.filter((p): p is string => typeof p === 'string');
      }
      slides.push({ id, title, notes, layoutHint, dataPoints });
    }
    return { ok: true, value: { kind: 'outline', message, outline: { slides } } };
  }
  if (kind === 'question') {
    return { ok: true, value: { kind: 'question', message } };
  }
  if (kind === 'message') {
    return { ok: true, value: { kind: 'message', message } };
  }
  return { ok: false, error: `unknown kind "${String(kind)}"` };
}

/**
 * One outline-chat turn. Caller supplies the full message history (oldest
 * first). The system prompt is rebuilt on every call; the brief is the
 * first user message, not a system block, so subsequent turns can refer
 * back to it naturally.
 */
export async function generateOutlineTurn(
  messages: ClaudeMessage[],
  options: CallClaudeOptions & { brandContext?: string | null } = {},
): Promise<OutlineTurnResponse> {
  if (process.env.ANTHROPIC_API_KEY === 'mock') {
    return mockOutlineResponse(messages, options);
  }
  const systemPrompt = buildOutlineSystemPrompt(options.brandContext);
  // Slightly higher token cap than the editor turn — a 12-slide outline
  // with notes + dataPoints lands around 3-4k tokens.
  const response = await callModel('OUTLINE', messages, {
    ...options,
    systemPrompt,
    maxTokens: options.maxTokens ?? 4096,
  });
  const parsed = parseOutlineTurn(response.content);
  return {
    payload: parsed.ok ? parsed.value : null,
    raw: response.content,
    model: response.model,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    costCents: response.costCents,
    parseError: parsed.ok ? undefined : parsed.error,
  };
}

function mockOutlineResponse(
  messages: ClaudeMessage[],
  options: CallClaudeOptions,
): OutlineTurnResponse {
  // Deterministic mock: pull a few words from the first user message and
  // produce a fixed 5-slide outline that round-trips parse + scaffold.
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  const titleMatch = /Title:\s*(.+)/.exec(firstUser);
  const title = titleMatch?.[1]?.trim().slice(0, 80) || 'Mock Deck';
  const payload: OutlineTurnPayload = {
    kind: 'outline',
    message: 'Mock outline draft based on your brief.',
    outline: {
      slides: [
        { id: 's1', title: `${title} — Cover`, notes: 'Opening cover slide.', layoutHint: 'cover' },
        {
          id: 's2',
          title: 'Context',
          notes: 'Why this matters now.',
          layoutHint: 'title-and-body',
        },
        {
          id: 's3',
          title: 'Approach',
          notes: 'How we propose to tackle it.',
          layoutHint: 'two-column',
        },
        {
          id: 's4',
          title: 'Impact',
          notes: 'Expected outcome and metrics.',
          layoutHint: 'stat',
          dataPoints: ['+X%', '-Y days'],
        },
        {
          id: 's5',
          title: 'Next steps',
          notes: 'Specific call to action.',
          layoutHint: 'title-and-body',
        },
      ],
    },
  };
  const raw = JSON.stringify(payload);
  return {
    payload,
    raw,
    model: options.model ?? defaultAnthropicModel(),
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
  };
}

/** Re-exported for service / test use. */
export const __outline_internals = { parseOutlineTurn };
