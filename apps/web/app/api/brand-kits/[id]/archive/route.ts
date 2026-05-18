// POST /api/brand-kits/[id]/archive — soft-archive a kit.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { archiveBrandKit } from '@/lib/brand-kits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const kit = await archiveBrandKit(id);
    return NextResponse.json({ kit });
  } catch (err) {
    return errorResponse(err);
  }
}
