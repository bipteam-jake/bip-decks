// POST /api/decks/[id]/unarchive — restore an archived deck
import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { unarchiveDeck } from '@/lib/decks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const deck = await unarchiveDeck(id);
    return NextResponse.json({ deck });
  } catch (err) {
    return errorResponse(err);
  }
}
