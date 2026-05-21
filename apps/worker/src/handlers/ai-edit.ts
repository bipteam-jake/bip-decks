// AI_EDIT handler — thin adapter from the BullMQ worker into the shared
// runner in apps/web/lib/ai/run-job.ts. The runner owns all behavior;
// this file only translates the BullMQ invocation into a call.

import { runAIEditJob } from '@/lib/ai/run-job';

export async function handleAIEdit(postgresJobId: string): Promise<void> {
  const result = await runAIEditJob(postgresJobId);
  // runAIEditJob already updates the Job row to its terminal state. We
  // re-throw only if the run reported a hard worker-side failure that
  // BullMQ should also see — currently every failure path also marks the
  // Job row, so we don't re-throw here. Logging happens in runAIEditJob.
  if (result.status === 'FAILED') {
    // No throw: the Job row already reflects FAILED. BullMQ's attempts
    // count would otherwise increment but since we ship with attempts=1
    // it doesn't matter; we just want the worker to log success and move
    // on so the next queued job runs.
    return;
  }
}
