// POST /api/outline-conversations/[id]/messages — post a user reply; runs
// the next Claude turn synchronously and returns the updated conversation
// state (messages list, newest last).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { postOutlineMessage } from '@/lib/outline/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ text: z.string().trim().min(1).max(8000) });

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
    const result = await postOutlineMessage({
      conversationId: id,
      user,
      text: parsed.data.text,
      requestId: req.headers.get('x-request-id') ?? undefined,
    });
    return NextResponse.json(
      { conversation: result.conversation, messages: result.messages },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
