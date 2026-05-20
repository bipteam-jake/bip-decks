// Anthropic-only AI gateway for Phase 1.
//
// Per docs/bip-deck-platform-architecture.md §3.3 and ai-editor.md §13, this
// package is the single seam future phases will reach through to plug in
// OpenAI / Google adapters and to route per task. Phase 1 ships only Claude
// Sonnet with a single shape: `callClaude(messages, systemPrompt)`.
//
// Callers are responsible for persisting the response (AIMessage rows) and
// for wrapping this in a per-request timeout. The gateway itself returns
// rich metadata (model, tokens, cents) so callers don't have to guess.

import Anthropic from '@anthropic-ai/sdk';

export type MessageRole = 'user' | 'assistant';

export interface ClaudeMessage {
  role: MessageRole;
  content: string;
}

export interface ClaudeResponse {
  /** Raw model output. AI-editor responses are strict JSON; parsing is the caller's job. */
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Estimated cost in cents (integer, rounded). Uses the price table below. */
  costCents: number;
  /** anthropic stop reason: end_turn | max_tokens | stop_sequence | tool_use */
  stopReason: string | null;
}

export interface CallClaudeOptions {
  /** Override the default model. Phase 1 uses ANTHROPIC_DEFAULT_MODEL. */
  model?: string;
  /**
   * Max tokens to generate. Default 16000 — Sonnet 4.5 supports up to 64K
   * output, and AI-editor turns frequently rewrite full slide HTML files,
   * so a small budget causes mid-JSON truncation. Callers may go higher
   * (up to the model max) for big edits.
   */
  maxTokens?: number;
  /**
   * Hard timeout in ms. Default 180s — large output budgets can take
   * 1–3 minutes to stream from Anthropic. Callers using >32K tokens should
   * raise this further.
   */
  timeoutMs?: number;
  /** Optional id propagated through logs. */
  requestId?: string;
}

/**
 * Per-million-token USD prices, keyed by model name prefix. Used only for
 * cost estimation written to AIMessage.cost_cents — billing of record is
 * Anthropic's invoice. Update when Anthropic changes pricing or we switch
 * models. Unknown models fall through to a conservative default with a
 * warning so we notice and add a real row.
 */
const PRICE_TABLE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
};
const DEFAULT_PRICE = { input: 3, output: 15 };

function priceFor(model: string): { input: number; output: number } {
  for (const prefix of Object.keys(PRICE_TABLE_USD_PER_MTOK)) {
    if (model.startsWith(prefix)) return PRICE_TABLE_USD_PER_MTOK[prefix]!;
  }
  // eslint-disable-next-line no-console
  console.warn(`[ai-gateway] No price row for model "${model}", using default $3/$15.`);
  return DEFAULT_PRICE;
}

function computeCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const { input, output } = priceFor(model);
  const dollars = (input * tokensIn + output * tokensOut) / 1_000_000;
  return Math.round(dollars * 100);
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'replace-me') {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to apps/web/.env.local (see .env.example).',
    );
  }
  return new Anthropic({ apiKey });
}

function defaultModel(): string {
  return process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-sonnet-4-5';
}

/**
 * Phase 1 single-shot call to Claude. `systemPrompt` maps to Anthropic's
 * top-level `system` field (not a message role). Returns the first text
 * content block joined, with usage and cost folded in.
 */
