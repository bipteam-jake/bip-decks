// Pattern library augmentation block for AI-editor system prompts.
// Pure string builder — no SDK, no DB. Fetching patterns is the
// service-layer caller's responsibility so the gateway stays free of a
// Prisma dependency.

export interface PatternCatalogEntry {
  slug: string;
  name: string;
  description: string | null;
  category: string;
  /** Declared parameters; serialized as a compact JSON block in the prompt. */
  parameters: unknown;
}

/**
 * Append a "Pattern library" block to a base system prompt. If `patterns`
 * is empty, returns the base prompt unchanged so we don't waste tokens on
 * an empty header.
 *
 * The block is deliberately terse — Claude only needs slug, name, the
 * one-line description, and the parameter shape. Full HTML/CSS templates
 * stay in the database and are inlined into deck files when the AI's
 * proposal references a pattern slug (handled by the proposal pipeline,
 * not here).
 */
export function buildPatternSystemPrompt(
  basePrompt: string,
  patterns: PatternCatalogEntry[],
): string {
  if (patterns.length === 0) return basePrompt;
  const lines: string[] = [
    '',
    '## Pattern library',
    '',
    'The following on-brand slide patterns are available for this deck. Prefer',
    'reusing a pattern over hand-rolling a layout when a user asks for a slide',
    'type that matches one. Reference a pattern by its slug in your',
    'explanation (e.g. "Used pattern `cover-with-image`"). Each pattern accepts',
    'the listed parameters; supply values inline when you instantiate one.',
    '',
  ];
  for (const p of patterns) {
    lines.push(`### \`${p.slug}\` — ${p.name}`);
    if (p.description) lines.push(p.description);
    lines.push(`Category: ${p.category}`);
    lines.push('Parameters:');
    lines.push('```json');
    lines.push(JSON.stringify(p.parameters, null, 2));
    lines.push('```');
    lines.push('');
  }
  return `${basePrompt}\n${lines.join('\n')}`;
}
