// Brand-kit extraction from PDF (Phase 2.1d).
//
// Claude vision reads a brand guidelines PDF and proposes a structured
// token + voice draft the wizard renders for human review. Exposes an
// async generator so the API route can stream progress events as SSE
// without blocking on the full call. The wizard never trusts the shape —
// it re-validates with `BrandTokensSchema` / `BrandVoiceSchema` downstream.
//
// Cost model: we charge the document plus the small instruction as one
// claude.messages.create call. Anthropic counts PDF pages as ~1750 tokens
// each.
//
// Note: this function bypasses the standard `callAnthropic` adapter
// because it streams a multimodal `document` content block — the gateway
// has no multimodal abstraction yet (lands in Chunk 3). It still uses the
// shared pricing table so cost numbers stay consistent.

import Anthropic from '@anthropic-ai/sdk';
import { computeCostCents } from './pricing';
import { defaultAnthropicModel, getAnthropicClient } from './providers/anthropic';

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

  const client = getAnthropicClient();
  const model = options.model ?? defaultAnthropicModel();
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
    model: options.model ?? defaultAnthropicModel(),
  };
}
