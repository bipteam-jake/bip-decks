// PATCH /api/decks/[id]/brand-kit — pin or unpin the brand-kit version a
// deck renders with. Phase 2.1e (per docs/bip-deck-platform-phasing.md §2.1).
//
// Body: { brandKitVersionId: string | null }
//   - string → pin to that specific BrandKitVersion (validated to exist)
//   - null   → clear the binding (deck renders without injected tokens)

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { setDeckBrandKitVersion } from '@/lib/decks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  brandKitVersionId: z.string().uuid().nullable(),
});

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const deck = await setDeckBrandKitVersion(id, parsed.data.brandKitVersionId);
    return NextResponse.json({ deck });
  } catch (err) {
    return errorResponse(err);
  }
}
