// GET /api/ai/conversations/[id] — fetch a conversation with its full
// message history, oldest first. Returns { conversation, messages }.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { getConversation } from '@/lib/ai/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const { conversation, messages } = await getConversation(params.id);
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    return errorResponse(err);
  }
}
