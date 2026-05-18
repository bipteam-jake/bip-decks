// Unit tests for token + voice schema validation and CSS resolution.
// No DB, no S3 — pure functions.

import { describe, expect, it } from 'vitest';

import {
  BrandTokensSchema,
  BrandVoiceSchema,
  emptyTokens,
  emptyVoice,
  parseTokens,
  parseVoice,
  resolveTokensToCss,
} from '@/lib/brand-kits/tokens';

describe('brand-kit tokens schema', () => {
  it('accepts a minimal-but-valid token set', () => {
    const tokens = {
      colors: { primary: '#0f1140', accent: 'rgb(70, 188, 223)' },
      type: {
        fontFamilies: { display: 'Barlow, sans-serif' },
        scale: { md: '1rem', lg: '1.25rem' },
      },
      spacing: { sm: '0.5rem' },
      radius: { md: '0.5rem' },
      motion: { base: '200ms' },
    };
    const parsed = BrandTokensSchema.parse(tokens);
    expect(parsed.colors.primary).toBe('#0f1140');
  });

  it('rejects non-color strings under colors', () => {
    expect(() =>
      parseTokens({
        ...emptyTokens(),
        colors: { primary: 'not-a-color' },
      }),
    ).toThrow();
  });

  it('rejects uppercase token keys', () => {
    expect(() =>
      parseTokens({
        ...emptyTokens(),
        spacing: { Large: '2rem' },
      }),
    ).toThrow();
  });

  it('emptyTokens passes validation', () => {
    expect(() => parseTokens(emptyTokens())).not.toThrow();
  });
});

describe('brand-kit voice schema', () => {
  it('fills missing fields with defaults', () => {
    const v = BrandVoiceSchema.parse({});
    expect(v).toEqual({ tone: '', terminology: '', dos: '', donts: '' });
  });

  it('emptyVoice round-trips', () => {
    expect(parseVoice(emptyVoice())).toEqual(emptyVoice());
  });
});

describe('resolveTokensToCss', () => {
  it('renders nested groups with stable ordering', () => {
    const css = resolveTokensToCss({
      colors: { primary: '#0f1140', sky: '#46bcdf' },
      type: {
        fontFamilies: { body: 'Inter', display: 'Barlow' },
        scale: { md: '1rem', sm: '0.875rem' },
        weights: { regular: 400, bold: 700 },
      },
      spacing: { sm: '0.5rem', md: '1rem' },
      radius: { md: '0.5rem' },
      motion: { base: '200ms' },
    });

    expect(css).toContain('--brand-color-primary: #0f1140;');
    expect(css).toContain('--brand-color-sky: #46bcdf;');
    expect(css).toContain('--brand-type-family-body: Inter;');
    expect(css).toContain('--brand-type-family-display: Barlow;');
    expect(css).toContain('--brand-type-scale-md: 1rem;');
    expect(css).toContain('--brand-type-weight-bold: 700;');
    expect(css).toContain('--brand-space-md: 1rem;');
    expect(css).toContain('--brand-radius-md: 0.5rem;');
    expect(css).toContain('--brand-motion-base: 200ms;');

    // Within a group, keys appear sorted alphabetically.
    const colorPrimaryIdx = css.indexOf('--brand-color-primary');
    const colorSkyIdx = css.indexOf('--brand-color-sky');
    expect(colorPrimaryIdx).toBeLessThan(colorSkyIdx);
  });

  it('emits a deterministic empty block for an empty kit', () => {
    const css = resolveTokensToCss(emptyTokens());
    expect(css.trim()).toBe(':root {\n\n}');
  });

  it('skips type.weights when absent', () => {
    const css = resolveTokensToCss({
      ...emptyTokens(),
      type: { fontFamilies: {}, scale: {} },
    });
    expect(css).not.toContain('--brand-type-weight');
  });
});
