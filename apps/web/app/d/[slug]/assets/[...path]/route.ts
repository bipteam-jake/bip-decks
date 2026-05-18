// Asset serving for the view-time bundle: GET /d/{slug}/assets/{...path}
//
// The bundler emits `<base href="/d/{slug}/">` in the document head, so
// authored references like `<img src="assets/foo.png">` or CSS
// `url(assets/foo.png)` resolve here. We read the file straight from the
// deck's git tree at its head commit — never from a working checkout — so
// asset content matches whatever bundle the viewer is looking at.
//
// Phase 1 only. Architecture doc §7 calls for signed object-storage URLs in
// a later phase; this is the simpler in-process replacement until then.

import path from 'node:path';
import { NextResponse } from 'next/server';

import { AppError, NotFoundError } from '@/lib/errors';
import { errorResponse } from '@/lib/api/responses';
import { requireTeamUser } from '@/lib/auth/middleware';
import { getDeckBySlug } from '@/lib/decks/service';
import { readBlobAtCommit } from '@/lib/git';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASSETS_DIR = 'assets';

// Minimal content-type map. Authors are the same people running the server;
// when they add a new extension they can add the mapping here. Falls back to
// application/octet-stream so unknown types still serve safely.
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
};

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Validate and join the [...path] segments into a repo-relative asset path.
 * Rejects empty segments, traversal (`..`), absolute fragments, and NUL
 * bytes. The result always starts with `assets/`.
 */
function safeJoinAssetPath(parts: string[]): string | null {
  if (parts.length === 0) return null;
  for (const seg of parts) {
    if (seg === '' || seg === '.' || seg === '..') return null;
    if (seg.includes('/') || seg.includes('\\') || seg.includes('\0')) return null;
  }
  return `${ASSETS_DIR}/${parts.join('/')}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  try {
    await requireTeamUser();
    const { slug, path: pathSegments } = await params;

    const relPath = safeJoinAssetPath(pathSegments);
    if (!relPath) throw new NotFoundError('Asset not found', 'asset_invalid_path');

    const deck = await getDeckBySlug(slug);
    if (!deck.headCommitSha) {
      throw new NotFoundError('Deck has no published content', 'deck_no_head');
    }

    let bytes: Buffer;
    try {
      bytes = await readBlobAtCommit(deck.repoPath, deck.headCommitSha, relPath);
    } catch {
      // git show exits non-zero for missing paths; surface as 404.
      throw new NotFoundError('Asset not found', 'asset_not_in_commit');
    }

    const etag = `"${deck.headCommitSha}:${relPath}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { etag } });
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': contentTypeFor(relPath),
        'content-length': bytes.byteLength.toString(),
        // Content-addressed by commit SHA, so immutable for that ETag.
        'cache-control': 'private, max-age=60, must-revalidate',
        etag,
      },
    });
  } catch (err) {
    if (err instanceof AppError) return errorResponse(err);
    return errorResponse(err);
  }
}
