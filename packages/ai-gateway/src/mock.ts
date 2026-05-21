// Deterministic mock outputs returned when a provider's API key is set to
// the literal string `'mock'`. Used by Playwright smoke tests + vitest
// integration tests so they don't spend tokens or depend on network
// reachability.
//
// IMPORTANT — preserve byte-equality of mock outputs across refactors.
// The Phase 2B `callModel` snapshot tests assert that mocks produce
// byte-identical responses to the legacy `callClaude` path. Changing the
// shape or content of a mock here is a breaking change for tests.

import { defaultAnthropicModel } from './providers/anthropic';
import {
  defaultOpenAIChatModel,
  defaultOpenAIImageModel,
} from './providers/openai';
import { defaultGoogleModel } from './providers/google';
import { computeImageCostCents } from './pricing';
import type {
  CallClaudeOptions,
  CallImageOptions,
  ClaudeMessage,
  ClaudeResponse,
  ImageResponse,
} from './types';

/**
 * Mock proposal returned when ANTHROPIC_API_KEY === 'mock'. The shape
 * matches the strict-JSON contract from ai-editor.md §6 so the
 * response-parser accepts it. The slide payload contains the user's prompt
 * verbatim so smoke tests can assert the round-trip.
 */
export function mockClaudeResponse(
  messages: ClaudeMessage[],
  options: CallClaudeOptions,
): ClaudeResponse {
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
  const model = options.model ?? defaultAnthropicModel();
  return {
    content,
    model,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    stopReason: 'end_turn',
  };
}

// --- OpenAI mocks (Chunk 2C) ---

/**
 * Mock chat-completion result for `OPENAI_API_KEY === 'mock'`. Returns
 * the same `ClaudeResponse` text shape as the Anthropic mock so the AI
 * editor's response parser accepts the payload when a CHAT_REFINE task
 * is routed to OpenAI via `PROVIDER_OVERRIDE_CHAT_REFINE=openai`.
 *
 * The `model` field reflects the override the gateway passed in so tests
 * can assert that routing wired through correctly.
 */
export function mockOpenAIChatResponse(
  messages: ClaudeMessage[],
  options: CallClaudeOptions,
): ClaudeResponse {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const safe = lastUser.replace(/[<>&"]/g, ' ').slice(0, 200);
  const payload = {
    explanation: 'Mock proposal (openai): applied your request to slide 1.',
    changes: [
      {
        file: 'slides/s1.html',
        operation: 'replace' as const,
        content: `<section class="slide" data-slide-id="s1" data-slide-title="MockOpenAI">\n  <h1>${safe || 'Mock slide'}</h1>\n</section>\n`,
      },
    ],
  };
  return {
    content: JSON.stringify(payload),
    model: options.model ?? defaultOpenAIChatModel(),
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    stopReason: 'stop',
  };
}

/**
 * Mock image generation result. Returns a 1×1 transparent PNG (the
 * smallest valid PNG byte sequence) so tests that decode the base64 see
 * real image bytes. Cost is the real cost the live provider would charge
 * for one image of the resolved model — that way analytics paths get
 * exercised under mock mode too.
 */
const TRANSPARENT_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function mockOpenAIImageResponse(
  _prompt: string,
  options: CallImageOptions,
): ImageResponse {
  const model = options.model ?? defaultOpenAIImageModel();
  return {
    kind: 'image',
    imageBase64: TRANSPARENT_1X1_PNG_BASE64,
    model,
    count: 1,
    costCents: computeImageCostCents(model, 1),
  };
}

// --- Google (Gemini) mocks (Chunk 2D) ---

/**
 * Mock Gemini response for `GOOGLE_API_KEY === 'mock'`. CLASSIFY is the
 * only task that routes to Gemini today, so the mock returns a tiny
 * single-line JSON classification verdict. Test callers can parse it like
 * the real classifier output without needing live API access.
 */
export function mockGeminiResponse(
  messages: ClaudeMessage[],
  options: CallClaudeOptions,
): ClaudeResponse {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  // Trim to first 80 chars and strip JSON-breaking chars so the payload
  // round-trips through JSON.parse cleanly in tests.
  const safe = lastUser.replace(/[<>&"]/g, ' ').slice(0, 80);
  const payload = {
    label: 'mock',
    confidence: 0.5,
    excerpt: safe,
  };
  return {
    content: JSON.stringify(payload),
    model: options.model ?? defaultGoogleModel(),
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    stopReason: 'STOP',
  };
}
