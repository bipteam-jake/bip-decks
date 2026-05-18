// POST /api/share-links/[id]/revoke — revoke an active share link.
//
// Team-only. Idempotent: revoking an already-revoked link is a no-op.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { revokeShareLink } from '@/lib/share-links/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const shareLink = await revokeShareLink(id);
    return NextResponse.json({ shareLink });
  } catch (err) {
    return errorResponse(err);
  }
}
