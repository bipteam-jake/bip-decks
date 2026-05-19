// GET /api/outline-conversations/[id] — fetch outline conversation +
// messages + deck. Used by /decks/[id]/outline to render the chat + preview.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { getOutlineConversation } from '@/lib/outline/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const result = await getOutlineConversation(id);
    return NextResponse.json({
      conversation: result.conversation,
      deck: result.deck,
      messages: result.messages,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
