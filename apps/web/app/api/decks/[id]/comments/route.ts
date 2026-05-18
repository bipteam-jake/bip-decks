// GET  /api/decks/[id]/comments?slideId=...  — list (tree of top-level
//                                              comments + replies for the
//                                              deck or one slide).
// POST /api/decks/[id]/comments              — create a comment, or a reply
//                                              when parentId is set.
//
// Auth: any authenticated comment viewer (team user OR share-link recipient,
// per docs/bip-deck-platform-architecture.md §11). Phase 1: only team users
// resolve today — see lib/comments/viewer.ts for the planned recipient hook.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { errorResponse } from '@/lib/api/responses';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { getCommentViewer } from '@/lib/comments/viewer';
import { createComment, listComments } from '@/lib/comments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    const viewer = await getCommentViewer({ deckId: id });
    if (!viewer) throw new UnauthorizedError();
    const slideId = req.nextUrl.searchParams.get('slideId') ?? undefined;
    const comments = await listComments({ deckId: id, slideId, viewer });
    return NextResponse.json({ comments });
  } catch (err) {
    return errorResponse(err);
  }
}

const createSchema = z.object({
  slideId: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    const viewer = await getCommentViewer({ deckId: id });
    if (!viewer) throw new UnauthorizedError();
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const comment = await createComment({
      deckId: id,
      slideId: parsed.data.slideId,
      body: parsed.data.body,
      parentId: parsed.data.parentId,
      viewer,
    });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
