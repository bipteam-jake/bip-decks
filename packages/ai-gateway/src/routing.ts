// Task-based routing: every gateway call names a TaskType, and the
// resolver picks a provider + model from the defaults table (per
// docs/bip-deck-platform-architecture.md §9). Env vars allow per-task
// overrides without code change, which is how we'll experiment with new
// models in prod.
//
// Routing defaults (architecture §9):
//   QUICK_EDIT         → anthropic / Claude Haiku
//   CHAT_REFINE        → anthropic / Claude Sonnet
//   AGENTIC_PLAN       → anthropic / Claude Opus
//   AGENTIC_EXEC       → anthropic / Claude Sonnet
//   TRIAGE_MAP         → anthropic / Claude Haiku
//   TRIAGE_REDUCE      → anthropic / Claude Sonnet
//   OUTLINE            → anthropic / Claude Sonnet
//   VISION             → anthropic / Claude Sonnet
//   BRAND_KIT_EXTRACT  → anthropic / Claude Sonnet
//   IMAGE_GEN          → openai    / gpt-image-1
//   CLASSIFY           → google    / Gemini Flash
//
// Env overrides:
//   MODEL_OVERRIDE_<TASK>=<model-id>     — swap model only
//   PROVIDER_OVERRIDE_<TASK>=<provider>  — swap provider (must pair with a model that exists for that provider)

import { InvalidRoutingOverrideError } from './errors';

export type TaskType =
  | 'QUICK_EDIT'
  | 'CHAT_REFINE'
  | 'AGENTIC_PLAN'
  | 'AGENTIC_EXEC'
  | 'TRIAGE_MAP'
  | 'TRIAGE_REDUCE'
  | 'OUTLINE'
  | 'VISION'
  | 'BRAND_KIT_EXTRACT'
  | 'IMAGE_GEN'
  | 'CLASSIFY';

export type Provider = 'anthropic' | 'openai' | 'google';

export const ALL_TASKS: readonly TaskType[] = [
  'QUICK_EDIT',
  'CHAT_REFINE',
  'AGENTIC_PLAN',
  'AGENTIC_EXEC',
  'TRIAGE_MAP',
  'TRIAGE_REDUCE',
  'OUTLINE',
  'VISION',
  'BRAND_KIT_EXTRACT',
  'IMAGE_GEN',
  'CLASSIFY',
];

const ALL_PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google'];

export interface ResolvedRoute {
  provider: Provider;
  model: string;
}

interface TaskDefault {
  provider: Provider;
  /** Default model id. Anthropic `-latest` aliases let us track minor
   *  releases without redeploying; `ANTHROPIC_DEFAULT_MODEL` env still
   *  works as a global Claude default (handled inside the Anthropic
   *  adapter when the resolved model is empty — but we always resolve to
   *  a concrete id here). */
  model: string;
}

const DEFAULTS: Record<TaskType, TaskDefault> = {
  QUICK_EDIT: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  CHAT_REFINE: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  AGENTIC_PLAN: { provider: 'anthropic', model: 'claude-opus-4-5' },
  AGENTIC_EXEC: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  TRIAGE_MAP: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  TRIAGE_REDUCE: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  OUTLINE: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  VISION: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  BRAND_KIT_EXTRACT: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  IMAGE_GEN: { provider: 'openai', model: 'gpt-image-1' },
  CLASSIFY: { provider: 'google', model: 'gemini-1.5-flash-latest' },
};

/**
 * Resolve a task to its provider + model, honoring env overrides. Throws
 * `InvalidRoutingOverrideError` at resolve time (not call time) if an
 * override names an unknown provider, so misconfiguration surfaces early.
 *
 * Per-call `modelOverride` / `providerOverride` (passed via
 * `CallModelOptions`) are applied by `gateway.ts` AFTER this resolve step,
 * so call-site overrides always win over env overrides.
 */
export function resolveTask(task: TaskType): ResolvedRoute {
  const def = DEFAULTS[task];
  const providerEnv = process.env[`PROVIDER_OVERRIDE_${task}`];
  const modelEnv = process.env[`MODEL_OVERRIDE_${task}`];

  let provider: Provider = def.provider;
  if (providerEnv) {
    const trimmed = providerEnv.trim() as Provider;
    if (!ALL_PROVIDERS.includes(trimmed)) {
      throw new InvalidRoutingOverrideError(
        `PROVIDER_OVERRIDE_${task}`,
        providerEnv,
        `unknown provider; valid values: ${ALL_PROVIDERS.join(', ')}`,
      );
    }
    provider = trimmed;
  }

  const model = modelEnv?.trim() || def.model;
  return { provider, model };
}
