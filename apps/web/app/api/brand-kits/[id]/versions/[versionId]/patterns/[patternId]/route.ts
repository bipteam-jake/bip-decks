// PATCH  /api/brand-kits/[id]/versions/[versionId]/patterns/[patternId]
//   — update mutable metadata (name, description, category, tags, approved).
//
// DELETE /api/brand-kits/[id]/versions/[versionId]/patterns/[patternId]
//   — hard-delete the pattern. Cascades from the version anyway.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { deletePattern, updatePattern } from '@/lib/brand-kits/patterns-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string; patternId: string }> };

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  approved: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { patternId } = await params;
    await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const pattern = await updatePattern(patternId, parsed.data);
    return NextResponse.json({ pattern });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { patternId } = await params;
    await requireTeamUser();
    await deletePattern(patternId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
