// POST /api/brand-kits — create a new brand kit (no version yet).
// GET  /api/brand-kits — list kits. Query: ?includeArchived=true&limit&offset

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { createBrandKit, listBrandKits, listBrandKitVersions } from '@/lib/brand-kits/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  slug: z.string().min(1).max(60).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const kit = await createBrandKit(parsed.data, user);
    return NextResponse.json({ kit }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

const listSchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  withVersions: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const parsed = listSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw new ValidationError('Invalid query', parsed.error.flatten());
    const { withVersions, ...listOpts } = parsed.data;
    const kits = await listBrandKits(listOpts);
    if (!withVersions) return NextResponse.json({ kits });
    const versionsByKit = await Promise.all(
      kits.map((k) => listBrandKitVersions(k.id)),
    );
    const withVers = kits.map((k, i) => ({
      ...k,
      versions: (versionsByKit[i] ?? []).map((v) => ({
        id: v.id,
        versionLabel: v.versionLabel,
        publishedAt: v.publishedAt,
      })),
    }));
    return NextResponse.json({ kits: withVers });
  } catch (err) {
    return errorResponse(err);
  }
}
