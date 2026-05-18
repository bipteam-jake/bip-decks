// View-time bundler: assemble a deck's git tree at a given commit into a
// single self-contained HTML document.
//
// Per architecture doc §7:
//   "check out the commit, read deck.json + slide files + styles + scripts +
//    asset references, assemble a single HTML document"
//
// We don't actually check the commit out (avoids working-directory races and
// keeps reads stateless). Instead we use `git show {sha}:path` to read each
// file at the exact commit.
//
// Trust model: slide HTML and JS are AUTHORED CONTENT. We do not sanitize.
// The platform is single-tenant; the same team that writes slides operates
// the server.
//
// Asset URLs: we emit `<base href="/d/{slug}/">` in the document head.
// Browsers resolve relative URLs in HTML attributes (img src, link href, a
// href, ...) AND in inline <style> `url()` declarations against the document
// base, so an authored reference like `assets/foo.png` automatically becomes
// `/d/{slug}/assets/foo.png` with no parsing on our side. The matching
// asset-serving route is apps/web/app/d/[slug]/assets/[...path]/route.ts.
//
// Out of scope for Phase 1 (TODO per architecture §7):
//   - Signed object-storage URLs for assets (will replace the inline route)
//   - Working-branch preview bundling (separate path in the editor)
//
// Phase 2.1b: brand-kit token resolution lives in lib/decks/bundle-service.ts.
// The bundler stays pure (no DB) — it receives a pre-resolved `brandKitCss`
// block and injects it as the FIRST style so authored CSS can override.

import { listFilesAtCommit, readFileAtCommit } from '@/lib/git';

export interface ManifestSlide {
  id: string;
  title?: string;
  notes?: string;
}

export interface DeckManifest {
  title: string;
  slides: ManifestSlide[];
  /** Phase 2: brand_kit, theme_overrides — present in arch §7 example, ignored here. */
  [key: string]: unknown;
}

export interface BundleInput {
  repoPath: string;
  commitSha: string;
  /**
   * Deck slug — used to emit `<base href="/d/{slug}/">` so relative asset
   * URLs in authored content resolve against the deck's asset route.
   */
  slug: string;
  /**
   * Optional pre-resolved CSS block (typically `:root { --brand-color-*: ... }`)
   * injected as the FIRST style. Resolved by `bundle-service.ts` from the
   * deck's pinned `BrandKitVersion`. Omit for decks with no kit bound.
   */
  brandKitCss?: string;
  /** Identifier surfaced in the injected style tag's `data-source` attr. */
  brandKitLabel?: string;
}

const STYLES_DIR = 'styles/';
const SCRIPTS_DIR = 'scripts/';
const GLOBAL_CSS = 'styles/global.css';
const GLOBAL_JS = 'scripts/global.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Read and parse the deck manifest at the commit. Throws if missing or
 * malformed — a deck without a manifest is unbundleable.
 */
async function readManifest(repoPath: string, sha: string): Promise<DeckManifest> {
  const raw = await readFileAtCommit(repoPath, sha, 'deck.json');
  const parsed = JSON.parse(raw) as DeckManifest;
  if (typeof parsed.title !== 'string') throw new Error('deck.json: missing string title');
  if (!Array.isArray(parsed.slides)) throw new Error('deck.json: missing slides array');
  return parsed;
}

/** Read a file if it exists in the commit; return null if not. */
async function readOptional(
  repoPath: string,
  sha: string,
  relPath: string,
  present: Set<string>,
): Promise<string | null> {
  if (!present.has(relPath)) return null;
  return readFileAtCommit(repoPath, sha, relPath);
}

/**
 * Assemble the bundle. Reads manifest, slide files, all CSS under styles/,
 * and all JS under scripts/. Inlines everything into a single HTML document
 * so a viewer needs zero additional network requests (except for assets,
 * which are referenced as-is in Phase 1).
 */
export async function bundleDeck(input: BundleInput): Promise<string> {
  const { repoPath, commitSha, slug, brandKitCss, brandKitLabel } = input;

  const fileList = await listFilesAtCommit(repoPath, commitSha);
  const present = new Set(fileList);

  const manifest = await readManifest(repoPath, commitSha);

  // Slides in manifest order. Per arch §7: "Slide files are referenced by id
  // matching their filename."
  const slideHtml: string[] = [];
  for (const slide of manifest.slides) {
    const path = `slides/${slide.id}.html`;
    let body: string;
    if (present.has(path)) {
      body = await readFileAtCommit(repoPath, commitSha, path);
    } else {
      // Authored manifests can outpace authored slides — render a stub so
      // the bundle still works rather than 500ing.
      body = `<!-- missing slide file: ${escapeHtml(path)} -->`;
    }
    slideHtml.push(
      `<section class="slide" data-slide-id="${escapeHtml(slide.id)}"${
        slide.title ? ` data-slide-title="${escapeHtml(slide.title)}"` : ''
      }>\n${body}\n</section>`,
    );
  }

  // Styles: brand-kit tokens FIRST (so authored CSS can override), then
  // global, then per-slide CSS in manifest order, then any remaining CSS
  // under styles/ in deterministic order.
  const styleBlocks: string[] = [];
  if (brandKitCss && brandKitCss.trim() !== '') {
    const label = escapeHtml(brandKitLabel ?? 'brand-kit');
    styleBlocks.push(`<style data-source="${label}">\n${brandKitCss}\n</style>`);
  }
  const handledStyles = new Set<string>();
  const globalCss = await readOptional(repoPath, commitSha, GLOBAL_CSS, present);
  if (globalCss !== null) {
    styleBlocks.push(`<style data-source="${GLOBAL_CSS}">\n${globalCss}\n</style>`);
    handledStyles.add(GLOBAL_CSS);
  }
  for (const slide of manifest.slides) {
    const path = `styles/${slide.id}.css`;
    const css = await readOptional(repoPath, commitSha, path, present);
    if (css !== null) {
      styleBlocks.push(`<style data-source="${escapeHtml(path)}">\n${css}\n</style>`);
      handledStyles.add(path);
    }
  }
  for (const file of fileList) {
    if (!file.startsWith(STYLES_DIR) || !file.endsWith('.css')) continue;
    if (handledStyles.has(file)) continue;
    const css = await readFileAtCommit(repoPath, commitSha, file);
    styleBlocks.push(`<style data-source="${escapeHtml(file)}">\n${css}\n</style>`);
  }

  // Scripts: global first, then anything else under scripts/. Same shape.
  const scriptBlocks: string[] = [];
  const handledScripts = new Set<string>();
  const globalJs = await readOptional(repoPath, commitSha, GLOBAL_JS, present);
  if (globalJs !== null) {
    scriptBlocks.push(`<script data-source="${GLOBAL_JS}">\n${globalJs}\n</script>`);
    handledScripts.add(GLOBAL_JS);
  }
  for (const file of fileList) {
    if (!file.startsWith(SCRIPTS_DIR) || !file.endsWith('.js')) continue;
    if (handledScripts.has(file)) continue;
    const js = await readFileAtCommit(repoPath, commitSha, file);
    scriptBlocks.push(`<script data-source="${escapeHtml(file)}">\n${js}\n</script>`);
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<base href="/d/${escapeHtml(slug)}/">`,
    `<meta name="bip-deck-commit" content="${escapeHtml(commitSha)}">`,
    `<title>${escapeHtml(manifest.title)}</title>`,
    ...styleBlocks,
    '</head>',
    '<body>',
    '<main class="deck">',
    ...slideHtml,
    '</main>',
    ...scriptBlocks,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
