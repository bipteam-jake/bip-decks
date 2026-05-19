// POST /api/outline-conversations/[id]/approve — write outline slide stubs
// into the deck repo, commit, advance lifecycleStage to DRAFT. One-shot.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { approveOutline } from '@/lib/outline/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();
    const result = await approveOutline({ conversationId: id, user });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
