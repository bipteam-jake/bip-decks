// POST /api/decks/[id]/ai/conversations — create a new AIConversation.
// Returns the conversation row (no messages yet).
// GET  /api/decks/[id]/ai/conversations — list conversations for the deck,
// newest first. Used by the editor UI to resume the most recent thread.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { createConversation, listConversationsForDeck } from '@/lib/ai/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .optional();

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const conversations = await listConversationsForDeck(params.id);
    return NextResponse.json({ conversations });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    const raw = await req.json().catch(() => undefined);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());

    const conversation = await createConversation({
      deckId: params.id,
      user,
      title: parsed.data?.title ?? null,
    });
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
