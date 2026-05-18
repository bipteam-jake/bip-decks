// POST /api/brand-kits/[id]/versions — publish a new immutable version.
// GET  /api/brand-kits/[id]/versions — list versions (newest first).

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { listBrandKitVersions, publishBrandKitVersion } from '@/lib/brand-kits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// `tokens` and `voice` are validated by parseTokens/parseVoice inside the
// service layer. We accept arbitrary JSON here but require the keys to be
// present (z.unknown() alone makes the field optional in the inferred type).
const publishSchema = z.object({
  versionLabel: z.string().min(1).max(40),
  tokens: z.custom<unknown>((v) => v !== undefined, { message: 'tokens is required' }),
  voice: z.custom<unknown>((v) => v !== undefined, { message: 'voice is required' }),
  summary: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const { versionLabel, tokens, voice, summary } = parsed.data;
    const version = await publishBrandKitVersion(
      { brandKitId: id, versionLabel, tokens, voice, summary },
      user,
    );
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const versions = await listBrandKitVersions(id);
    return NextResponse.json({ versions });
  } catch (err) {
    return errorResponse(err);
  }
}
