// POST   /api/comments/[id]/vote — set the viewer's vote: { direction: 1|-1 }
// DELETE /api/comments/[id]/vote — clear the viewer's vote
//
// Either authenticated kind (team user or share-link recipient) may vote.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api/responses';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { getCommentViewer } from '@/lib/comments/viewer';
import { voteComment } from '@/lib/comments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const voteSchema = z.object({
  direction: z.union([z.literal(1), z.literal(-1)]),
});

/**
 * Recipients vote via per-deck cookies, so we first resolve the comment's
 * deck id to look up the correct cookie. One extra round-trip is fine — vote
 * actions are user-initiated, not bulk.
 */
async function deckIdForComment(commentId: string): Promise<string> {
  const row = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { deckId: true },
  });
  if (!row) throw new NotFoundError('Comment not found');
  return row.deckId;
}

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    const deckId = await deckIdForComment(id);
    const viewer = await getCommentViewer({ deckId });
    if (!viewer) throw new UnauthorizedError();
    const parsed = voteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const result = await voteComment({
      commentId: id,
      direction: parsed.data.direction,
      viewer,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    const deckId = await deckIdForComment(id);
    const viewer = await getCommentViewer({ deckId });
    if (!viewer) throw new UnauthorizedError();
    const result = await voteComment({ commentId: id, direction: 0, viewer });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
