// POST /api/brand-kits/[id]/versions/[versionId]/patterns
//   — save a new pattern in this version. Body matches SavePatternInput
//     minus brandKitVersionId (taken from URL).
//
// GET  /api/brand-kits/[id]/versions/[versionId]/patterns
//   — list patterns for the version. Query params:
//       approvedOnly=1   (default: all)
//       category=cover   (filters by lowercase exact match)
//       limit, offset    (pagination, defaults 100/0)
//
// `id` (brand-kit id) is not used by the service but kept in the URL for
// nesting consistency and future audit; the version row is authoritative.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { listPatterns, savePattern } from '@/lib/brand-kits/patterns-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

const saveSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  htmlTemplate: z.string().min(10),
  cssTemplate: z.string().optional(),
  parameters: z.array(z.unknown()).max(40),
  approved: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { versionId } = await params;
    const user = await requireTeamUser();
    const body = await req.json().catch(() => null);
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const pattern = await savePattern({ ...parsed.data, brandKitVersionId: versionId }, user);
    return NextResponse.json({ pattern }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { versionId } = await params;
    await requireTeamUser();
    const url = new URL(req.url);
    const approvedOnly = url.searchParams.get('approvedOnly') === '1';
    const category = url.searchParams.get('category') ?? undefined;
    const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100_000);
    const patterns = await listPatterns({
      brandKitVersionId: versionId,
      approvedOnly,
      category,
      limit,
      offset,
    });
    return NextResponse.json({ patterns });
  } catch (err) {
    return errorResponse(err);
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
