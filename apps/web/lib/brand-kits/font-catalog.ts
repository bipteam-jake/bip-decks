// Curated Google Fonts catalog for the brand-kit font picker.
//
// Only fonts in this list show up in the UI dropdown. The bundler also uses
// this list to know which fonts to lazy-load via `@import` when a kit pins
// a family that matches by name. Authors who really want a custom family
// can still hand-edit the JSON, but the UI funnel keeps things sane.
//
// To add a font: pick a Google Fonts family, list the weights you want
// available, and append below. Keep the list short — every font costs a
// network request on first deck view.

export interface FontEntry {
  /** Display family name (matches the CSS value we save). */
  family: string;
  /** Generic fallback the family rolls up to. */
  fallback: 'sans-serif' | 'serif' | 'monospace' | 'display';
  /** Weights to request from Google Fonts. */
  weights: number[];
  /** Optional italic axis — request `ital,wght@…` form. */
  italic?: boolean;
}

export const FONT_CATALOG: readonly FontEntry[] = [
  { family: 'Barlow', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Inter', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Manrope', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'IBM Plex Sans', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Work Sans', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'DM Sans', fallback: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Plus Jakarta Sans', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Space Grotesk', fallback: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Geist', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Figtree', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Outfit', fallback: 'sans-serif', weights: [400, 500, 600, 700] },
  { family: 'Sora', fallback: 'sans-serif', weights: [400, 500, 600, 700] },

  { family: 'Playfair Display', fallback: 'serif', weights: [400, 600, 700] },
  { family: 'Fraunces', fallback: 'serif', weights: [400, 500, 700] },
  { family: 'Source Serif 4', fallback: 'serif', weights: [400, 600, 700] },
  { family: 'Lora', fallback: 'serif', weights: [400, 500, 700] },
  { family: 'Merriweather', fallback: 'serif', weights: [400, 700] },
  { family: 'IBM Plex Serif', fallback: 'serif', weights: [400, 600, 700] },

  { family: 'JetBrains Mono', fallback: 'monospace', weights: [400, 500, 700] },
  { family: 'IBM Plex Mono', fallback: 'monospace', weights: [400, 500, 700] },
  { family: 'Geist Mono', fallback: 'monospace', weights: [400, 500, 700] },
  { family: 'Fira Code', fallback: 'monospace', weights: [400, 500, 700] },
] as const;

/** Build the saved CSS family string for a catalog entry. */
export function familyCssValue(entry: FontEntry): string {
  return `"${entry.family}", ${entry.fallback === 'display' ? 'sans-serif' : entry.fallback}`;
}

/** Find a catalog entry given a saved family CSS value (or just the family name). */
export function lookupFontByValue(value: string): FontEntry | null {
  if (!value) return null;
  // Pull the first token, strip wrapping quotes.
  const first = value
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  if (!first) return null;
  return FONT_CATALOG.find((f) => f.family.toLowerCase() === first.toLowerCase()) ?? null;
}

/**
 * Build a single Google Fonts CSS2 URL pulling every catalog family used by
 * the supplied family CSS values. Returns null if no values match the
 * catalog (e.g. the kit only uses system fonts).
 */
export function googleFontsImportUrl(values: Iterable<string>): string | null {
  const seen = new Set<string>();
  const families: FontEntry[] = [];
  for (const v of values) {
    const entry = lookupFontByValue(v);
    if (!entry) continue;
    if (seen.has(entry.family)) continue;
    seen.add(entry.family);
    families.push(entry);
  }
  if (families.length === 0) return null;
  const parts = families.map((f) => {
    const weights = [...f.weights].sort((a, b) => a - b).join(';');
    return `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:wght@${weights}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}
