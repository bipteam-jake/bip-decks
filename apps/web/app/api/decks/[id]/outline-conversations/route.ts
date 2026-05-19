// POST /api/decks/[id]/outline-conversations — start an outline-first
// conversation for the deck. Body: { brief: OutlineBrief }. Runs the first
// Claude turn synchronously and returns the conversation + messages.
//
// Phase 2.5; see docs/bip-deck-platform-phasing.md §3 item 3.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { createOutlineConversation } from '@/lib/outline/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const briefSchema = z.object({
  title: z.string().trim().min(1).max(200),
  audience: z.string().trim().min(1).max(2000),
  goal: z.string().trim().min(1).max(2000),
  talkingPoints: z.string().trim().min(1).max(8000),
  tone: z.string().trim().min(1).max(500).optional(),
  targetSlideCount: z.number().int().min(1).max(50).optional(),
  brandContext: z.string().trim().min(1).max(2000).optional(),
});

const bodySchema = z.object({ brief: briefSchema });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();
    const raw = await req.json().catch(() => undefined);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten());
    }

    const result = await createOutlineConversation({
      deckId: id,
      user,
      brief: parsed.data.brief,
      requestId: req.headers.get('x-request-id') ?? undefined,
    });
    return NextResponse.json(
      {
        conversation: result.conversation,
        messages: result.messages,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
