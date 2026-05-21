// Unit tests for the Google (Gemini) provider (Chunk 2D). All paths run
// in mock mode (`GOOGLE_API_KEY === 'mock'`) so no live API call is made.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { callModel, type ClaudeMessage } from '@bip/ai-gateway';

const TASK_ENV_PREFIXES = ['MODEL_OVERRIDE_', 'PROVIDER_OVERRIDE_'];
function clearTaskEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (TASK_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
}

const MOCK_MESSAGES: ClaudeMessage[] = [
  { role: 'user', content: 'Classify this snippet: "We need pricing on slide 4."' },
];

describe('ai-gateway / google (Chunk 2D)', () => {
  const originalGoogle = process.env.GOOGLE_API_KEY;
  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'mock';
    clearTaskEnv();
  });
  afterEach(() => {
    if (originalGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = originalGoogle;
    clearTaskEnv();
  });

  it('CLASSIFY routes to Gemini and returns the mock classification payload', async () => {
    const res = await callModel('CLASSIFY', MOCK_MESSAGES, { systemPrompt: 'sys' });
    // Default model for CLASSIFY per routing.ts.
    expect(res.model).toMatch(/gemini/);
    // Gemini's finishReason is uppercase `STOP`, not Anthropic's `end_turn`.
    // This is the cheapest proof the Gemini adapter was invoked.
    expect(res.stopReason).toBe('STOP');
    const parsed = JSON.parse(res.content) as { label: string; confidence: number };
    expect(parsed.label).toBe('mock');
    expect(typeof parsed.confidence).toBe('number');
  });

  it('per-call modelOverride flows through to the resolved Gemini model', async () => {
    const res = await callModel('CLASSIFY', MOCK_MESSAGES, {
      systemPrompt: 'sys',
      modelOverride: 'gemini-1.5-pro-latest',
    });
    expect(res.model).toBe('gemini-1.5-pro-latest');
  });

  it('PROVIDER_OVERRIDE_CHAT_REFINE=google routes a text task to Gemini', async () => {
    process.env.PROVIDER_OVERRIDE_CHAT_REFINE = 'google';
    process.env.MODEL_OVERRIDE_CHAT_REFINE = 'gemini-1.5-flash-latest';
    const res = await callModel('CHAT_REFINE', MOCK_MESSAGES, { systemPrompt: 'sys' });
    expect(res.model).toBe('gemini-1.5-flash-latest');
    expect(res.stopReason).toBe('STOP');
  });
});
