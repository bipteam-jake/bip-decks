// GET   /api/brand-kits/[id] — fetch a kit (with latest version summary)
// PATCH /api/brand-kits/[id] — rename

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { getBrandKitById, listBrandKitVersions, renameBrandKit } from '@/lib/brand-kits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const kit = await getBrandKitById(id);
    const versions = await listBrandKitVersions(id);
    return NextResponse.json({ kit, versions });
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({ name: z.string().min(1).max(120) });

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const kit = await renameBrandKit(id, parsed.data.name);
    return NextResponse.json({ kit });
  } catch (err) {
    return errorResponse(err);
  }
}
