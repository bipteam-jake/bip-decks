// GET /api/ai/jobs/[id]/diff — unified diff between the base and proposed
// commits of an AI_EDIT job, used by the proposal card's "Code" tab.
//
// Returns the raw `git diff` text; the client feeds it to diff2html.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { prisma } from '@/lib/prisma';
import { unifiedDiff } from '@/lib/git';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const job = await prisma.job.findUnique({ where: { id: id } });
    if (!job) throw new NotFoundError('Job not found', 'job_not_found');
    if (job.kind !== 'AI_EDIT' || !job.deckId) {
      throw new ValidationError('Job has no diff to show', 'job_no_diff');
    }
    const output = (job.output ?? null) as {
      proposedCommitSha?: string;
      baseCommitSha?: string;
    } | null;
    if (!output?.proposedCommitSha || !output.baseCommitSha) {
      throw new ValidationError('Job has no commit metadata', 'job_no_diff');
    }
    const deck = await prisma.deck.findUniqueOrThrow({
      where: { id: job.deckId },
      select: { repoPath: true },
    });
    const diff = await unifiedDiff(deck.repoPath, output.baseCommitSha, output.proposedCommitSha);
    return NextResponse.json({
      diff,
      baseCommitSha: output.baseCommitSha,
      proposedCommitSha: output.proposedCommitSha,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
