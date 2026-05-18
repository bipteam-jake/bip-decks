// GET /api/ai/jobs/[id] — fetch a single Job. Used by the editor UI to
// re-hydrate proposal cards after navigation or to poll state transitions.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const job = await prisma.job.findUnique({ where: { id: params.id } });
    if (!job) throw new NotFoundError('Job not found', 'job_not_found');
    return NextResponse.json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
