// POST /api/decks/[id]/archive — archive a deck (hide from default list)
import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { archiveDeck } from '@/lib/decks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const deck = await archiveDeck(params.id);
    return NextResponse.json({ deck });
  } catch (err) {
    return errorResponse(err);
  }
}
