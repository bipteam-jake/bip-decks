// Per-million-token USD prices for cost estimation written to
// AIMessage.cost_cents. Billing of record is the provider's invoice; this
// table is for display + analytics only. Update when prices change or we
// add a model. Unknown models fall through to a conservative default with
// a warning so we notice and add a real row.

export interface Price {
  input: number;
  output: number;
}

export const PRICE_TABLE_USD_PER_MTOK: Record<string, Price> = {
  // --- Anthropic ---
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },

  // --- OpenAI (Chunk 2C). gpt-image-1 is priced per image, not per token,
  // and is handled by `IMAGE_PRICE_TABLE_USD_PER_IMAGE` below; do not list
  // it here or `priceFor` will treat it as a chat model. ---
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },

  // --- Google (Chunk 2D). Prices for prompts ≤128K tokens; long-context
  // prompts are billed at higher rates that we don't model yet. ---
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
};

export const DEFAULT_PRICE: Price = { input: 3, output: 15 };

export function priceFor(model: string): Price {
  for (const prefix of Object.keys(PRICE_TABLE_USD_PER_MTOK)) {
    if (model.startsWith(prefix)) return PRICE_TABLE_USD_PER_MTOK[prefix]!;
  }
  // eslint-disable-next-line no-console
  console.warn(`[ai-gateway] No price row for model "${model}", using default $3/$15.`);
  return DEFAULT_PRICE;
}

export function computeCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const { input, output } = priceFor(model);
  const dollars = (input * tokensIn + output * tokensOut) / 1_000_000;
  return Math.round(dollars * 100);
}

// --- Image generation pricing (Chunk 2C) ---
//
// OpenAI prices image generation per image at a given size + quality, not
// per token. We use the `medium` quality 1024x1024 price as our baseline
// because that's what the editor's image generation flow defaults to.
// If we later expose size/quality knobs to callers, extend this table and
// `computeImageCostCents` to read them.

export const IMAGE_PRICE_TABLE_USD_PER_IMAGE: Record<string, number> = {
  // gpt-image-1, 1024x1024 medium quality. Source: OpenAI pricing page,
  // as of 2025-Q2. Round to integer cents at the boundary.
  'gpt-image-1': 0.04,
};

export const DEFAULT_IMAGE_PRICE_USD = 0.04;

export function computeImageCostCents(model: string, count = 1): number {
  const unit = IMAGE_PRICE_TABLE_USD_PER_IMAGE[model];
  if (unit === undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ai-gateway] No image price row for model "${model}", using default $${DEFAULT_IMAGE_PRICE_USD}/image.`,
    );
  }
  const dollars = (unit ?? DEFAULT_IMAGE_PRICE_USD) * count;
  return Math.round(dollars * 100);
}
