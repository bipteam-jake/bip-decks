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
