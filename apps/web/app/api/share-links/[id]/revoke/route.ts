// POST /api/share-links/[id]/revoke — revoke an active share link.
//
// Team-only. Idempotent: revoking an already-revoked link is a no-op.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { revokeShareLink } from '@/lib/share-links/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const shareLink = await revokeShareLink(params.id);
    return NextResponse.json({ shareLink });
  } catch (err) {
    return errorResponse(err);
  }
}
