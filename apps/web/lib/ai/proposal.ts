// AI-edit proposal lifecycle, per docs/bip-deck-platform-ai-editor.md §7.
//
// One AI turn that produces changes goes through three stages, each owned
// here:
//   1. buildProposal — given a validated AIEditResponse, create the Job row,
//      open the working branch, commit the files, prime the bundle cache,
//      flip Job to AWAITING_REVIEW. Returns the resulting Job.
//   2. acceptProposal — ff-merge `main`, update Deck.headCommitSha, delete
//      the working branch, invalidate the old-head cache entry. Job → DONE.
//   3. rejectProposal — force-delete the working branch. Job → CANCELED.
//      Used both by the user's explicit reject and by auto-supersede when
//      a new chat message arrives with a pending proposal (§7).
//
// We never throw out of acceptProposal / rejectProposal with the job in an
// inconsistent in-DB state: best-effort recovery + Job → FAILED on git
// errors. The git operations are serialized per-repo by virtue of running
// on a single Node process; concurrent edits across decks are fine.

import type { Deck, Job, User, Prisma } from '@bip/db';

import { prisma } from '@/lib/prisma';
import {
  commitProposalOnBranch,
  fastForwardMain,
  deleteBranch,
  branchExists,
  type ProposalChange,
} from '@/lib/git';
import { getBundleForDeck } from '@/lib/decks/bundle-service';
import { invalidateCachedBundle } from '@/lib/decks/bundle-cache';
import { getDeckById } from '@/lib/decks/service';
import { NotFoundError, ConflictError, ValidationError, AppError } from '@/lib/errors';
import { acquireOrRefreshLock } from '@/lib/ai/lock';
import type { AIEditResponse } from './response-parser';

// ---------------------------------------------------------------------------
// Job input/output shapes (stored as Json on the row)
// ---------------------------------------------------------------------------

export interface AIEditJobInput {
  conversationId: string;
  /** Mirror of the AIMessage row that triggered the job (for traceability). */
  triggeringMessageId: string;
  /** Snapshot of the proposed changes so the job is self-describing. */
  changes: ProposalChange[];
  /** Claude's explanation, for the commit message and the UI. */
  explanation: string;
}

export interface AIEditJobOutput {
  /** SHA on the working branch (i.e. the proposed new head). */
  proposedCommitSha: string;
  /** SHA the proposal was based on at create time (= Deck.headCommitSha then). */
  baseCommitSha: string;
  /** After accept: the new Deck.headCommitSha (= proposedCommitSha if ff). */
  acceptedCommitSha?: string;
  /** Optional supersede marker when auto-rejected by a follow-up message. */
  supersededBy?: { messageId: string; conversationId: string };
}

function asJobInput(value: unknown): AIEditJobInput {
  return value as AIEditJobInput;
}

function asJobOutput(value: unknown): AIEditJobOutput | null {
  return (value ?? null) as AIEditJobOutput | null;
}

function branchNameForJob(jobId: string): string {
  return `ai-${jobId}`;
}

