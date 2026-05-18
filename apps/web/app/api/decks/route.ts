// POST /api/decks — create a new deck.
// GET  /api/decks — list decks. Query: ?includeArchived=true&limit=50&offset=0

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { createDeck, listDecks } from '@/lib/decks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(60).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const deck = await createDeck(parsed.data, user);
    return NextResponse.json({ deck }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

const listSchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const parsed = listSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw new ValidationError('Invalid query', parsed.error.flatten());
    const decks = await listDecks(parsed.data);
    return NextResponse.json({ decks });
  } catch (err) {
    return errorResponse(err);
  }
}
