// GET /api/jobs/active — list jobs the current user has in flight (any
// non-terminal status). Powers the floating queue panel + the deck
// editor's poll fallback. Returns at most 50; in practice a single user
// will rarely have more than a handful of concurrent jobs.

import { NextResponse } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { prisma } from '@/lib/prisma';
import { ACTIVE_JOB_STATUSES } from '@bip/shared/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    const jobs = await prisma.job.findMany({
      where: {
        createdById: user.id,
        // Cast to mutable string[] for Prisma's enum filter — the typed
        // array on Job.status uses the JobStatus enum, but findMany's
        // `in` accepts strings here without complaint at runtime.
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        deck: {
          select: { id: true, title: true, slug: true },
        },
      },
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    return errorResponse(err);
  }
}
