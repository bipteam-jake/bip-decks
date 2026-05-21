// Core shared types for the AI gateway.
//
// `ClaudeMessage` / `ClaudeResponse` / `CallClaudeOptions` are the original
// Phase 1 names and are preserved for back-compat with existing callers.
// Chunk 2 (multi-model gateway) will introduce a superset `ModelResponse`
// type, but the Claude-named types remain as the canonical text-response
// shape until callers migrate.

export type MessageRole = 'user' | 'assistant';

export interface ClaudeMessage {
  role: MessageRole;
  content: string;
}

export interface ClaudeResponse {
  /** Raw model output. AI-editor responses are strict JSON; parsing is the caller's job. */
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Estimated cost in cents (integer, rounded). Uses the price table. */
  costCents: number;
  /** anthropic stop reason: end_turn | max_tokens | stop_sequence | tool_use */
  stopReason: string | null;
}

export interface CallClaudeOptions {
  /** Override the default model. Phase 1 uses ANTHROPIC_DEFAULT_MODEL. */
  model?: string;
  /**
   * Max tokens to generate. Default 16000 — Sonnet 4.5 supports up to 64K
   * output, and AI-editor turns frequently rewrite full slide HTML files,
   * so a small budget causes mid-JSON truncation. Callers may go higher
   * (up to the model max) for big edits.
   */
  maxTokens?: number;
  /**
   * Hard timeout in ms. Default 180s — large output budgets can take
   * 1–3 minutes to stream from Anthropic. Callers using >32K tokens should
   * raise this further.
   */
  timeoutMs?: number;
  /** Optional id propagated through logs. */
  requestId?: string;
}

// --- Image generation (Chunk 2C) ---
//
// Image generation lives on a parallel `callImageModel` entry point, not
// `callModel`, so the text-response shape (`ClaudeResponse`) stays
// non-discriminated. This keeps the AI editor + outline + brand-kit
// callers free of `kind` narrowing for the 99% case where they only want
// text. The image flow gets its own typed surface.

export interface ImageResponse {
  /** Discriminator for any future union with text responses. */
  kind: 'image';
  /** Raw base64 PNG bytes from the provider. Callers persist to S3. */
  imageBase64: string;
  /** Resolved model id (e.g. `gpt-image-1`). */
  model: string;
  /** Number of images returned. Always 1 today; widened when callers ask. */
  count: number;
  /** Estimated cost in cents (integer, rounded) via `IMAGE_PRICE_TABLE`. */
  costCents: number;
}

export interface CallImageOptions {
  /** Override the default model. */
  model?: string;
  /** Hard timeout in ms. Default 120s. */
  timeoutMs?: number;
  /** Optional id propagated through logs. */
  requestId?: string;
  /**
   * Output size. OpenAI gpt-image-1 supports `1024x1024`, `1024x1536`,
   * `1536x1024`, `auto`. Default `1024x1024`.
   */
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
}
