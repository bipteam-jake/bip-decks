// Deck viewer: GET /d/{slug}
//
// Two audiences in Phase 1:
//   - Team users with an admin session: full access to any deck. Honors
//     `?at_commit={sha}` for AI-editor preview iframes (ai-editor.md §8).
//   - Share-link reviewers: must arrive once with `?st={token}` to claim
//     a per-deck recipient cookie, then revisit without it. `?at_commit`
//     is silently ignored for them — they only ever see the head commit.
//
// Anyone else gets 401 (with a redirect to the claim page if a token is
// present so the URL works on first click).

import { NextResponse } from 'next/server';

import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { errorResponse } from '@/lib/api/responses';
import { getSessionContext } from '@/lib/auth/middleware';
import { getBundleBySlug, getBundleForDeck } from '@/lib/decks/bundle-service';
import { getDeckBySlug } from '@/lib/decks/service';
import { getCommentViewer } from '@/lib/comments/viewer';
import { renderCommentsOverlay } from '@/lib/comments/overlay';
import { renderViewerChrome } from '@/lib/decks/viewer-chrome';
import { loadActiveRecipientForDeck } from '@/lib/share-links/service';
import { readRecipientCookie } from '@/lib/share-links/cookies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHA_RE = /^[0-9a-f]{7,40}$/;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const atCommit = url.searchParams.get('at_commit');
    const shareToken = url.searchParams.get('st');

    // -----------------------------------------------------------------
    // 1. Resolve the audience.
    // -----------------------------------------------------------------
    const teamCtx = await getSessionContext();
    const isTeam = teamCtx !== null;

    // Resolve the deck up front so we can check cookies/tokens against it.
    const deck = await getDeckBySlug(slug);

    // Team users skip the share-link gate entirely. For everyone else we
    // either accept the existing recipient cookie or, if a share token is
    // on the URL, bounce them through the claim page.
    let isAuthorized = isTeam;

    if (!isTeam && shareToken) {
      // Token on the URL but no cookie yet → claim flow. We redirect
      // unconditionally rather than guessing whether the recipient cookie
      // already exists; the claim page handles the "already claimed" case
      // by short-circuiting (Phase 2 polish — for now it always shows the
      // name form).
      const claimUrl = new URL('/claim', request.url);
      claimUrl.searchParams.set('token', shareToken);
      return NextResponse.redirect(claimUrl, 303);
    }

    if (!isTeam) {
      const recipientId = await readRecipientCookie(deck.id);
      if (recipientId) {
        const recipient = await loadActiveRecipientForDeck(recipientId, deck.id);
        if (recipient) isAuthorized = true;
      }
    }

    if (!isAuthorized) throw new UnauthorizedError();

    // -----------------------------------------------------------------
    // 2. Bundle. Team users may target a specific commit via `?at_commit`
    //    for the AI editor's diff iframe. Reviewers always see HEAD.
    // -----------------------------------------------------------------
    let html: string;
    let commitSha: string;
    let cacheHit: boolean;
    let deckId: string;
    if (atCommit && isTeam) {
      if (!SHA_RE.test(atCommit)) {
        throw new ValidationError('at_commit must be a hex commit sha');
      }
      const served = await getBundleForDeck(deck, atCommit);
      html = served.html;
      commitSha = served.commitSha;
      cacheHit = served.cacheHit;
      deckId = served.deck.id;
    } else {
      const served = await getBundleBySlug(slug);
      html = served.html;
      commitSha = served.commitSha;
      cacheHit = served.cacheHit;
      deckId = served.deck.id;
    }

    // -----------------------------------------------------------------
    // 3. Inject the comments overlay *after* the cache lookup so the
    //    cached bundle stays viewer-agnostic. The overlay HTML embeds the
    //    viewer's identity (display name, canModerate flag), so it must
    //    be assembled per-request. See lib/comments/overlay.ts.
    //    The viewer chrome (single-slide presentation mode + postMessage
    //    API) is identity-agnostic but injected here too so the cached
    //    bundle bytes stay stable as authored HTML.
    // -----------------------------------------------------------------
    html = injectBeforeBodyClose(html, renderViewerChrome());
    const viewer = await getCommentViewer({ deckId });
    let etagSeed = commitSha;
    if (viewer) {
      const overlay = renderCommentsOverlay({ deckId, viewer });
      html = injectBeforeBodyClose(html, overlay);
      // Vary ETag by viewer identity so two viewers don't share bytes via
      // intermediary caches. Recipients get an `r:` prefix to keep keys
      // disjoint from team users.
      const viewerKey = viewer.kind === 'team' ? `u:${viewer.user.id}` : `r:${viewer.recipient.id}`;
      etagSeed = `${commitSha}.${viewerKey}`;
    }

    // -----------------------------------------------------------------
    // 4. Conditional GET. ETag = commit SHA (+ viewer key) — bundles are
    //    content-addressed and overlay is identity-keyed, so a matching
    //    If-None-Match means the client already has the exact bytes.
    // -----------------------------------------------------------------
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
        // Private: viewer-specific gating means no shared caches.
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