export async function callClaude(
  messages: ClaudeMessage[],
  systemPrompt: string,
  options: CallClaudeOptions = {},
): Promise<ClaudeResponse> {
  // Test-only short-circuit. When ANTHROPIC_API_KEY === 'mock' we never
  // contact Anthropic and instead return a deterministic canned proposal.
  // Used by Playwright smoke tests so they don't spend tokens or depend on
  // network reachability. Not a Phase 2 mock framework — just enough to
  // exercise the proposal -> accept pipeline.
  if (process.env.ANTHROPIC_API_KEY === 'mock') {
    return mockClaudeResponse(messages, options);
  }
  const client = getClient();
  const model = options.model ?? defaultModel();
  const maxTokens = options.maxTokens ?? 16_000;
  const timeoutMs = options.timeoutMs ?? 180_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    // Use the SDK's streaming helper rather than `messages.create`. The
    // non-streaming endpoint refuses any request whose estimated runtime
    // exceeds 10 minutes — which trips immediately at our 32K/64K output
    // budgets even when the actual response is fast. Streaming has no such
    // limit. We still wait for the final assembled Message so callers see
    // the same shape; the network just stays open the whole time.
    const stream = client.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal: controller.signal },
    );
    const result = await stream.finalMessage();

    const text = result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const tokensIn = result.usage.input_tokens;
    const tokensOut = result.usage.output_tokens;
    const costCents = computeCostCents(result.model, tokensIn, tokensOut);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'claude_call_ok',
        requestId: options.requestId ?? null,
        model: result.model,
        tokensIn,
        tokensOut,
        costCents,
        latencyMs: Date.now() - startedAt,
        stopReason: result.stop_reason,
      }),
    );

    return {
      content: text,
      model: result.model,
      tokensIn,
      tokensOut,
      costCents,
      stopReason: result.stop_reason,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'claude_call_err',
        requestId: options.requestId ?? null,
        model,
        latencyMs: Date.now() - startedAt,
        error: (err as Error).message,
      }),
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic mock proposal returned when ANTHROPIC_API_KEY === 'mock'.
 * The shape matches the strict-JSON contract from ai-editor.md §6 so the
 * response-parser accepts it. The slide payload contains the user's prompt
 * verbatim so smoke tests can assert the round-trip.
 */
