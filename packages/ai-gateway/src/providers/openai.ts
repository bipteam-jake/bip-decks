// OpenAI provider adapter (Chunk 2C). Mirrors the shape of
// `providers/anthropic.ts`:
//
//   - `callOpenAIChat` — chat completions, returns the unified
//     `ClaudeResponse` text shape (kept Claude-named for back-compat).
//   - `callOpenAIImage` — image generation via `images.generate`, returns
//     the `ImageResponse` shape used by `callImageModel`.
//
// Like the Anthropic adapter, both functions honor mock mode at the top
// of the function: when `OPENAI_API_KEY === 'mock'` we return
// deterministic canned output without contacting OpenAI. This is the only
// file in the package allowed to import `openai`.

import OpenAI from 'openai';
import { computeCostCents, computeImageCostCents } from '../pricing';
import {
  mockOpenAIChatResponse,
  mockOpenAIImageResponse,
} from '../mock';
import type {
  CallClaudeOptions,
  CallImageOptions,
  ClaudeMessage,
  ClaudeResponse,
  ImageResponse,
} from '../types';

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'replace-me') {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to apps/web/.env.local (see .env.example).',
    );
  }
  return new OpenAI({ apiKey });
}

export function defaultOpenAIChatModel(): string {
  return process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini';
}

export function defaultOpenAIImageModel(): string {
  return process.env.OPENAI_DEFAULT_IMAGE_MODEL || 'gpt-image-1';
}

/**
 * Low-level chat completion call. `systemPrompt` is prepended as a
 * `role: 'system'` message (OpenAI has no top-level system field like
 * Anthropic). Returns the unified text response shape.
 *
 * Used when a CHAT_REFINE-style task is routed to OpenAI via
 * `PROVIDER_OVERRIDE_<TASK>=openai`. No production caller hits this path
 * yet; tests + ad-hoc overrides only.
 */
export async function callOpenAIChat(
  messages: ClaudeMessage[],
  systemPrompt: string,
  options: CallClaudeOptions = {},
): Promise<ClaudeResponse> {
  // Test-only short-circuit. Mirrors the Anthropic adapter so every code
  // path that ultimately routes to OpenAI hits the same mock without each
  // call site re-checking the env var.
  if (process.env.OPENAI_API_KEY === 'mock') {
    return mockOpenAIChatResponse(messages, options);
  }
  const client = getOpenAIClient();
  const model = options.model ?? defaultOpenAIChatModel();
  const maxTokens = options.maxTokens ?? 16_000;
  const timeoutMs = options.timeoutMs ?? 180_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    const result = await client.chat.completions.create(
      {
        model,
        max_tokens: maxTokens,
        // OpenAI puts the system prompt in the messages array, not at
        // top-level. We synthesize the leading message here so callers
        // can keep using the same `{ systemPrompt, messages }` shape.
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      },
      { signal: controller.signal },
    );

    const choice = result.choices[0];
    const text = choice?.message?.content ?? '';
    const tokensIn = result.usage?.prompt_tokens ?? 0;
    const tokensOut = result.usage?.completion_tokens ?? 0;
    const resolvedModel = result.model ?? model;
    const costCents = computeCostCents(resolvedModel, tokensIn, tokensOut);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'openai_chat_call_ok',
        requestId: options.requestId ?? null,
        model: resolvedModel,
        tokensIn,
        tokensOut,
        costCents,
        latencyMs: Date.now() - startedAt,
        stopReason: choice?.finish_reason ?? null,
      }),
    );

    return {
      content: text,
      model: resolvedModel,
      tokensIn,
      tokensOut,
      costCents,
      stopReason: choice?.finish_reason ?? null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'openai_chat_call_err',
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
 * Low-level image generation call. `prompt` is the full text the model
 * sees — no system prompt concept in `images.generate`. Returns base64
 * PNG bytes; callers persist to S3 (Chunk 3).
 *
 * `gpt-image-1` always returns base64 (`b64_json`), never URLs, so we
 * don't pass `response_format`.
 */
export async function callOpenAIImage(
  prompt: string,
  options: CallImageOptions = {},
): Promise<ImageResponse> {
  if (process.env.OPENAI_API_KEY === 'mock') {
    return mockOpenAIImageResponse(prompt, options);
  }
  const client = getOpenAIClient();
  const model = options.model ?? defaultOpenAIImageModel();
  const size = options.size ?? '1024x1024';
  const timeoutMs = options.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    const result = await client.images.generate(
      {
        model,
        prompt,
        size,
        n: 1,
      },
      { signal: controller.signal },
    );

    const first = result.data?.[0];
    const imageBase64 = first?.b64_json ?? '';
    if (!imageBase64) {
      throw new Error('OpenAI image response missing b64_json payload');
    }
    const costCents = computeImageCostCents(model, 1);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'openai_image_call_ok',
        requestId: options.requestId ?? null,
        model,
        size,
        count: 1,
        costCents,
        latencyMs: Date.now() - startedAt,
      }),
    );

    return {
      kind: 'image',
      imageBase64,
      model,
      count: 1,
      costCents,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'openai_image_call_err',
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
