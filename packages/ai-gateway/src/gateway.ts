// Canonical multi-provider entry point. Callers pick a TaskType; the
// gateway resolves it to provider+model and dispatches to the right
// adapter. Wraps every successful call in a structured log line with
// `task`, `provider`, `model`, `tokens`, `cost`, `latencyMs`, `requestId`
// so analytics + debugging have a single shape to query.
//
// In Chunk 2B, only the Anthropic provider is wired. OpenAI and Google
// routes throw `NotImplementedProviderError` until Chunks 2C / 2D.

import { GatewayError, NotImplementedProviderError } from './errors';
import { callAnthropic } from './providers/anthropic';
import { callOpenAIChat, callOpenAIImage } from './providers/openai';
import { callGemini } from './providers/google';
import { resolveTask, type TaskType, type Provider } from './routing';
import type {
  CallClaudeOptions,
  CallImageOptions,
  ClaudeMessage,
  ClaudeResponse,
  ImageResponse,
} from './types';

/**
 * Options accepted by `callModel`. Superset of `CallClaudeOptions` plus a
 * required `systemPrompt` and the per-call overrides that bypass routing.
 */
export interface CallModelOptions extends CallClaudeOptions {
  /** System prompt. Routed to the provider's equivalent (Anthropic top-level `system`). */
  systemPrompt: string;
  /** Per-call model override. Wins over `MODEL_OVERRIDE_<TASK>`. */
  modelOverride?: string;
  /** Per-call provider override. Wins over `PROVIDER_OVERRIDE_<TASK>`. */
  providerOverride?: Provider;
}

/**
 * Text-shape model response. Mirrors `ClaudeResponse` byte-for-byte today
 * so the back-compat shim in `index.ts` can re-export it directly. Chunk
 * 2C will widen this into a discriminated union when image generation
 * lands.
 */
export type ModelResponse = ClaudeResponse;

/**
 * Dispatch a single-shot call to the right provider for `task`. Resolves
 * routing → applies per-call overrides → calls the adapter → emits a
 * structured log line on success or error.
 */
export async function callModel(
  task: TaskType,
  messages: ClaudeMessage[],
  options: CallModelOptions,
): Promise<ModelResponse> {
  const resolved = resolveTask(task);
  const provider: Provider = options.providerOverride ?? resolved.provider;
  const model: string = options.modelOverride ?? options.model ?? resolved.model;

  // Strip gateway-specific fields before handing off; the adapter only
  // cares about `CallClaudeOptions` shape. `model` is replaced with the
  // resolved/overridden value so the adapter doesn't re-default.
  const adapterOptions: CallClaudeOptions = {
    model,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    requestId: options.requestId,
  };

  const startedAt = Date.now();
  try {
    let response: ModelResponse;
    switch (provider) {
      case 'anthropic':
        response = await callAnthropic(messages, options.systemPrompt, adapterOptions);
        break;
      case 'openai':
        // OpenAI image generation is dispatched via `callImageModel`, not
        // `callModel`. If a task resolves to OpenAI for text we route to
        // chat completions; image-only tasks must use the image entry.
        if (task === 'IMAGE_GEN') {
          throw new GatewayError(
            'WRONG_ENTRY_POINT',
            `Task '${task}' returns images. Use callImageModel('${task}', prompt, options) instead of callModel.`,
          );
        }
        response = await callOpenAIChat(messages, options.systemPrompt, adapterOptions);
        break;
      case 'google':
        response = await callGemini(messages, options.systemPrompt, adapterOptions);
        break;
      default: {
        // Exhaustiveness guard — flagged by TS if a new Provider is added.
        const _exhaustive: never = provider;
        throw new NotImplementedProviderError(String(_exhaustive));
      }
    }

    // Structured success log. The Anthropic adapter ALSO logs its own
    // `claude_call_ok` line at the SDK boundary; this `model_call_ok`
    // line is the task-level view that includes `task` and the resolved
    // `provider` so analytics can group by use case.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'model_call_ok',
        requestId: options.requestId ?? null,
        task,
        provider,
        model: response.model,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        costCents: response.costCents,
        latencyMs: Date.now() - startedAt,
        stopReason: response.stopReason,
      }),
    );
    return response;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'model_call_err',
        requestId: options.requestId ?? null,
        task,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        error: (err as Error).message,
      }),
    );
    throw err;
  }
}

/**
 * Options for `callImageModel`. Superset of `CallImageOptions` with the
 * same provider/model override semantics as `callModel`.
 */
export interface CallImageModelOptions extends CallImageOptions {
  /** Per-call model override. Wins over `MODEL_OVERRIDE_<TASK>`. */
  modelOverride?: string;
  /** Per-call provider override. Wins over `PROVIDER_OVERRIDE_<TASK>`. */
  providerOverride?: Provider;
}

/**
 * Image-generation dispatcher. Parallel to `callModel` but for tasks
 * whose response is an image, not text. Today only `IMAGE_GEN` uses this
 * (routed to OpenAI gpt-image-1). Anthropic + Google don't expose image
 * generation in our supported provider set, so other providers throw.
 *
 * No production caller hits this path yet — image generation lands as a
 * deck-editor feature in Chunk 3. The dispatcher is in place so Chunk 3
 * doesn't need to touch the gateway plumbing.
 */
export async function callImageModel(
  task: TaskType,
  prompt: string,
  options: CallImageModelOptions = {},
): Promise<ImageResponse> {
  const resolved = resolveTask(task);
  const provider: Provider = options.providerOverride ?? resolved.provider;
  const model: string = options.modelOverride ?? options.model ?? resolved.model;

  const adapterOptions: CallImageOptions = {
    model,
    timeoutMs: options.timeoutMs,
    requestId: options.requestId,
    size: options.size,
  };

  const startedAt = Date.now();
  try {
    let response: ImageResponse;
    switch (provider) {
      case 'openai':
        response = await callOpenAIImage(prompt, adapterOptions);
        break;
      case 'anthropic':
      case 'google':
        // Neither provider offers image generation in our supported APIs.
        // Surface as a typed error so a misrouted task fails loudly.
        throw new GatewayError(
          'IMAGE_GEN_NOT_SUPPORTED',
          `Provider '${provider}' does not support image generation. Route '${task}' to openai or use callModel for text tasks.`,
        );
      default: {
        const _exhaustive: never = provider;
        throw new NotImplementedProviderError(String(_exhaustive));
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'image_model_call_ok',
        requestId: options.requestId ?? null,
        task,
        provider,
        model: response.model,
        count: response.count,
        costCents: response.costCents,
        latencyMs: Date.now() - startedAt,
      }),
    );
    return response;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-gateway',
        event: 'image_model_call_err',
        requestId: options.requestId ?? null,
        task,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        error: (err as Error).message,
      }),
    );
    throw err;
  }
}
