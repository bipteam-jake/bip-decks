// Public deck viewer: GET /d/{slug}
//
// Serves the assembled HTML bundle for the deck's current head commit.
// Phase 1 gates this on an authenticated TEAM session — share-link gating
// (phasing doc §1, "one magic-link share type") will replace this when it
// lands. Until then there is no client-facing exposure.
//
// Per ai-editor.md §8 we also honor `?at_commit={sha}` for internal preview
// (e.g. the AI proposal's diff iframe). Only callable by team users; the
// share-link resolver will not surface this query parameter.

import { NextResponse } from 'next/server';

import { AppError, ValidationError } from '@/lib/errors';
import { errorResponse } from '@/lib/api/responses';
import { requireTeamUser } from '@/lib/auth/middleware';
import { getBundleBySlug, getBundleForDeck } from '@/lib/decks/bundle-service';
import { getDeckBySlug } from '@/lib/decks/service';
import { getCommentViewer } from '@/lib/comments/viewer';
import { renderCommentsOverlay } from '@/lib/comments/overlay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHA_RE = /^[0-9a-f]{7,40}$/;

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    await requireTeamUser();

    const url = new URL(request.url);
    const atCommit = url.searchParams.get('at_commit');

    let html: string;
    let commitSha: string;
    let cacheHit: boolean;
    let deckId: string;
    if (atCommit) {
      if (!SHA_RE.test(atCommit)) {
        throw new ValidationError('at_commit must be a hex commit sha');
      }
      const deck = await getDeckBySlug(params.slug);
      const served = await getBundleForDeck(deck, atCommit);
      html = served.html;
      commitSha = served.commitSha;
      cacheHit = served.cacheHit;
      deckId = served.deck.id;
    } else {
      const served = await getBundleBySlug(params.slug);
      html = served.html;
      commitSha = served.commitSha;
      cacheHit = served.cacheHit;
      deckId = served.deck.id;
    }

    // Inject the comments overlay *after* the cache lookup so the cached
    // bundle stays viewer-agnostic. The overlay HTML embeds the viewer's
    // identity (display name, canModerate flag), so it must be assembled
    // per-request. See lib/comments/overlay.ts for the design notes.
    const viewer = await getCommentViewer();
    let etagSeed = commitSha;
    if (viewer) {
      const overlay = renderCommentsOverlay({ deckId, viewer });
      html = injectBeforeBodyClose(html, overlay);
      // Vary the ETag by viewer identity so two team users don't poison
      // each other's intermediary caches via a shared ETag.
      const viewerKey =
        viewer.kind === 'team' ? `u:${viewer.user.id}` : `r:${viewer.recipient.id}`;
      etagSeed = `${commitSha}.${viewerKey}`;
    }

    // ETag = commit SHA (+ viewer key): bundles are content-addressed and
    // overlay is identity-keyed, so a matching If-None-Match means the
    // client already has the exact bytes.
    const etag = `"${etagSeed}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { etag, 'x-bip-cache': cacheHit ? 'hit' : 'miss' },
      });
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Private: viewer-specific gating comes with share links.
        // Short max-age + etag lets us swap bundles within a minute of a
        // new commit without a hard purge.
        'cache-control': 'private, max-age=60, must-revalidate',
        etag,
        'x-bip-cache': cacheHit ? 'hit' : 'miss',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return errorResponse(err);
    return errorResponse(err);
  }
}

/**
 * Splice a fragment in just before the closing `</body>` tag. Falls back to
 * appending if no `</body>` is present (defensive — every bundle wraps in
 * `<html><body>...`).
 */
function injectBeforeBodyClose(html: string, fragment: string): string {
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + fragment;
  return html.slice(0, idx) + fragment + html.slice(idx);
}
