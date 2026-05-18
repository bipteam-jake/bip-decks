// POST /api/brand-kits/[id]/unarchive — restore a soft-archived kit.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { unarchiveBrandKit } from '@/lib/brand-kits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const kit = await unarchiveBrandKit(id);
    return NextResponse.json({ kit });
  } catch (err) {
    return errorResponse(err);
  }
}
