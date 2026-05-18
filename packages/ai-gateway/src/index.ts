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
  /** Max tokens to generate. Default 2048 — enough for an explanation + small file content. */
  maxTokens?: number;
  /** Hard timeout in ms. Per ai-editor.md §10 the chat-depth turn is 60s. */
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
  const maxTokens = options.maxTokens ?? 2048;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    const result = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
