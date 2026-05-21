// Unit tests for `@bip/ai-gateway` routing layer (Chunk 2B). These tests
// touch no I/O — they only exercise `resolveTask` and env-override
// behavior. Colocated in apps/web/test so the existing vitest config
// picks them up without needing a separate test runner for the package.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  ALL_TASKS,
  InvalidRoutingOverrideError,
  resolveTask,
  type TaskType,
} from '@bip/ai-gateway';

const TASK_ENV_KEYS = ['MODEL_OVERRIDE_', 'PROVIDER_OVERRIDE_'];

function clearTaskEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (TASK_ENV_KEYS.some((prefix) => key.startsWith(prefix))) {
      delete process.env[key];
    }
  }
}

describe('ai-gateway / routing', () => {
  beforeEach(() => clearTaskEnv());
  afterEach(() => clearTaskEnv());

  it('every TaskType resolves to a provider + non-empty model', () => {
    for (const task of ALL_TASKS) {
      const r = resolveTask(task);
      expect(r.provider).toMatch(/^(anthropic|openai|google)$/);
      expect(r.model.length).toBeGreaterThan(0);
    }
  });

  it('defaults follow the architecture §9 mapping', () => {
    // Spot-check the four most consequential mappings. If these flip, a
    // chunk 4/6 caller will silently start hitting the wrong model.
    expect(resolveTask('QUICK_EDIT')).toEqual({
      provider: 'anthropic',
      model: 'claude-3-5-haiku-latest',
    });
    expect(resolveTask('CHAT_REFINE').provider).toBe('anthropic');
    expect(resolveTask('CHAT_REFINE').model).toMatch(/sonnet/);
    expect(resolveTask('AGENTIC_PLAN').model).toMatch(/opus/);
    expect(resolveTask('IMAGE_GEN')).toEqual({
      provider: 'openai',
      model: 'gpt-image-1',
    });
    expect(resolveTask('CLASSIFY').provider).toBe('google');
  });

  it('MODEL_OVERRIDE_<TASK> swaps the model only (provider unchanged)', () => {
    process.env.MODEL_OVERRIDE_CHAT_REFINE = 'claude-3-5-haiku-20241022';
    const r = resolveTask('CHAT_REFINE');
    expect(r.provider).toBe('anthropic');
    expect(r.model).toBe('claude-3-5-haiku-20241022');
    // Other tasks unaffected.
    expect(resolveTask('OUTLINE').model).not.toBe('claude-3-5-haiku-20241022');
  });

  it('PROVIDER_OVERRIDE_<TASK> swaps the provider', () => {
    process.env.PROVIDER_OVERRIDE_CHAT_REFINE = 'openai';
    process.env.MODEL_OVERRIDE_CHAT_REFINE = 'gpt-4o';
    expect(resolveTask('CHAT_REFINE')).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('invalid PROVIDER_OVERRIDE_<TASK> throws InvalidRoutingOverrideError at resolve time', () => {
    process.env.PROVIDER_OVERRIDE_CHAT_REFINE = 'cohere';
    expect(() => resolveTask('CHAT_REFINE')).toThrowError(InvalidRoutingOverrideError);
  });

  it('empty MODEL_OVERRIDE_<TASK> falls back to default', () => {
    process.env.MODEL_OVERRIDE_CHAT_REFINE = '   ';
    const r = resolveTask('CHAT_REFINE');
    expect(r.model).toMatch(/sonnet/);
  });

  it('ALL_TASKS exposes every TaskType literal exactly once', () => {
    const set = new Set<TaskType>(ALL_TASKS);
    expect(set.size).toBe(ALL_TASKS.length);
    expect(set.size).toBe(11);
  });
});
