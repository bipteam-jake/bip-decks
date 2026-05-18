// Public deck viewer: GET /d/{slug}
//
// Serves the assembled HTML bundle for the deck's current head commit.
// Phase 1 gates this on an authenticated TEAM session — share-link gating
// (phasing doc §1, "one magic-link share type") will replace this when it
// lands. Until then there is no client-facing exposure.

import { NextResponse } from 'next/server';

import { AppError } from '@/lib/errors';
import { errorResponse } from '@/lib/api/responses';
import { requireTeamUser } from '@/lib/auth/middleware';
import { getBundleBySlug } from '@/lib/decks/bundle-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    await requireTeamUser();
    const { html, commitSha, cacheHit } = await getBundleBySlug(params.slug);

    // ETag = commit SHA: bundles are content-addressed, so a matching
    // If-None-Match means the client already has the exact bytes.
    const etag = `"${commitSha}"`;
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
