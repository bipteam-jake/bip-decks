// Unit tests for the OpenAI provider + image-generation dispatcher
// (Chunk 2C). All paths use mock mode (`OPENAI_API_KEY === 'mock'`) so
// no real API call is made.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  callImageModel,
  callModel,
  GatewayError,
  type CallImageOptions,
  type ClaudeMessage,
} from '@bip/ai-gateway';

const TASK_ENV_PREFIXES = ['MODEL_OVERRIDE_', 'PROVIDER_OVERRIDE_'];
function clearTaskEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (TASK_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
}

const MOCK_MESSAGES: ClaudeMessage[] = [{ role: 'user', content: 'Make slide 1 about pricing.' }];

describe('ai-gateway / openai chat (Chunk 2C)', () => {
  const originalAnth = process.env.ANTHROPIC_API_KEY;
  const originalOAI = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'mock';
    process.env.OPENAI_API_KEY = 'mock';
    clearTaskEnv();
  });
  afterEach(() => {
    if (originalAnth === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnth;
    if (originalOAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOAI;
    clearTaskEnv();
  });

  it('PROVIDER_OVERRIDE_CHAT_REFINE=openai routes text dispatch through OpenAI mock', async () => {
    process.env.PROVIDER_OVERRIDE_CHAT_REFINE = 'openai';
    process.env.MODEL_OVERRIDE_CHAT_REFINE = 'gpt-4o-mini';
    const res = await callModel('CHAT_REFINE', MOCK_MESSAGES, { systemPrompt: 'sys' });
    expect(res.model).toBe('gpt-4o-mini');
    // OpenAI's mock uses `stop` as the finish_reason; Anthropic uses
    // `end_turn`. This is the cheapest assertion that proves the OpenAI
    // path was taken.
    expect(res.stopReason).toBe('stop');
    const parsed = JSON.parse(res.content) as { explanation: string };
    expect(parsed.explanation).toMatch(/openai/i);
  });

  it('per-call providerOverride wins over env PROVIDER_OVERRIDE_<TASK>', async () => {
    // Env says openai, per-call says anthropic — anthropic should win.
    process.env.PROVIDER_OVERRIDE_CHAT_REFINE = 'openai';
    const res = await callModel('CHAT_REFINE', MOCK_MESSAGES, {
      systemPrompt: 'sys',
      providerOverride: 'anthropic',
    });
    expect(res.stopReason).toBe('end_turn');
  });
});

describe('ai-gateway / callImageModel (Chunk 2C)', () => {
  const originalOAI = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'mock';
    clearTaskEnv();
  });
  afterEach(() => {
    if (originalOAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOAI;
    clearTaskEnv();
  });

  it('IMAGE_GEN returns an ImageResponse with kind="image" and a valid base64 PNG', async () => {
    const res = await callImageModel('IMAGE_GEN', 'a small blue circle');
    expect(res.kind).toBe('image');
    expect(res.model).toBe('gpt-image-1');
    expect(res.count).toBe(1);
    // PNG header bytes are `\x89PNG\r\n\x1a\n` → base64 starts with `iVBORw0KGgo`.
    expect(res.imageBase64.startsWith('iVBORw0KGgo')).toBe(true);
    // Mock returns the live-provider cost so analytics paths run unchanged.
    expect(res.costCents).toBe(4); // $0.04 at integer cents.
  });

  it('per-call modelOverride flows through to the mock response', async () => {
    const opts: CallImageOptions = { model: 'gpt-image-1' };
    const res = await callImageModel('IMAGE_GEN', 'x', {
      ...opts,
      modelOverride: 'gpt-image-1-experimental',
    });
    expect(res.model).toBe('gpt-image-1-experimental');
  });

  it('routing an image task to anthropic throws a typed GatewayError', async () => {
    await expect(
      callImageModel('IMAGE_GEN', 'x', { providerOverride: 'anthropic' }),
    ).rejects.toBeInstanceOf(GatewayError);
  });
});
