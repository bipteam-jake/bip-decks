// GET    /api/decks/[id]  -- fetch a deck
// PATCH  /api/decks/[id]  -- rename / set lifecycle stage
// DELETE /api/decks/[id]  -- soft-delete

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { getDeckById, softDeleteDeck, updateDeck } from '@/lib/decks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const deck = await getDeckById(params.id);
    return NextResponse.json({ deck });
  } catch (err) {
    return errorResponse(err);
  }
}

const updateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    lifecycleStage: z.enum(['OUTLINE', 'DRAFT', 'REVIEWING', 'FINAL']).optional(),
  })
  .refine((v) => v.title !== undefined || v.lifecycleStage !== undefined, {
    message: 'At least one of title or lifecycleStage must be provided',
  });

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const deck = await updateDeck(params.id, parsed.data);
    return NextResponse.json({ deck });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    await requireTeamUser();
    await softDeleteDeck(params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
