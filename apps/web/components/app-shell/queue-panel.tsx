'use client';

// QueuePanel — floating bottom-right indicator + popover listing the
// current user's active jobs (QUEUED / RUNNING / AWAITING_REVIEW).
//
// Polls GET /api/jobs/active every 2 seconds while the panel is mounted.
// We deliberately keep polling continuously (not just while expanded) so
// the button badge stays accurate — a job that flips to AWAITING_REVIEW
// in the background still surfaces. The endpoint is cheap (single
// indexed query on Job.createdById + status IN).
//
// Mounted in apps/web/app/(admin)/layout.tsx so it's available on every
// admin route. Not mounted on the public deck runtime (/d/[slug]).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'AWAITING_REVIEW'
  | 'DONE'
  | 'FAILED'
  | 'CANCELED';

type JobKind =
  | 'AI_EDIT'
  | 'AGENTIC_EDIT'
  | 'TRIAGE_SLIDE'
  | 'TRIAGE_ROLLUP'
  | 'MINI_TRIAGE'
  | 'PDF_EXPORT'
  | 'GENERATE_PATTERN_THUMBNAIL'
  | 'PDF_EXTRACT'
  | 'IMAGE_PROCESS';

interface ActiveJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  label: string | null;
  createdAt: string;
  deck: { id: string; title: string; slug: string } | null;
}

const POLL_MS = 2_000;

const KIND_LABELS: Record<JobKind, string> = {
  AI_EDIT: 'AI edit',
  AGENTIC_EDIT: 'Agent run',
  TRIAGE_SLIDE: 'Triage slide',
  TRIAGE_ROLLUP: 'Triage roll-up',
  MINI_TRIAGE: 'Mini triage',
  PDF_EXPORT: 'PDF export',
  GENERATE_PATTERN_THUMBNAIL: 'Pattern thumbnail',
  PDF_EXTRACT: 'PDF extract',
  IMAGE_PROCESS: 'Image process',
};

function statusVariant(status: JobStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'QUEUED':
      return 'outline';
    case 'RUNNING':
      return 'secondary';
    case 'AWAITING_REVIEW':
      return 'default';
    default:
      return 'outline';
  }
}

function isCancelable(status: JobStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

export function QueuePanel() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [open, setOpen] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/active', { credentials: 'same-origin' });
      if (!res.ok) {
        // 401 happens on the login page (no session). Just stop showing
        // anything; the next session-bearing request will resume polling.
        if (res.status === 401) setJobs([]);
        return;
      }
      const body = (await res.json()) as { jobs: ActiveJob[] };
      setJobs(body.jobs);
    } catch {
      /* transient network — next tick */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const cancel = useCallback(
    async (jobId: string) => {
      setCanceling(jobId);
      try {
        const res = await fetch(`/api/jobs/${jobId}/cancel`, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const msg = body?.error?.message ?? `Cancel failed (${res.status})`;
          toast.error(msg);
          return;
        }
        // Optimistic local update so the row disappears immediately;
        // the next poll will reconcile.
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
        toast('Job canceled');
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setCanceling(null);
      }
    },
    [],
  );

  // Counts split so the badge shows in-flight work distinctly from
  // proposals waiting on a human (AWAITING_REVIEW lives in the deck's
  // chat already; the panel is just a global at-a-glance).
  const counts = useMemo(() => {
    let active = 0;
    let awaiting = 0;
    for (const j of jobs) {
      if (j.status === 'QUEUED' || j.status === 'RUNNING') active++;
      else if (j.status === 'AWAITING_REVIEW') awaiting++;
    }
    return { active, awaiting };
  }, [jobs]);

  // Hide the widget entirely when there's nothing in flight. The poll
  // continues in the background so it pops back the instant a new job
  // appears.
  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="default" size="sm" className="shadow-lg">
            {counts.active > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            <span>Jobs</span>
            {counts.active > 0 ? (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {counts.active}
              </Badge>
            ) : null}
            {counts.awaiting > 0 ? (
              <Badge variant="default" className="ml-1 px-1.5 py-0 text-[10px]">
                {counts.awaiting} ready
              </Badge>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
        >
          <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your jobs
          </div>
          <ScrollArea className="max-h-80">
            <ul className="divide-y">
              {jobs.map((job) => (
                <li key={job.id} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant(job.status)} className="text-[10px]">
                          {job.status.replace('_', ' ').toLowerCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {KIND_LABELS[job.kind] ?? job.kind}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm" title={job.label ?? undefined}>
                        {job.label ?? <span className="text-muted-foreground">No label</span>}
                      </div>
                      {job.deck ? (
                        <Link
                          href={`/decks/${job.deck.id}`}
                          className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                          onClick={() => setOpen(false)}
                        >
                          {job.deck.title}
                        </Link>
                      ) : null}
                    </div>
                    {isCancelable(job.status) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => void cancel(job.id)}
                        disabled={canceling === job.id}
                        aria-label="Cancel job"
                        title="Cancel"
                      >
                        {canceling === job.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <Separator />
          <div className="px-3 py-2 text-[10px] text-muted-foreground">
            Updates every {Math.round(POLL_MS / 1000)}s
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
