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
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const { conversation, messages, jobs } = await getConversation(id);
    return NextResponse.json({ conversation, messages, jobs });
  } catch (err) {
    return errorResponse(err);
  }
}
