// dispatch — map BullMQ job names (= JobKind strings) to per-kind handler
// functions. Add new kinds here; throw NotImplementedError until they're
// wired so the queue at least surfaces the gap as a FAILED row instead of
// silently dropping work.
//
// All handlers are called with the Postgres job id only. The handler is
// responsible for reading Job.input, flipping status to RUNNING, and
// terminating in DONE / AWAITING_REVIEW / FAILED. Throwing from a handler
// lets BullMQ record the failure on its side too; the handler must still
// have updated the Job row to FAILED before throwing (see ai-edit.ts).

import type { JobKind } from '@bip/db';

import { handleAIEdit } from './ai-edit';
import { handleNotYetImplemented } from './stub';

type Handler = (postgresJobId: string) => Promise<void>;

const HANDLERS: Record<JobKind, Handler> = {
  AI_EDIT: handleAIEdit,
  // Phase 3 stubs — each lands in its own chunk.
  AGENTIC_EDIT: handleNotYetImplemented('AGENTIC_EDIT'),
  TRIAGE_SLIDE: handleNotYetImplemented('TRIAGE_SLIDE'),
  TRIAGE_ROLLUP: handleNotYetImplemented('TRIAGE_ROLLUP'),
  MINI_TRIAGE: handleNotYetImplemented('MINI_TRIAGE'),
  PDF_EXPORT: handleNotYetImplemented('PDF_EXPORT'),
  GENERATE_PATTERN_THUMBNAIL: handleNotYetImplemented('GENERATE_PATTERN_THUMBNAIL'),
  PDF_EXTRACT: handleNotYetImplemented('PDF_EXTRACT'),
  IMAGE_PROCESS: handleNotYetImplemented('IMAGE_PROCESS'),
};

export async function dispatch(kind: JobKind, postgresJobId: string): Promise<void> {
  const handler = HANDLERS[kind];
  if (!handler) {
    throw new Error(`No handler registered for JobKind=${kind}`);
  }
  await handler(postgresJobId);
}
