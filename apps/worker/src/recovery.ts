// Stale-job recovery sweep.
//
// If a worker process crashes mid-job the Postgres Job row stays RUNNING
// forever — BullMQ will retry the underlying queue job (subject to
// attempts), but the row never moves and the UI keeps a spinner up.
// This sweep catches that: every SWEEP_INTERVAL_MS we look for RUNNING
// rows whose `startedAt` is older than STALE_AFTER_MS and flip them to
// FAILED with an explanatory error.
//
// We also do best-effort branch cleanup for AI_EDIT kind so a stale row
// doesn't leave an orphan `ai-{jobId}` branch in the deck repo.
//
// Note: this runs INSIDE the worker process — meaning a fully dead
// worker host still leaves stale rows until a NEW worker boots. That's
// fine for Phase 3 (we run a single worker container that auto-restarts
// via Docker); when we go HA we'll move this into a separate scheduler.

import type { JobKind } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { branchExists, deleteBranch } from '@/lib/git';

const SWEEP_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 10 * 60_000;

function log(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      scope: 'worker.recovery',
      event,
      ...fields,
    }),
  );
}

async function sweepOnce(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.job.findMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: threshold },
    },
    include: { deck: { select: { repoPath: true } } },
  });
  if (stale.length === 0) return;
  log('warn', 'stale_jobs_found', { count: stale.length });
  for (const job of stale) {
    try {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: 'Job stalled — worker likely crashed before completion',
          completedAt: new Date(),
        },
      });
      // Best-effort branch cleanup for kinds that open working branches.
      if (job.kind === ('AI_EDIT' satisfies JobKind) && job.workingBranch && job.deck) {
        if (await branchExists(job.deck.repoPath, job.workingBranch).catch(() => false)) {
          await deleteBranch(job.deck.repoPath, job.workingBranch, { force: true }).catch(
            () => undefined,
          );
        }
      }
      log('warn', 'stale_job_failed', {
        jobId: job.id,
        kind: job.kind,
        startedAt: job.startedAt?.toISOString() ?? null,
      });
    } catch (err) {
      log('error', 'stale_recovery_error', {
        jobId: job.id,
        message: (err as Error).message,
      });
    }
  }
}

export function startStaleRecoverySweep(): { stop: () => void } {
  // Fire once immediately so a fresh worker boot doesn't have to wait a
  // full interval to clean up crashes from the previous process.
  void sweepOnce().catch((err) =>
    log('error', 'stale_sweep_initial_error', { message: (err as Error).message }),
  );
  const id = setInterval(() => {
    void sweepOnce().catch((err) =>
      log('error', 'stale_sweep_error', { message: (err as Error).message }),
    );
  }, SWEEP_INTERVAL_MS);
  return {
    stop: () => clearInterval(id),
  };
}
