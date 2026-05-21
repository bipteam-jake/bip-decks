// Unit tests for the `callModel` dispatcher (Chunk 2B+, updated 2C/2D).
// Verifies:
//   - Anthropic dispatch returns the mock response in mock mode.
//   - `callClaude` shim is byte-equal to `callModel('CHAT_REFINE', ...)` in mock mode.
//   - `IMAGE_GEN` via `callModel` throws WRONG_ENTRY_POINT (callers must use callImageModel).
//   - Per-call `modelOverride` wins over env override which wins over default.
//
// Provider-specific dispatch (OpenAI / Google) is covered in their own
// test files. This file stays focused on the gateway's task → adapter
// switch behavior.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  callClaude,
  callModel,
  type ClaudeMessage,
} from '@bip/ai-gateway';

const TASK_ENV_PREFIXES = ['MODEL_OVERRIDE_', 'PROVIDER_OVERRIDE_'];

function clearTaskEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (TASK_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
}

const MOCK_MESSAGES: ClaudeMessage[] = [{ role: 'user', content: 'Tighten the cover slide.' }];

describe('ai-gateway / callModel', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'mock';
    clearTaskEnv();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    clearTaskEnv();
  });

  it('CHAT_REFINE in mock mode returns a deterministic Claude-shaped response', async () => {
    const res = await callModel('CHAT_REFINE', MOCK_MESSAGES, { systemPrompt: 'sys' });
    expect(res.model).toMatch(/sonnet|claude/);
    expect(res.tokensIn).toBe(0);
    expect(res.tokensOut).toBe(0);
    expect(res.costCents).toBe(0);
    expect(res.stopReason).toBe('end_turn');
    const parsed = JSON.parse(res.content) as { explanation: string; changes: unknown[] };
    expect(parsed.explanation).toMatch(/Mock proposal/);
    expect(parsed.changes).toHaveLength(1);
  });

  it('callClaude back-compat shim produces byte-identical content to callModel CHAT_REFINE', async () => {
    const legacy = await callClaude(MOCK_MESSAGES, 'sys');
    const routed = await callModel('CHAT_REFINE', MOCK_MESSAGES, { systemPrompt: 'sys' });
    // Content is what callers persist + parse; it must be byte-equal so the
    // proposal pipeline behaves identically through both entry points.
    expect(routed.content).toBe(legacy.content);
    expect(routed.stopReason).toBe(legacy.stopReason);
    expect(routed.tokensIn).toBe(legacy.tokensIn);
    expect(routed.tokensOut).toBe(legacy.tokensOut);
    expect(routed.costCents).toBe(legacy.costCents);
  });

  it('IMAGE_GEN via callModel throws a typed WRONG_ENTRY_POINT error (use callImageModel)', async () => {
    // IMAGE_GEN routes to OpenAI but returns images, not text. callModel
    // is the text dispatcher; callers must use callImageModel. This guards
    // against accidental mis-dispatch.
    await expect(
      callModel('IMAGE_GEN', MOCK_MESSAGES, { systemPrompt: 'sys' }),
    ).rejects.toThrow(/WRONG_ENTRY_POINT|callImageModel/);
  });

  it('per-call modelOverride wins over env MODEL_OVERRIDE_<TASK>', async () => {
    process.env.MODEL_OVERRIDE_CHAT_REFINE = 'claude-from-env';
    const res = await callModel('CHAT_REFINE', MOCK_MESSAGES, {
      systemPrompt: 'sys',
      modelOverride: 'claude-from-call',
    });
    // Mock response echoes the resolved model in `model`.
    expect(res.model).toBe('claude-from-call');
  });

  it('env MODEL_OVERRIDE_<TASK> wins over default when no per-call override', async () => {
    process.env.MODEL_OVERRIDE_CHAT_REFINE = 'claude-from-env';
    const res = await callModel('CHAT_REFINE', MOCK_MESSAGES, { systemPrompt: 'sys' });
    expect(res.model).toBe('claude-from-env');
  });
});
