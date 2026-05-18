// DELETE /api/brand-kits/references/[refId]

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { deleteReference } from '@/lib/brand-kits/assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ refId: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { refId } = await params;
    await requireTeamUser();
    await deleteReference(refId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
