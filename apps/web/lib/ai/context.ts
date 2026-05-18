// Build the <deck_state> block that gets prepended to the current-turn user
// message. Per docs/bip-deck-platform-ai-editor.md §4 the application
// assembles a fresh context every turn from the deck's HEAD commit.
//
// What we include:
//   - The deck manifest (slide IDs, titles, order)
//   - The current slide's HTML (the one the user is "on")
//   - styles/global.css in full
//   - scripts/global.js if non-trivial (>1 line of content)
//   - A list of other slide IDs available for reference
//
// Deliberate omissions per §4: other slides' HTML, brand kit (doesn't exist
// in Phase 1), comments, asset binaries.

import { listFilesAtCommit, readFileAtCommit } from '@/lib/git';

export interface BuildContextInput {
  repoPath: string;
  commitSha: string;
  /** Slide the user is currently editing. Defaults to the first slide if omitted. */
  currentSlideId?: string;
}

export interface DeckStateBlock {
  /** Resolved slide id used in the block (after defaulting). */
  currentSlideId: string;
  /** The fully-formed <deck_state>...</deck_state> string, ready to prepend. */
  text: string;
}

interface ManifestSlide {
  id: string;
  title?: string;
}

interface DeckManifest {
  title: string;
  slides: ManifestSlide[];
}

/**
 * Read a file at the commit, returning null if missing rather than throwing.
 * Uses the file list as a cheap presence check before calling git show, so a
 * missing optional file (global.js, current slide) doesn't pollute logs.
 */
async function readOptional(
  repoPath: string,
  sha: string,
  relPath: string,
  present: Set<string>,
): Promise<string | null> {
  if (!present.has(relPath)) return null;
  return readFileAtCommit(repoPath, sha, relPath);
}

export async function buildDeckStateBlock(input: BuildContextInput): Promise<DeckStateBlock> {
  const { repoPath, commitSha } = input;

  const fileList = await listFilesAtCommit(repoPath, commitSha);
  const present = new Set(fileList);

  const manifestRaw = await readFileAtCommit(repoPath, commitSha, 'deck.json');
  const manifest = JSON.parse(manifestRaw) as DeckManifest;
  if (!Array.isArray(manifest.slides) || manifest.slides.length === 0) {
    throw new Error('deck.json has no slides');
  }

  // Pick the slide to focus on. If the caller didn't say or the id is
  // unknown, fall back to the first slide (the manifest is the truth).
  const firstSlide = manifest.slides[0]!;
  const requested = input.currentSlideId;
  const focusSlide: ManifestSlide = requested
    ? (manifest.slides.find((s) => s.id === requested) ?? firstSlide)
    : firstSlide;
  const currentSlideId = focusSlide.id;

  const currentSlidePath = `slides/${currentSlideId}.html`;
  const currentSlideHtml = await readOptional(repoPath, commitSha, currentSlidePath, present);
  const globalCss = await readOptional(repoPath, commitSha, 'styles/global.css', present);
  const globalJsRaw = await readOptional(repoPath, commitSha, 'scripts/global.js', present);
  // "Non-trivial" per §4 — skip the empty starter comment-only file so we
  // don't burn tokens on noise.
  const globalJsBody = globalJsRaw?.trim() ?? '';
  const includeGlobalJs =
    globalJsBody.length > 0 && globalJsBody.split('\n').some((l) => !l.trim().startsWith('//'));

  const otherSlideIds = manifest.slides.map((s) => s.id).filter((id) => id !== currentSlideId);

  // Build the block. We use a labeled-section format rather than nested XML
  // so Claude can parse it tolerantly. The outer <deck_state> tags are the
  // signal: the system prompt doesn't promise structure inside.
  const parts: string[] = [];
  parts.push('<deck_state>');
  parts.push(`Deck title: ${manifest.title}`);
  parts.push(`Slide order: ${manifest.slides.map((s) => s.id).join(', ')}`);
  parts.push(`Currently editing slide: ${currentSlideId}`);
  if (otherSlideIds.length > 0) {
    parts.push(
      `Other slides available (not shown — ask the user for content if you need it): ${otherSlideIds.join(', ')}`,
    );
  }
  parts.push('');
  parts.push(`--- ${currentSlidePath} ---`);
  parts.push(currentSlideHtml ?? '(file missing on disk)');
  parts.push('');
  parts.push('--- styles/global.css ---');
  parts.push(globalCss ?? '(file missing on disk)');
  if (includeGlobalJs) {
    parts.push('');
    parts.push('--- scripts/global.js ---');
    parts.push(globalJsRaw!);
  }
  parts.push('</deck_state>');

  return { currentSlideId, text: parts.join('\n') };
}
