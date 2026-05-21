// Google (Gemini) provider adapter (Chunk 2D). Mirrors the shape of the
// other providers: one low-level `callGemini` for chat-style calls, plus
// mock-mode short-circuit when `GOOGLE_API_KEY === 'mock'`.
//
// Only the CLASSIFY task routes here today (per architecture §9: cheap,
// fast classification on the triage pipeline that lands in Chunk 6). No
// production caller exists yet; exercise via tests + env override.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { computeCostCents } from '../pricing';
import { mockGeminiResponse } from '../mock';
import type { CallClaudeOptions, ClaudeMessage, ClaudeResponse } from '../types';

export function getGoogleClient(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey || apiKey === 'replace-me') {
    throw new Error(
      'GOOGLE_API_KEY is not set. Add it to apps/web/.env.local (see .env.example).',
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

export function defaultGoogleModel(): string {
  return process.env.GOOGLE_DEFAULT_MODEL || 'gemini-1.5-flash-latest';
}

/**
 * Low-level chat call to Gemini. `systemPrompt` is passed via the SDK's
 * `systemInstruction` field (Gemini has a top-level slot, like Anthropic).
 * Returns the unified text response shape. The `model` we report in the
 * response is the resolved model id (Gemini doesn't echo it back the way
 * Anthropic does, so we use the resolved value).
 */
export async function callGemini(
  messages: ClaudeMessage[],
  systemPrompt: string,
  options: CallClaudeOptions = {},
): Promise<ClaudeResponse> {
  if (process.env.GOOGLE_API_KEY === 'mock') {
    return mockGeminiResponse(messages, options);
  }
  const client = getGoogleClient();
  const modelId = options.model ?? defaultGoogleModel();
  const maxTokens = options.maxTokens ?? 4_096;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  try {
    const model = client.getGenerativeModel({
      model: modelId,
      systemInstruction: systemPrompt,
    });

    // Gemini's role enum is `user` | `model` (not `assistant`). Map at
    // the adapter boundary so callers can keep using the Claude-style
    // `user` / `assistant` shape unchanged.
    const result = await model.generateContent(
      {
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens },
      },
      { signal: controller.signal },
    );

    const text = result.response.text();
    const usage = result.response.usageMetadata;
    const tokensIn = usage?.promptTokenCount ?? 0;
    const tokensOut = usage?.candidatesTokenCount ?? 0;
    const costCents = computeCostCents(modelId, tokensIn, tokensOut);
    // `finishReason` is on the first candidate; mirror the field name so
    // analytics can group across providers.
    const stopReason = result.response.candidates?.[0]?.finishReason ?? null;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'gemini_call_ok',
        requestId: options.requestId ?? null,
        model: modelId,
        tokensIn,
        tokensOut,
        costCents,
        latencyMs: Date.now() - startedAt,
        stopReason,
      }),
    );

    return {
      content: text,
      model: modelId,
      tokensIn,
      tokensOut,
      costCents,
      stopReason,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'gemini_call_err',
        requestId: options.requestId ?? null,
        model: modelId,
        latencyMs: Date.now() - startedAt,
        error: (err as Error).message,
      }),
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
