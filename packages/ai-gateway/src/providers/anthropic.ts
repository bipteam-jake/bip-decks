// Anthropic provider adapter. The only file in this package that imports
// `@anthropic-ai/sdk` directly — provider isolation keeps bundle size sane
// and makes future provider swaps a one-file change.
//
// `callAnthropic` is the low-level entry. It honors the mock-mode env
// var (`ANTHROPIC_API_KEY === 'mock'`) at the top of the function so
// every code path that routes to Anthropic — the legacy `callClaude`
// shim, the `callModel` dispatcher, the outline turn — gets the same
// deterministic canned response without each call site re-checking the
// env var.

import Anthropic from '@anthropic-ai/sdk';
import { mockClaudeResponse } from '../mock';
import { computeCostCents } from '../pricing';
import type { CallClaudeOptions, ClaudeMessage, ClaudeResponse } from '../types';

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'replace-me') {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to apps/web/.env.local (see .env.example).',
    );
  }
  return new Anthropic({ apiKey });
}

export function defaultAnthropicModel(): string {
  return process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-sonnet-4-5';
}

/**
 * Low-level single-shot call to Anthropic. `systemPrompt` maps to the
 * top-level `system` field (not a message role). Returns the first text
 * content block joined, with usage and cost folded in.
 */
export async function callAnthropic(
  messages: ClaudeMessage[],
  systemPrompt: string,
  options: CallClaudeOptions = {},
): Promise<ClaudeResponse> {
  // Test-only short-circuit. When ANTHROPIC_API_KEY === 'mock' we never
  // contact Anthropic and instead return a deterministic canned proposal.
  // Lives at the adapter boundary so every code path that ultimately routes
  // to Anthropic (callClaude shim, callModel dispatcher, outline turn) hits
  // the same mock without each call site re-checking the env var.
  if (process.env.ANTHROPIC_API_KEY === 'mock') {
    return mockClaudeResponse(messages, options);
  }
  const client = getAnthropicClient();
  const model = options.model ?? defaultAnthropicModel();
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
 * Raw Anthropic SDK access for callers that need features the gateway
 * doesn't model yet (e.g. `extractBrandKitFromPdf` streams PDF documents
 * through `messages.create` directly because the gateway has no
 * multimodal abstraction yet — that arrives in Chunk 3).
 */
export type { Anthropic };
