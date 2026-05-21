// POST /api/jobs/[id]/cancel — cancel a QUEUED or RUNNING job.
//
// QUEUED:  removed from BullMQ and marked CANCELED in Postgres.
// RUNNING: marked CANCELED in Postgres; the worker checks this status
//          mid-flight (see runAIEditJob) and abandons its result before
//          persisting. The BullMQ job is also removed best-effort but if
//          it's already locked by the worker, the worker run completes
//          its (now ignored) work and returns naturally.
//
// Any other status (DONE / FAILED / AWAITING_REVIEW / CANCELED) returns
// 409 — those have their own actions (accept/reject for AWAITING_REVIEW,
// retry for FAILED).

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { AppError, ConflictError, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { removeBullJob } from '@/lib/queue';
import { CANCELABLE_JOB_STATUSES } from '@bip/shared/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundError('Job not found', 'job_not_found');

    // Phase 1 access rule: only the creator can cancel their own job. We
    // intentionally don't admin-override here — admins can dig into the
    // DB if they really need to nuke something.
    if (job.createdById !== user.id) {
      throw new AppError('forbidden', 'You cannot cancel another user’s job', 403);
    }

    if (!(CANCELABLE_JOB_STATUSES as readonly string[]).includes(job.status)) {
      throw new ConflictError('Job is not cancelable in its current state', 'job_not_cancelable', {
        status: job.status,
      });
    }

    // Update first, then yank from the queue. If queue removal fails the
    // worker will pick the job up, see status=CANCELED, and bail. The
    // Postgres row is the source of truth.
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { status: 'CANCELED', completedAt: new Date() },
    });

    const bullJobId =
      typeof (job.input as { bullJobId?: unknown } | null)?.bullJobId === 'string'
        ? ((job.input as { bullJobId: string }).bullJobId)
        : undefined;
    if (bullJobId) {
      await removeBullJob(bullJobId).catch(() => undefined);
    }

    return NextResponse.json({ job: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
