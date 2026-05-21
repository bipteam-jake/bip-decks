// Stub handler for JobKinds whose real implementation arrives in a
// later Phase 3 chunk. We deliberately throw so any caller that
// enqueues one of these gets a loud FAILED job rather than a silent
// no-op. Until the chunk lands, the producer side simply shouldn't
// enqueue these kinds.

import type { JobKind } from '@bip/db';

import { prisma } from '@/lib/prisma';

export function handleNotYetImplemented(kind: JobKind): (jobId: string) => Promise<void> {
  return async (postgresJobId: string) => {
    const error = `Handler for JobKind=${kind} is not implemented yet`;
    await prisma.job
      .update({
        where: { id: postgresJobId },
        data: { status: 'FAILED', error, completedAt: new Date() },
      })
      .catch(() => undefined);
    throw new Error(error);
  };
}
