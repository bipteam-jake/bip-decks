// BullMQ worker entry point.
//
// One process, one queue (`bip-jobs`). Concurrency is 1 by default — most
// jobs (especially AI_EDIT) drive git mutations on a per-deck working
// branch and we'd rather queue than risk concurrent commits to the same
// repo. Phase 3 chunks may raise this once we have per-deck locking
// outside of the Postgres edit lock (which only protects user-author
// turns, not worker jobs).
//
// The Worker callback is a thin shim that:
//   1. Looks up the BullMQ job's `name` (= JobKind string) and `data.jobId`
//      (= Postgres Job.id).
//   2. Delegates to the dispatcher.
//   3. Swallows nothing — any throw bubbles to BullMQ so it appears in
//      Redis-side failure logs as well as the Postgres Job row.

import { Worker, type Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import type { JobKind } from '@bip/db';
import { QUEUE_NAME } from '@bip/shared/queue';

import { dispatch } from './handlers';
import { startStaleRecoverySweep } from './recovery';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 1);

// BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck:
// false` on the consumer connection.
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

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
      scope: 'worker',
      event,
      ...fields,
    }),
  );
}

const worker = new Worker(
  QUEUE_NAME,
  async (bullJob: BullJob<{ jobId: string }>) => {
    const kind = bullJob.name as JobKind;
    const jobId = bullJob.data?.jobId;
    if (!jobId) {
      // Defensive: an enqueue that forgot to set jobId is a bug.
      throw new Error(`BullMQ job ${bullJob.id} (name=${kind}) has no data.jobId`);
    }
    const start = Date.now();
    log('info', 'job_start', { bullJobId: bullJob.id, kind, jobId });
    try {
      await dispatch(kind, jobId);
      log('info', 'job_done', { bullJobId: bullJob.id, kind, jobId, ms: Date.now() - start });
    } catch (err) {
      log('error', 'job_failed', {
        bullJobId: bullJob.id,
        kind,
        jobId,
        ms: Date.now() - start,
        message: (err as Error).message,
      });
      throw err;
    }
  },
  { connection, concurrency: CONCURRENCY },
);

worker.on('ready', () =>
  log('info', 'worker_ready', { queue: QUEUE_NAME, concurrency: CONCURRENCY }),
);
worker.on('error', (err) => log('error', 'worker_error', { message: err.message }));

// Stale-job recovery runs in the same process; cheap query every 60s.
const recovery = startStaleRecoverySweep();

async function shutdown(signal: string): Promise<void> {
  log('info', 'worker_shutdown_begin', { signal });
  try {
    recovery.stop();
    await worker.close();
    await connection.quit();
  } catch (err) {
    log('error', 'worker_shutdown_error', { message: (err as Error).message });
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
