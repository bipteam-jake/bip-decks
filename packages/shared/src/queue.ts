// Shared BullMQ queue contract. Both the Next.js app (enqueue side) and the
// worker process (consume side) import from here, so the queue name, the
// per-kind payload shape, and the default job options are defined in one
// place.
//
// Phase 3 chunk 1 introduces a single queue (`bip-jobs`) shared by every
// JobKind. The BullMQ `name` field on each job is the JobKind string —
// the worker uses that to dispatch to a handler. The payload itself is
// intentionally tiny (just `{ jobId }`): the rich input lives in the
// Postgres `Job` row, which is the source of truth. That keeps Redis as
// pure transport and avoids the classic "payload drift" failure mode
// where the queue and the DB disagree about what the job is supposed to
// do.

import type { JobKind } from '@bip/db';

/** The single BullMQ queue we ship in Phase 3. */
export const QUEUE_NAME = 'bip-jobs';

/**
 * Payload shape per JobKind. Today every kind carries the same fields,
 * but the mapping is kept open per-kind so a future job type that needs
 * extra data (e.g. a scheduled cron tick) can extend without breaking
 * the existing handlers.
 */
export type JobPayloadMap = {
  [K in JobKind]: { jobId: string };
};

export type JobPayload<K extends JobKind = JobKind> = JobPayloadMap[K];

/**
 * Default BullMQ job options applied at enqueue time.
 *  - `attempts: 1`: we don't auto-retry. A failure flips the Postgres Job
 *    row to FAILED and the user sees it in the queue panel; retries are an
 *    explicit user action, not a silent loop.
 *  - `removeOnComplete`: keep completed BullMQ records for a day so
 *    debugging is possible; the Postgres Job row is the long-term record.
 *  - `removeOnFail`: keep failed records longer for postmortems.
 */
export const DEFAULT_JOB_OPTS = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
} as const;

/**
 * Job statuses that count as "active" from a queue panel / cancelation
 * standpoint. Anything in this set is either waiting to run, running,
 * or sitting awaiting a user decision (proposals).
 */
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING', 'AWAITING_REVIEW'] as const;
export type ActiveJobStatus = (typeof ACTIVE_JOB_STATUSES)[number];

/**
 * Statuses we allow to be canceled. AWAITING_REVIEW is NOT cancelable
 * here — that path is the proposal reject route, which also cleans up
 * the git branch. Cancelation is for jobs the worker hasn't decided on.
 */
export const CANCELABLE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const;
export type CancelableJobStatus = (typeof CANCELABLE_JOB_STATUSES)[number];
