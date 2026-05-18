// POST /api/ai/conversations/[id]/messages — post a user message; the
// server runs one chat-depth turn (context assembly + Claude + parse +
// persist) and returns the persisted user + assistant rows.
//
// Per docs/bip-deck-platform-ai-editor.md §10, failures (timeout, bad JSON,
// rule violation) are surfaced as an assistant message with kind
// 'assistant_error' rather than an HTTP error — the chat stays continuous.

import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { postUserMessage } from '@/lib/ai/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One Claude turn can take up to 60s (ai-editor.md §10). Default Next.js
// serverless timeout is 10s on Vercel, but we control the runtime; this
// constant signals intent for our own Docker deployment.
export const maxDuration = 90;

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
  currentSlideId: z.string().min(1).max(100).optional(),
  /**
   * Acknowledge a pending proposal and auto-reject it (§7). Default false:
   * the API returns 409 `pending_proposal` if a pending proposal exists,
   * giving the UI a chance to confirm with the user.
   */
  supersedePending: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());

    const requestId = req.headers.get('x-request-id') ?? randomUUID();
    const result = await postUserMessage({
      conversationId: id,
      user,
      text: parsed.data.text,
      currentSlideId: parsed.data.currentSlideId,
      supersedePending: parsed.data.supersedePending,
      requestId,
    });

    return NextResponse.json(result, {
      status: 201,
      headers: { 'x-request-id': requestId },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
