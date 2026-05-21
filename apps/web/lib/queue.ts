// BullMQ queue singleton for the Next.js app. The web tier is the
// producer side of the queue — it only enqueues. Consumption happens in
// apps/worker. The Queue instance is cached on globalThis so HMR doesn't
// open a new Redis connection on every file change in dev.
//
// Per docs/bip-deck-platform-architecture.md the queue contract is:
//   - One queue (`bip-jobs`, defined in @bip/shared/queue).
//   - BullMQ job `name` is the JobKind string.
//   - BullMQ job `data` is `{ jobId }`; the real payload is on the
//     Postgres Job row, written before enqueue.
//
// We always create the Job row first, then enqueue. If enqueue fails the
// row stays in QUEUED status and the stale-recovery sweep (worker side)
// will surface it as FAILED after the grace window. That's intentionally
// noisy — a Redis outage shouldn't be invisible.

import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { Job, JobKind, JobStatus, Prisma, User } from '@bip/db';
import { DEFAULT_JOB_OPTS, QUEUE_NAME } from '@bip/shared/queue';

import { prisma } from '@/lib/prisma';

declare global {
  // eslint-disable-next-line no-var
  var __bipQueue: Queue | undefined;
  // eslint-disable-next-line no-var
  var __bipQueueRedis: Redis | undefined;
}

function buildRedis(): Redis {
  // BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck:
  // false` on the connection it uses for blocking commands. We keep a
  // separate ioredis instance for the queue so the general @/lib/redis.ts
  // can stay configured for cache/short-lived ops.
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function buildQueue(): Queue {
  const connection = globalThis.__bipQueueRedis ?? buildRedis();
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__bipQueueRedis = connection;
  }
  return new Queue(QUEUE_NAME, { connection, defaultJobOptions: DEFAULT_JOB_OPTS });
}

export const jobsQueue: Queue =
  globalThis.__bipQueue ??
  (() => {
    const q = buildQueue();
    if (process.env.NODE_ENV !== 'production') {
      globalThis.__bipQueue = q;
    }
    return q;
  })();

// ---------------------------------------------------------------------------
// enqueueJob — the single seam every producer should use.
//
// Creates a Postgres Job row in QUEUED status, then pushes a BullMQ job
// whose `data.jobId` points at it. Returns the persisted Job row so the
// caller can hand it straight back to the UI.
//
// The bullmq job id is stored back into Job.input.bullJobId so the
// cancelation path can remove it from the queue even if the worker
// hasn't picked it up yet (e.g. cancel from QUEUED state).
// ---------------------------------------------------------------------------

export interface EnqueueJobInput<K extends JobKind> {
  kind: K;
  deckId: string | null;
  createdBy: Pick<User, 'id'>;
  label: string | null;
  /**
   * Rich job input persisted to Job.input — this is what the worker reads
   * via prisma.job.findUnique. Keep it small enough to fit in JSONB but
   * comprehensive enough that the job is self-describing.
   */
  input: Record<string, unknown>;
}

export async function enqueueJob<K extends JobKind>(args: EnqueueJobInput<K>): Promise<Job> {
  const job = await prisma.job.create({
    data: {
      deckId: args.deckId,
      kind: args.kind,
      status: 'QUEUED' satisfies JobStatus,
      createdById: args.createdBy.id,
      label: args.label,
      input: args.input as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const bullJob = await jobsQueue.add(
      args.kind,
      { jobId: job.id },
      {
        // jobId in BullMQ controls dedupe. We tie it to the postgres row
        // id so re-enqueuing the same row is a no-op (defensive — we
        // never expect to re-enqueue, but cheap insurance).
        jobId: job.id,
      },
    );
    // Stash the bull job id on the row so cancel can remove it cleanly.
    const merged = { ...(args.input as object), bullJobId: bullJob.id ?? job.id };
    await prisma.job.update({
      where: { id: job.id },
      data: { input: merged as unknown as Prisma.InputJsonValue },
    });
    return { ...job, input: merged as unknown as Prisma.JsonValue } as Job;
  } catch (err) {
    // Couldn't push to Redis — mark the row FAILED so the user sees it
    // rather than a silent QUEUED-forever entry.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job
      .update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: `Failed to enqueue: ${message}`,
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Best-effort removal of a BullMQ job by id. Used by the cancel path.
 * Returns true if it found and removed the entry, false otherwise.
 */
export async function removeBullJob(bullJobId: string): Promise<boolean> {
  try {
    const bj = await jobsQueue.getJob(bullJobId);
    if (!bj) return false;
    await bj.remove();
    return true;
  } catch {
    return false;
  }
}
