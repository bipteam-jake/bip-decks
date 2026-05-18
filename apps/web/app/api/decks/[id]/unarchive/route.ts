// POST /api/decks/[id]/unarchive — restore an archived deck
import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { unarchiveDeck } from '@/lib/decks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const deck = await unarchiveDeck(params.id);
    return NextResponse.json({ deck });
  } catch (err) {
    return errorResponse(err);
  }
}