function mockClaudeResponse(messages: ClaudeMessage[], options: CallClaudeOptions): ClaudeResponse {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const safe = lastUser.replace(/[<>&"]/g, ' ').slice(0, 200);
  const payload = {
    explanation: 'Mock proposal: applied your request to slide 1.',
    changes: [
      {
        file: 'slides/s1.html',
        operation: 'replace' as const,
        content: `<section class="slide" data-slide-id="s1" data-slide-title="Mock">\n  <h1>${safe || 'Mock slide'}</h1>\n</section>\n`,
      },
    ],
  };
  const content = JSON.stringify(payload);
  const model = options.model ?? defaultModel();
  return {
    content,
    model,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    stopReason: 'end_turn',
  };
}

// ---------------------------------------------------------------------------
// Brand-kit extraction from PDF (Phase 2.1d)
// ---------------------------------------------------------------------------
//
// Claude vision reads a brand guidelines PDF and proposes a structured token
// + voice draft the wizard renders for human review. The gateway exposes an
// async generator so the API route can stream progress events as Server-Sent
// Events without blocking on the full call. The wizard never trusts the
// shape — it re-validates with `BrandTokensSchema` / `BrandVoiceSchema`
// downstream.
//
// Cost model: we charge the document plus the small instruction as one
// claude.messages.create call. Anthropic counts PDF pages as ~1750 tokens
// each.

export interface ExtractedBrandKit {
  /** Unvalidated token tree shaped to match BrandTokens. */
  tokens: unknown;
  /** Unvalidated voice tree shaped to match BrandVoice. */
  voice: unknown;
  /** Free-form notes Claude wrote about the kit (e.g. inferred industry). */
  notes: string;
}

export type ExtractBrandKitProgress =
  | { kind: 'status'; message: string }
  | {
      kind: 'done';
      result: ExtractedBrandKit;
      tokensIn: number;
      tokensOut: number;
      costCents: number;
      model: string;
    }
  | { kind: 'error'; message: string };

export interface ExtractBrandKitInput {
  /** Raw PDF bytes. The wizard enforces the 32 MB Anthropic limit upstream. */
  pdf: Uint8Array;
  filename: string;
}

export interface ExtractBrandKitOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  requestId?: string;
}

const EXTRACT_SYSTEM_PROMPT = `You extract a structured brand kit from a brand-guidelines PDF.

Output ONLY a single JSON object — no prose, no markdown fences — matching this exact shape:

{
  "tokens": {
    "colors": { "<kebab-key>": "<hex|rgb()|hsl()|oklch()>", ... },
    "type": {
      "fontFamilies": { "<kebab-key>": "<css font-family value>", ... },
      "scale": { "<kebab-key>": "<css size, e.g. 1rem>", ... }
    },
    "spacing": { "<kebab-key>": "<css length>", ... },
    "radius": { "<kebab-key>": "<css length>", ... },
    "motion": { "<kebab-key>": "<css transition timing, e.g. 150ms ease>", ... }
  },
  "voice": {
    "tone": "1-3 sentences",
    "terminology": "preferred terms / capitalization rules",
    "dos": "do guidelines",
    "donts": "don't guidelines"
  },
  "notes": "free-form short summary of inferred industry, audience, etc."
}

Rules:
- All keys lowercase letters, digits, hyphens only.
- Color values must be valid CSS color tokens (hex #RRGGBB, rgb(), hsl(), oklch()).
- If a section is not in the PDF, return an empty object {} (or empty string for voice fields), do NOT guess.
- Prefer descriptive keys: primary, accent, ink, paper, danger; display, body, mono; xs, sm, md, lg, xl; etc.
- Output strict JSON. No trailing commas. No comments.`;

/**
 * Extract a brand kit from a PDF and stream progress events. Honors
 * `ANTHROPIC_API_KEY === 'mock'` by yielding deterministic events with a
 * canned palette so Playwright tests don't hit the network.
 */
export async function* extractBrandKitFromPdf(
  input: ExtractBrandKitInput,
  options: ExtractBrandKitOptions = {},
): AsyncGenerator<ExtractBrandKitProgress, void, unknown> {
  if (process.env.ANTHROPIC_API_KEY === 'mock') {
    yield* mockExtractBrandKitFromPdf(input, options);
    return;
  }

  yield { kind: 'status', message: `Uploading "${input.filename}" to Claude…` };

  const client = getClient();
  const model = options.model ?? defaultModel();
  const maxTokens = options.maxTokens ?? 4096;
  const timeoutMs = options.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    yield { kind: 'status', message: 'Analyzing brand guidelines (this can take a minute)…' };
    const base64 = Buffer.from(input.pdf).toString('base64');
    const result = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 },
              },
              {
                type: 'text',
                text: 'Extract the brand kit from this PDF and return the JSON described in the system prompt.',
              },
            ],
          },
        ],
      },
      { signal: controller.signal },
    );

    const text = result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const tokensIn = result.usage.input_tokens;
    const tokensOut = result.usage.output_tokens;
    const costCents = computeCostCents(result.model, tokensIn, tokensOut);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'extract_brand_kit_ok',
        requestId: options.requestId ?? null,
        model: result.model,
        tokensIn,
        tokensOut,
        costCents,
        latencyMs: Date.now() - startedAt,
      }),
    );

    yield { kind: 'status', message: 'Parsing extracted JSON…' };
    let parsed: ExtractedBrandKit;
    try {
      parsed = parseExtractedBrandKit(text);
    } catch (err) {
      yield { kind: 'error', message: `Claude returned malformed JSON: ${(err as Error).message}` };
      return;
    }

    yield {
      kind: 'done',
      result: parsed,
      tokensIn,
      tokensOut,
      costCents,
      model: result.model,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'extract_brand_kit_err',
        requestId: options.requestId ?? null,
        model,
        latencyMs: Date.now() - startedAt,
        error: (err as Error).message,
      }),
    );
    yield { kind: 'error', message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Tolerant JSON extractor — strips ```json fences if Claude ignored the rule. */
function parseExtractedBrandKit(raw: string): ExtractedBrandKit {
  let body = raw.trim();
  // Strip ```json … ``` fences defensively.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(body);
  if (fence && fence[1]) body = fence[1].trim();
  // Fall back to the first {...} block if there's leading prose.
  if (!body.startsWith('{')) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('no JSON object found in response');
    }
    body = body.slice(start, end + 1);
  }
  const obj = JSON.parse(body) as Record<string, unknown>;
  return {
    tokens: obj.tokens ?? {},
    voice: obj.voice ?? {},
    notes: typeof obj.notes === 'string' ? obj.notes : '',
  };
}

async function* mockExtractBrandKitFromPdf(
  input: ExtractBrandKitInput,
  options: ExtractBrandKitOptions,
): AsyncGenerator<ExtractBrandKitProgress, void, unknown> {
  yield { kind: 'status', message: `Uploading "${input.filename}" to Claude…` };
  // Tiny delay so the UI gets to show the status before the next event in
  // tests that consume the iterator quickly.
  await new Promise((r) => setTimeout(r, 50));
  yield { kind: 'status', message: 'Analyzing brand guidelines (mock mode)…' };
  await new Promise((r) => setTimeout(r, 50));
  yield { kind: 'status', message: 'Extracting tokens and voice…' };
  await new Promise((r) => setTimeout(r, 50));
  const result: ExtractedBrandKit = {
    tokens: {
      colors: {
        primary: '#0f1140',
        accent: '#ff6f4f',
        ink: '#111111',
        paper: '#ffffff',
      },
      type: {
        fontFamilies: {
          display: 'Barlow, sans-serif',
          body: 'Barlow, sans-serif',
        },
        scale: {
          sm: '0.875rem',
          md: '1rem',
          lg: '1.25rem',
          xl: '2rem',
        },
      },
      spacing: { sm: '0.5rem', md: '1rem', lg: '2rem' },
      radius: { sm: '0.25rem', md: '0.5rem' },
      motion: { fast: '150ms ease', base: '250ms ease' },
    },
    voice: {
      tone: 'Confident, direct, optimistic.',
      terminology: 'Use "portfolio" not "investments". Capitalize Product names.',
      dos: 'Lead with outcomes. Use active voice.',
      donts: 'No jargon. No hedging.',
    },
    notes: 'Mock extraction — not a real brand guidelines analysis.',
  };
  yield {
    kind: 'done',
    result,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    model: options.model ?? defaultModel(),
  };
}

// ---------------------------------------------------------------------------
// Pattern library augmentation (Phase 2.2)
// ---------------------------------------------------------------------------
//
// When a deck is bound to a brand-kit version that has approved patterns,
// the AI editor's system prompt is augmented with a catalog of those
// patterns so Claude can reach for them by slug instead of re-deriving the
// layout. This is a string-builder only — fetching patterns is the
// service-layer caller's responsibility (so the gateway stays free of a
// Prisma dependency).

export interface PatternCatalogEntry {
  slug: string;
  name: string;
  description: string | null;
  category: string;
  /** Declared parameters; serialized as a compact JSON block in the prompt. */
  parameters: unknown;
}

/**
 * Append a "Pattern library" block to a base system prompt. If `patterns`
 * is empty, returns the base prompt unchanged so we don't waste tokens on
 * an empty header.
 *
 * The block is deliberately terse — Claude only needs slug, name, the
 * one-line description, and the parameter shape. Full HTML/CSS templates
 * stay in the database and are inlined into deck files when the AI's
 * proposal references a pattern slug (handled by the proposal pipeline,
 * not here).
 */
export function buildPatternSystemPrompt(
  basePrompt: string,
  patterns: PatternCatalogEntry[],
): string {
  if (patterns.length === 0) return basePrompt;
  const lines: string[] = [
    '',
    '## Pattern library',
    '',
    'The following on-brand slide patterns are available for this deck. Prefer',
    'reusing a pattern over hand-rolling a layout when a user asks for a slide',
    'type that matches one. Reference a pattern by its slug in your',
    'explanation (e.g. "Used pattern `cover-with-image`"). Each pattern accepts',
    'the listed parameters; supply values inline when you instantiate one.',
    '',
  ];
  for (const p of patterns) {
    lines.push(`### \`${p.slug}\` — ${p.name}`);
    if (p.description) lines.push(p.description);
    lines.push(`Category: ${p.category}`);
    lines.push('Parameters:');
    lines.push('```json');
    lines.push(JSON.stringify(p.parameters, null, 2));
    lines.push('```');
    lines.push('');
  }
  return `${basePrompt}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Brand-kit context block (Phase 2.x: brand-aware editing)
// ---------------------------------------------------------------------------
//
// When a deck is bound to a brand-kit version, prepend a compact "Brand kit"
// section to the system prompt summarizing the kit's identity: kit name +
// optional one-line summary, the color palette (token name + value), the
// font families, and any voice rules. The bundler already injects matching
// `--brand-*` CSS custom properties at render time, so Claude is told to
// reach for those vars (not raw hex) when authoring CSS. Identity assets
// (logo etc.) are listed by kind only — the proposal layer can later wire
// in actual URLs once asset serving stabilizes.
//
// Returns the base prompt unchanged when there is no usable context, to
// keep token usage down for kits that are bound but empty.

export interface BrandContext {
  /** Kit display name (e.g. "BIP House Brand"). */
  kitName: string;
  /** Version label (e.g. "v3") — helps Claude reason about which kit is live. */
  versionLabel: string;
  /** Optional one-line human summary from BrandKitVersion.summary. */
  summary?: string | null;
  /** Color palette: { tokenName -> hex/functional color }. */
  colors: Record<string, string>;
  /** Font families: { tokenName -> CSS family stack }. */
  fontFamilies: Record<string, string>;
  /** Voice rules. Empty strings allowed; rendered only when non-empty. */
  voice: {
    tone: string;
    terminology: string;
    dos: string;
    donts: string;
  };
  /** Distinct identity-asset kinds present in the kit (e.g. ["LOGO_FULL_COLOR", "FAVICON"]). */
  identityAssetKinds: string[];
}

export function buildBrandContextSystemPrompt(basePrompt: string, ctx: BrandContext): string {
  const colorEntries = Object.entries(ctx.colors).sort(([a], [b]) => a.localeCompare(b));
  const familyEntries = Object.entries(ctx.fontFamilies).sort(([a], [b]) => a.localeCompare(b));
  const hasVoice =
    ctx.voice.tone.trim() ||
    ctx.voice.terminology.trim() ||
    ctx.voice.dos.trim() ||
    ctx.voice.donts.trim();
  if (
    colorEntries.length === 0 &&
    familyEntries.length === 0 &&
    !hasVoice &&
    ctx.identityAssetKinds.length === 0 &&
    !ctx.summary
  ) {
    return basePrompt;
  }
  const lines: string[] = [
    '',
    '## Brand kit',
    '',
    `This deck is bound to **${ctx.kitName}** (${ctx.versionLabel}).`,
    'Honor it. Reach for the design tokens below — the runtime already injects',
    'matching CSS custom properties, so authored CSS should reference them as',
    '`var(--brand-color-<name>)`, `var(--brand-type-family-<name>)`, etc., rather',
    'than hard-coding hex values or font stacks. New CSS you propose must use',
    'these variables wherever a brand decision applies.',
    '',
  ];
  if (ctx.summary) {
    lines.push(`Summary: ${ctx.summary}`, '');
  }
  if (colorEntries.length) {
    lines.push('### Colors');
    for (const [k, v] of colorEntries) {
      lines.push(`- \`--brand-color-${k}\` → ${v}`);
    }
    lines.push('');
  }
  if (familyEntries.length) {
    lines.push('### Fonts');
    for (const [k, v] of familyEntries) {
      lines.push(`- \`--brand-type-family-${k}\` → ${v}`);
    }
    lines.push('');
  }
  if (ctx.identityAssetKinds.length) {
    lines.push('### Identity assets available');
    for (const k of ctx.identityAssetKinds) lines.push(`- ${k}`);
    lines.push('');
  }
  if (hasVoice) {
    lines.push('### Voice');
    if (ctx.voice.tone.trim()) lines.push(`- **Tone:** ${ctx.voice.tone.trim()}`);
    if (ctx.voice.terminology.trim())
      lines.push(`- **Terminology:** ${ctx.voice.terminology.trim()}`);
    if (ctx.voice.dos.trim()) lines.push(`- **Do:** ${ctx.voice.dos.trim()}`);
    if (ctx.voice.donts.trim()) lines.push(`- **Don't:** ${ctx.voice.donts.trim()}`);
    lines.push('');
  }
  return `${basePrompt}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Outline-first deck generation (Phase 2.5)
// ---------------------------------------------------------------------------
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
  const response = await callClaude(messages, systemPrompt, {
    ...options,
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
    model: options.model ?? defaultModel(),
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
  };
}

/** Re-exported for service / test use. */
export const __outline_internals = { parseOutlineTurn };
