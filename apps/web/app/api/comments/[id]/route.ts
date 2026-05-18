// PATCH /api/comments/[id] — update status and/or admin note. Team only.
//
// The status workflow is `open → in_review → planned → done → dismissed`
// per docs/bip-deck-platform-architecture.md §11. We accept any transition
// (the doc explicitly says "Transitions are not enforced", arch §4).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { errorResponse } from '@/lib/api/responses';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { getCommentViewer } from '@/lib/comments/viewer';
import { updateCommentStatus } from '@/lib/comments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

const patchSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_REVIEW', 'PLANNED', 'DONE', 'DISMISSED']).optional(),
    // `null` clears the note; omitted leaves it untouched.
    adminNote: z.union([z.string().max(5000), z.null()]).optional(),
  })
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, {
    message: 'Provide status and/or adminNote',
  });

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const viewer = await getCommentViewer();
    if (!viewer) throw new UnauthorizedError();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const comment = await updateCommentStatus({
      commentId: params.id,
      status: parsed.data.status,
      adminNote: parsed.data.adminNote,
      viewer,
    });
    return NextResponse.json({ comment });
  } catch (err) {
    return errorResponse(err);
  }
}
