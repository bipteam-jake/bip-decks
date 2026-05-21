// Public surface of `@bip/ai-gateway`.
//
// Phase 1 shipped this as a single ~1k-line file; Phase 3 / Chunk 2A split
// it into focused modules per provider / per task and made this file a
// thin re-export hub. The PUBLIC API is unchanged — every export below is
// what existed in the Phase 1 monolith. Chunk 2B will add `callModel(task,
// ...)` as the new canonical entry; this file stays as the back-compat
// surface.
//
// Module map:
//   types.ts                — MessageRole / ClaudeMessage / ClaudeResponse / CallClaudeOptions
//   pricing.ts              — per-model USD/MTok table + computeCostCents
//   providers/anthropic.ts  — low-level callAnthropic + getAnthropicClient
//   mock.ts                 — deterministic mock outputs for mock-mode tests
//   brand-kit.ts            — extractBrandKitFromPdf (multimodal PDF flow)
//   outline.ts              — generateOutlineTurn + outline-specific types
//   prompt-builders/*.ts    — system-prompt augmentation helpers (pure)

import { callModel } from './gateway';
import type { CallClaudeOptions, ClaudeMessage, ClaudeResponse } from './types';

/**
 * Phase 1 single-shot call to Claude. `systemPrompt` maps to Anthropic's
 * top-level `system` field (not a message role). Returns the first text
 * content block joined, with usage and cost folded in.
 *
 * As of Chunk 2B this is a thin back-compat shim over
 * `callModel('CHAT_REFINE', ...)`. The behavior is unchanged for callers:
 * CHAT_REFINE routes to Anthropic / Claude Sonnet by default, the mock
 * branch lives inside the Anthropic adapter, and the response shape is
 * byte-identical. New code should call `callModel` directly with the
 * appropriate TaskType.
 *
 * @deprecated since Chunk 2B — use `callModel('CHAT_REFINE', messages, { systemPrompt, ... })`.
 */
export async function callClaude(
  messages: ClaudeMessage[],
  systemPrompt: string,
  options: CallClaudeOptions = {},
): Promise<ClaudeResponse> {
  return callModel('CHAT_REFINE', messages, { ...options, systemPrompt });
}

// ---------------------------------------------------------------------------
// Re-exports — preserve the Phase 1 public API surface.
// ---------------------------------------------------------------------------

export type {
  CallClaudeOptions,
  CallImageOptions,
  ClaudeMessage,
  ClaudeResponse,
  ImageResponse,
  MessageRole,
} from './types';

export {
  extractBrandKitFromPdf,
  type ExtractBrandKitInput,
  type ExtractBrandKitOptions,
  type ExtractBrandKitProgress,
  type ExtractedBrandKit,
} from './brand-kit';

export {
  __outline_internals,
  buildOutlineKickoff,
  buildOutlineSystemPrompt,
  generateOutlineTurn,
  type OutlineBrief,
  type OutlineDraft,
  type OutlineSlide,
  type OutlineTurnPayload,
  type OutlineTurnResponse,
} from './outline';

export {
  buildPatternSystemPrompt,
  type PatternCatalogEntry,
} from './prompt-builders/pattern';

export {
  buildBrandContextSystemPrompt,
  type BrandContext,
} from './prompt-builders/brand';

// Chunk 2B — multi-model gateway primitives. Re-exported so callers can
// migrate off `callClaude` to `callModel` without reaching into internal
// modules.
export {
  callModel,
  callImageModel,
  type CallModelOptions,
  type CallImageModelOptions,
  type ModelResponse,
} from './gateway';
export {
  resolveTask,
  ALL_TASKS,
  type Provider,
  type ResolvedRoute,
  type TaskType,
} from './routing';
export {
  GatewayError,
  InvalidRoutingOverrideError,
  NotImplementedProviderError,
} from './errors';
