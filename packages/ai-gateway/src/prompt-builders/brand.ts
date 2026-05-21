// Brand-kit context block for AI-editor system prompts.
//
// When a deck is bound to a brand-kit version, prepend a compact "Brand kit"
// section to the system prompt summarizing the kit's identity: kit name +
// optional one-line summary, the color palette (token name + value), the
// font families, and any voice rules. The bundler already injects matching
// `--brand-*` CSS custom properties at render time, so Claude is told to
// reach for those vars (not raw hex) when authoring CSS. Identity assets
// (logo etc.) are listed by kind only — the proposal layer can later wire
// in actual URLs once asset serving stabilizes.
//
// Returns the base prompt unchanged when there is no usable context, to
// keep token usage down for kits that are bound but empty.

export interface BrandContext {
  /** Kit display name (e.g. "BIP House Brand"). */
  kitName: string;
  /** Version label (e.g. "v3") — helps Claude reason about which kit is live. */
  versionLabel: string;
  /** Optional one-line human summary from BrandKitVersion.summary. */
  summary?: string | null;
  /** Color palette: { tokenName -> hex/functional color }. */
  colors: Record<string, string>;
  /** Font families: { tokenName -> CSS family stack }. */
  fontFamilies: Record<string, string>;
  /** Voice rules. Empty strings allowed; rendered only when non-empty. */
  voice: {
    tone: string;
    terminology: string;
    dos: string;
    donts: string;
  };
  /** Distinct identity-asset kinds present in the kit (e.g. ["LOGO_FULL_COLOR", "FAVICON"]). */
  identityAssetKinds: string[];
}

export function buildBrandContextSystemPrompt(basePrompt: string, ctx: BrandContext): string {
  const colorEntries = Object.entries(ctx.colors).sort(([a], [b]) => a.localeCompare(b));
  const familyEntries = Object.entries(ctx.fontFamilies).sort(([a], [b]) => a.localeCompare(b));
  const hasVoice =
    ctx.voice.tone.trim() ||
    ctx.voice.terminology.trim() ||
    ctx.voice.dos.trim() ||
    ctx.voice.donts.trim();
  if (
    colorEntries.length === 0 &&
    familyEntries.length === 0 &&
    !hasVoice &&
    ctx.identityAssetKinds.length === 0 &&
    !ctx.summary
  ) {
    return basePrompt;
  }
  const lines: string[] = [
    '',
    '## Brand kit',
    '',
    `This deck is bound to **${ctx.kitName}** (${ctx.versionLabel}).`,
    'Honor it. Reach for the design tokens below — the runtime already injects',
    'matching CSS custom properties, so authored CSS should reference them as',
    '`var(--brand-color-<name>)`, `var(--brand-type-family-<name>)`, etc., rather',
    'than hard-coding hex values or font stacks. New CSS you propose must use',
    'these variables wherever a brand decision applies.',
    '',
  ];
  if (ctx.summary) {
    lines.push(`Summary: ${ctx.summary}`, '');
  }
  if (colorEntries.length) {
    lines.push('### Colors');
    for (const [k, v] of colorEntries) {
      lines.push(`- \`--brand-color-${k}\` → ${v}`);
    }
    lines.push('');
  }
  if (familyEntries.length) {
    lines.push('### Fonts');
    for (const [k, v] of familyEntries) {
      lines.push(`- \`--brand-type-family-${k}\` → ${v}`);
    }
    lines.push('');
  }
  if (ctx.identityAssetKinds.length) {
    lines.push('### Identity assets available');
    for (const k of ctx.identityAssetKinds) lines.push(`- ${k}`);
    lines.push('');
  }
  if (hasVoice) {
    lines.push('### Voice');
    if (ctx.voice.tone.trim()) lines.push(`- **Tone:** ${ctx.voice.tone.trim()}`);
    if (ctx.voice.terminology.trim())
      lines.push(`- **Terminology:** ${ctx.voice.terminology.trim()}`);
    if (ctx.voice.dos.trim()) lines.push(`- **Do:** ${ctx.voice.dos.trim()}`);
    if (ctx.voice.donts.trim()) lines.push(`- **Don't:** ${ctx.voice.donts.trim()}`);
    lines.push('');
  }
  return `${basePrompt}\n${lines.join('\n')}`;
}
