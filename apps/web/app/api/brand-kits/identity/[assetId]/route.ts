// DELETE /api/brand-kits/identity/[assetId]

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { deleteIdentityAsset } from '@/lib/brand-kits/assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ assetId: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { assetId } = await params;
    await requireTeamUser();
    await deleteIdentityAsset(assetId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
