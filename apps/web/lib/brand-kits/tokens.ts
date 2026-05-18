// Brand kit token + voice schemas, plus CSS custom property resolution.
//
// Phase 2.1 locks the v1 schema. Token names form a controlled vocabulary
// the AI editor and bundler both depend on — adding new top-level groups in
// later phases is fine, but renames are breaking.
//
// CSS naming convention: `--brand-<group>-<key>`. Sub-objects (type.scale,
// type.fontFamilies) flatten to `--brand-type-scale-md`, `--brand-type-family-display`.

import { z } from 'zod';

import { googleFontsImportUrl } from './font-catalog';

const HEX_OR_FUNCTIONAL_COLOR = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(|^oklch\(|^var\(/;

const ColorTokensSchema = z.record(
  z.string().regex(/^[a-z0-9-]+$/),
  z.string().regex(HEX_OR_FUNCTIONAL_COLOR),
);
const StringTokensSchema = z.record(z.string().regex(/^[a-z0-9-]+$/), z.string());
const NumberTokensSchema = z.record(z.string().regex(/^[a-z0-9-]+$/), z.number());

export const BrandTokensSchema = z.object({
  colors: ColorTokensSchema,
  type: z.object({
    fontFamilies: StringTokensSchema,
    scale: StringTokensSchema,
    weights: NumberTokensSchema.optional(),
  }),
  spacing: StringTokensSchema,
  radius: StringTokensSchema,
  motion: StringTokensSchema,
});

export type BrandTokens = z.infer<typeof BrandTokensSchema>;

export const BrandVoiceSchema = z.object({
  tone: z.string().default(''),
  terminology: z.string().default(''),
  dos: z.string().default(''),
  donts: z.string().default(''),
});

export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

/**
 * Empty-but-valid kit, used as a starting point for new drafts and as the
 * fallback when a deck has no brand-kit version bound.
 */
export function emptyTokens(): BrandTokens {
  return {
    colors: {},
    type: { fontFamilies: {}, scale: {} },
    spacing: {},
    radius: {},
    motion: {},
  };
}

export function emptyVoice(): BrandVoice {
  return { tone: '', terminology: '', dos: '', donts: '' };
}

function emitGroup(prefix: string, group: Record<string, string | number>): string[] {
  return Object.entries(group)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  --${prefix}-${k}: ${typeof v === 'number' ? v : v};`);
}

/**
 * Render a parsed token set to a CSS `:root { ... }` block of custom
 * properties. Used by the bundler (Phase 2.1b) to inject brand tokens into
 * the bundled deck output. Idempotent and deterministic — keys are sorted.
 */
export function resolveTokensToCss(tokens: BrandTokens): string {
  const lines: string[] = [];
  lines.push(...emitGroup('brand-color', tokens.colors));
  lines.push(...emitGroup('brand-type-family', tokens.type.fontFamilies));
  lines.push(...emitGroup('brand-type-scale', tokens.type.scale));
  if (tokens.type.weights) {
    lines.push(...emitGroup('brand-type-weight', tokens.type.weights));
  }
  lines.push(...emitGroup('brand-space', tokens.spacing));
  lines.push(...emitGroup('brand-radius', tokens.radius));
  lines.push(...emitGroup('brand-motion', tokens.motion));
  const importUrl = googleFontsImportUrl(Object.values(tokens.type.fontFamilies));
  const prelude = importUrl ? `@import url("${importUrl}");\n` : '';
  return `${prelude}:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * Parse arbitrary JSON (from the `BrandKitVersion.tokens` jsonb column or
 * an API request body) into a validated `BrandTokens`. Throws Zod's error on
 * invalid input — service layer wraps it in a ValidationError.
 */
export function parseTokens(raw: unknown): BrandTokens {
  return BrandTokensSchema.parse(raw);
}

export function parseVoice(raw: unknown): BrandVoice {
  return BrandVoiceSchema.parse(raw);
}