function shortSummary(explanation: string, maxLen = 72): string {
  const single = explanation.replace(/\s+/g, ' ').trim();
  return single.length <= maxLen ? single : `${single.slice(0, maxLen - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Build (§7 step 1–4 + cache prime)
// ---------------------------------------------------------------------------

export interface BuildProposalInput {
  deck: Deck;
  user: User;
  response: AIEditResponse;
  conversationId: string;
  triggeringMessageId: string;
  requestId?: string;
}

export interface BuildProposalResult {
  job: Job;
  proposedCommitSha: string;
}

/**
 * Create a Job (RUNNING), open `ai-{job_id}` off the deck head, commit the
 * changes with `[ai] {summary}`, prime the bundle cache for the new SHA,
 * flip the job to AWAITING_REVIEW. Callers persist the related AIMessage
 * with `relatedJobId = job.id` afterward.
 */
export async function buildProposal(input: BuildProposalInput): Promise<BuildProposalResult> {
  const { deck, user, response, conversationId, triggeringMessageId, requestId } = input;

  if (!response.changes || response.changes.length === 0) {
    throw new ValidationError('Proposal has no changes', 'proposal_no_changes');
  }
  if (!deck.headCommitSha) {
    throw new NotFoundError('Deck has no committed content', 'deck_no_head');
  }

  // 1. Create the Job in RUNNING — git work happens inline, no queue (Phase 1).
  const jobInput: AIEditJobInput = {
    conversationId,
    triggeringMessageId,
    changes: response.changes,
    explanation: response.explanation,
  };
  const job = await prisma.job.create({
    data: {
      deckId: deck.id,
      kind: 'AI_EDIT',
      status: 'RUNNING',
      createdById: user.id,
      label: shortSummary(response.explanation),
      input: jobInput as unknown as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
  });

  const branchName = branchNameForJob(job.id);

  try {
    // 2-4. Branch, write files, commit on the working branch.
    const { commitSha } = await commitProposalOnBranch({
      absPath: deck.repoPath,
      branchName,
      baseCommitSha: deck.headCommitSha,
      changes: response.changes,
      message: `[ai] ${shortSummary(response.explanation)}`,
      author: { name: user.name, email: user.email },
    });

    // 5. Prime the bundle cache for the new commit so the diff preview
    //    iframe renders without a build wait.
    try {
      await getBundleForDeck(deck, commitSha);
    } catch (err) {
      // Cache priming is best-effort; bundling can still fail later if the
      // proposed HTML is malformed (§10: "user sees broken preview and
      // rejects"). Log but don't abort the proposal.
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          scope: 'ai-editor',
          event: 'cache_prime_failed',
          jobId: job.id,
          requestId: requestId ?? null,
          message: (err as Error).message,
        }),
      );
    }

    // 6. Flip to AWAITING_REVIEW.
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'AWAITING_REVIEW',
        workingBranch: branchName,
        output: {
          proposedCommitSha: commitSha,
          baseCommitSha: deck.headCommitSha,
        } satisfies AIEditJobOutput as unknown as Prisma.InputJsonValue,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-editor',
        event: 'proposal_built',
        jobId: job.id,
        deckId: deck.id,
        branch: branchName,
        baseCommitSha: deck.headCommitSha,
        proposedCommitSha: commitSha,
        requestId: requestId ?? null,
      }),
    );

    return { job: updated, proposedCommitSha: commitSha };
  } catch (err) {
    // Roll back: mark FAILED and best-effort-delete any half-created branch.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job
      .update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: message,
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);
    if (await branchExists(deck.repoPath, branchName).catch(() => false)) {
      await deleteBranch(deck.repoPath, branchName, { force: true }).catch(() => undefined);
    }
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-editor',
        event: 'proposal_build_failed',
        jobId: job.id,
        deckId: deck.id,
        requestId: requestId ?? null,
        message,
      }),
    );
    throw err instanceof AppError
      ? err
      : new AppError('proposal_failed', 'Failed to apply the proposed change', 500);
  }
}

// ---------------------------------------------------------------------------
// Accept (§7 "Accept")
// ---------------------------------------------------------------------------

export interface AcceptProposalInput {
  jobId: string;
  user: User;
}

export interface AcceptProposalResult {
  job: Job;
  newHeadCommitSha: string;
}

export async function acceptProposal(input: AcceptProposalInput): Promise<AcceptProposalResult> {
  const { jobId, user } = input;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError('Job not found', 'job_not_found');
  if (job.kind !== 'AI_EDIT') {
    throw new ValidationError('Job is not an AI edit', 'job_wrong_kind');
  }
  if (job.status !== 'AWAITING_REVIEW') {
    throw new ConflictError(`Job is ${job.status.toLowerCase()}, cannot accept`, 'job_not_pending');
  }
  if (!job.deckId || !job.workingBranch) {
    throw new ValidationError('Job is malformed (missing deck or branch)', 'job_malformed');
  }
  const deck = await getDeckById(job.deckId);
  const output = asJobOutput(job.output);
  if (!output) throw new ValidationError('Job has no output', 'job_no_output');

  // Briefly re-acquire the lock to fence other writers. If someone else is
  // editing, they need to take over before we apply.
  await acquireOrRefreshLock(deck.id, user.id);

  // Head-moved guard (§7 accept step 2). With the lock this shouldn't trip;
  // we check anyway because the FS is the source of truth.
  if (deck.headCommitSha !== output.baseCommitSha) {
    throw new ConflictError('Deck head moved since this proposal was created', 'head_moved', {
      expected: output.baseCommitSha,
      actual: deck.headCommitSha,
    });
  }

  const oldHead = deck.headCommitSha;
  try {
    const newHead = await fastForwardMain(deck.repoPath, job.workingBranch);

    await prisma.deck.update({
      where: { id: deck.id },
      data: { headCommitSha: newHead },
    });
    await deleteBranch(deck.repoPath, job.workingBranch, { force: false }).catch(() =>
      // After a clean ff-merge the branch is fully reachable from main, so a
      // safe delete should succeed; fall back to force if git refuses.
      deleteBranch(deck.repoPath, job.workingBranch!, { force: true }),
    );
    if (oldHead) await invalidateCachedBundle(deck.id, oldHead, deck.brandKitVersionId ?? null);

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'DONE',
        completedAt: new Date(),
        workingBranch: null,
        output: {
          ...output,
          acceptedCommitSha: newHead,
        } satisfies AIEditJobOutput as unknown as Prisma.InputJsonValue,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: 'ai-editor',
        event: 'proposal_accepted',
        jobId: job.id,
        deckId: deck.id,
        oldHead,
        newHead,
      }),
    );

    return { job: updated, newHeadCommitSha: newHead };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job
      .update({
        where: { id: job.id },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      })
      .catch(() => undefined);
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        scope: 'ai-editor',
        event: 'proposal_accept_failed',
        jobId: job.id,
        deckId: deck.id,
        message,
      }),
    );
    throw err instanceof AppError
      ? err
      : new AppError('accept_failed', 'Failed to accept proposal', 500);
  }
}

// ---------------------------------------------------------------------------
// Reject + supersede (§7 "Reject" and "Iterating")
// ---------------------------------------------------------------------------

export interface RejectProposalInput {
  jobId: string;
  /** When set, recorded on the job output as the reason for an auto-reject. */
  supersededBy?: { messageId: string; conversationId: string };
  /** True for auto-reject by the system rather than an explicit user click. */
  automatic?: boolean;
}

export async function rejectProposal(input: RejectProposalInput): Promise<Job> {
  const { jobId, supersededBy, automatic } = input;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError('Job not found', 'job_not_found');
  if (job.kind !== 'AI_EDIT') {
    throw new ValidationError('Job is not an AI edit', 'job_wrong_kind');
  }
  if (job.status !== 'AWAITING_REVIEW') {
    // Idempotent: rejecting an already-resolved job is a no-op success.
    return job;
  }
  if (!job.deckId) {
    throw new ValidationError('Job has no deck', 'job_malformed');
  }
  const deck = await getDeckById(job.deckId);

  if (job.workingBranch && (await branchExists(deck.repoPath, job.workingBranch))) {
    await deleteBranch(deck.repoPath, job.workingBranch, { force: true }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          scope: 'ai-editor',
          event: 'branch_delete_failed',
          jobId: job.id,
          branch: job.workingBranch,
          message: (err as Error).message,
        }),
      );
    });
  }

  const existingOutput = asJobOutput(job.output) ?? { proposedCommitSha: '', baseCommitSha: '' };
  const updated = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'CANCELED',
      completedAt: new Date(),
      workingBranch: null,
      output: {
        ...existingOutput,
        ...(supersededBy ? { supersededBy } : {}),
      } satisfies AIEditJobOutput as unknown as Prisma.InputJsonValue,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      scope: 'ai-editor',
      event: 'proposal_rejected',
      jobId: job.id,
      deckId: deck.id,
      automatic: Boolean(automatic),
      superseded: Boolean(supersededBy),
    }),
  );

  return updated;
}

/**
 * Auto-reject every pending AI_EDIT proposal on a conversation. Called from
 * postUserMessage when a new turn supersedes a pending proposal (§7).
 * Returns the ids of the jobs that were canceled.
 */
export async function autoRejectPendingForConversation(input: {
  conversationId: string;
  supersedingMessageId: string;
}): Promise<string[]> {
  // Pending jobs are linked via AIMessage.relatedJobId on assistant messages
  // in this conversation. (Job has no direct conversationId column — we
  // route through the message that produced it.)
  const pendingMessages = await prisma.aIMessage.findMany({
    where: {
      conversationId: input.conversationId,
      relatedJobId: { not: null },
      relatedJob: { status: 'AWAITING_REVIEW', kind: 'AI_EDIT' },
    },
    select: { relatedJobId: true },
  });

  const canceled: string[] = [];
  for (const m of pendingMessages) {
    if (!m.relatedJobId) continue;
    await rejectProposal({
      jobId: m.relatedJobId,
      supersededBy: {
        messageId: input.supersedingMessageId,
        conversationId: input.conversationId,
      },
      automatic: true,
    });
    canceled.push(m.relatedJobId);
  }
  return canceled;
}

export async function listPendingForConversation(conversationId: string): Promise<Job[]> {
  const rows = await prisma.aIMessage.findMany({
    where: {
      conversationId,
      relatedJobId: { not: null },
      relatedJob: { status: 'AWAITING_REVIEW', kind: 'AI_EDIT' },
    },
    select: { relatedJob: true },
  });
  return rows.map((r) => r.relatedJob!).filter((j): j is Job => Boolean(j));
}

export { asJobInput, asJobOutput };
