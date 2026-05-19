'use client';

// Deck editor — the centerpiece of Phase 1. Owns the layout, the chat
// panel state, and the proposal review UI. See:
//   - docs/bip-deck-platform-ai-editor.md §11 (layout)
//   - §8 (visual diff)
//   - §9 (edit lock + heartbeat)
//
// Page composition:
//   ┌─ header (title, head sha, details) ─────────────────────────────┐
//   ├─ main (preview iframe OR side-by-side proposal iframes) ─┬─ chat ┤
//   │                                                          │       │
//   └──────────────────────────────────────────────────────────┴───────┘
//
// All AI state (conversation, messages, jobs, pending proposal) is held
// here. Server fetches initial state; from then on we mutate locally and
// `router.refresh()` only when the deck head moves (post-accept) so the
// downstream server props refresh too.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Lock as LockIcon,
  MapPin,
  MessageSquare,
  Send as SendIcon,
  Sparkles,
} from 'lucide-react';

import type { AIConversation, AIMessage, Job } from '@bip/db';
import { HEARTBEAT_INTERVAL_MS, type LockState } from '@/lib/ai/lock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PatternPickerButton } from './_components/pattern-picker-button';

const CodeDiff = dynamic(() => import('./code-diff').then((m) => m.CodeDiff), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-muted-foreground">Loading diff…</div>,
});

const CHAT_OPEN_KEY = 'bip.deck-editor.chat-open';

// ---------------------------------------------------------------------------
// Types mirroring service.ts message-content shape so we can render safely
// without importing the server module into the client bundle.
// ---------------------------------------------------------------------------

type UserContent = { kind: 'user'; text: string; slideId?: string };
type AssistantOkContent = {
  kind: 'assistant';
  raw: string;
  parsed: { explanation: string; changes?: unknown[] };
};
type AssistantErrContent = {
  kind: 'assistant_error';
  raw: string;
  userMessage: string;
  error: unknown;
};
type MessageContent = UserContent | AssistantOkContent | AssistantErrContent;

function asContent(value: unknown): MessageContent {
  return value as MessageContent;
}

interface DeckSummary {
  id: string;
  slug: string;
  title: string;
  headCommitSha: string | null;
  /** Brand kit version bound to this deck (null = no kit). */
  brandKitVersionId: string | null;
  /** Parent brand kit id, resolved server-side so the picker can call the
   *  nested REST route without a round trip. Null iff brandKitVersionId is null. */
  brandKitId: string | null;
}

export interface DeckEditorProps {
  deck: DeckSummary;
  initialConversation: AIConversation | null;
  initialMessages: AIMessage[];
  initialJobs: Record<string, Job>;
  /** Logged-in user id — used to detect "you" vs "another user" on lock. */
  currentUserId: string;
}

// ---------------------------------------------------------------------------

export function DeckEditor(props: DeckEditorProps) {
  const router = useRouter();
  const [conversation, setConversation] = useState<AIConversation | null>(
    props.initialConversation,
  );
  const [messages, setMessages] = useState<AIMessage[]>(props.initialMessages);
  const [jobs, setJobs] = useState<Record<string, Job>>(props.initialJobs);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSupersede, setConfirmSupersede] = useState(false);
  const [lock, setLock] = useState<LockState | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  // Local view of deck head. Props refresh lags behind the accept response
  // because router.refresh() is async; tracking it here lets us cache-bust
  // the preview iframe immediately so the new commit's HTML is visible
  // without a manual reload (the /d/{slug} response is cache-control:
  // private, max-age=60 — without a URL bump the browser would re-use the
  // pre-edit bytes).
  const [headCommitSha, setHeadCommitSha] = useState<string | null>(props.deck.headCommitSha);

  // Derive the latest pending proposal from messages + jobs. A message has a
  // proposal if its content.kind === 'assistant' AND jobs[relatedJobId] is
  // AWAITING_REVIEW. Walk in reverse for the most recent.
  const pending = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (!m.relatedJobId) continue;
      const job = jobs[m.relatedJobId];
      if (job && job.status === 'AWAITING_REVIEW') return { message: m, job };
    }
    return null;
  }, [messages, jobs]);

  // -------------------------------------------------------------------------
  // Edit-lock heartbeat (§9). Ping every HEARTBEAT_INTERVAL_MS while the
  // editor is open. On unmount, fire-and-forget a release call. If the
  // ping returns 409 deck_locked, capture the owner state so we can show
  // the take-over affordance.
  // -------------------------------------------------------------------------

  const heartbeat = useCallback(async () => {
    try {
      const res = await fetch(`/api/decks/${props.deck.id}/lock`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setLock({
          heldByOther: true,
          ownerUserId: body?.error?.details?.ownerUserId ?? null,
          heartbeatAt: body?.error?.details?.heartbeatAt
            ? new Date(body.error.details.heartbeatAt)
            : null,
          ageMs: body?.error?.details?.ageMs ?? null,
        });
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as { lock: LockState };
        // Server returns ISO string for Date fields; normalize.
        setLock({
          ...body.lock,
          heartbeatAt: body.lock.heartbeatAt ? new Date(body.lock.heartbeatAt) : null,
        });
      }
    } catch {
      // Network blip; next tick will retry.
    }
  }, [props.deck.id]);

  useEffect(() => {
    void heartbeat();
    const id = window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      // Release on unmount. Use sendBeacon-style fire-and-forget; keepalive
      // is supported on modern browsers for the unmount/navigation case.
      try {
        void fetch(`/api/decks/${props.deck.id}/lock`, {
          method: 'DELETE',
          credentials: 'same-origin',
          keepalive: true,
        });
      } catch {
        /* ignore */
      }
    };
  }, [heartbeat, props.deck.id]);

  // -------------------------------------------------------------------------
  // Conversation actions
  // -------------------------------------------------------------------------

  const ensureConversation = useCallback(async (): Promise<AIConversation> => {
    if (conversation) return conversation;
    const res = await fetch(`/api/decks/${props.deck.id}/ai/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Failed to start conversation (${res.status})`);
    const body = (await res.json()) as { conversation: AIConversation };
    setConversation(body.conversation);
    return body.conversation;
  }, [conversation, props.deck.id]);

  const send = useCallback(
    async (text: string, supersedePending: boolean): Promise<void> => {
      if (!text.trim()) return;
      setSending(true);
      setError(null);
      try {
        const convo = await ensureConversation();
        const res = await fetch(`/api/ai/conversations/${convo.id}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, supersedePending }),
        });
        if (res.status === 409) {
          const body = await res.json().catch(() => null);
          if (body?.error?.code === 'pending_proposal') {
            setConfirmSupersede(true);
            return;
          }
          if (body?.error?.code === 'deck_locked') {
            setLock({
              heldByOther: true,
              ownerUserId: body.error.details?.ownerUserId ?? null,
              heartbeatAt: body.error.details?.heartbeatAt
                ? new Date(body.error.details.heartbeatAt)
                : null,
              ageMs: body.error.details?.ageMs ?? null,
            });
            return;
          }
          setError(body?.error?.message ?? `Request failed (${res.status})`);
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? `Request failed (${res.status})`);
          return;
        }
        const result = (await res.json()) as {
          userMessage: AIMessage;
          assistantMessage: AIMessage;
          job: Job | null;
          supersededJobIds: string[];
        };
        setMessages((prev) => {
          // Drop any local-superseded jobs from being shown as pending —
          // jobs map update below also flips their status.
          return [...prev, result.userMessage, result.assistantMessage];
        });
        setJobs((prev) => {
          const next = { ...prev };
          // Mark superseded jobs as canceled locally so the pending-derive
          // doesn't keep showing them between fetches.
          for (const id of result.supersededJobIds) {
            const j = next[id];
            if (j) next[id] = { ...j, status: 'CANCELED' } as Job;
          }
          if (result.job) next[result.job.id] = result.job;
          return next;
        });
        setInput('');
        setConfirmSupersede(false);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [ensureConversation],
  );

  // -------------------------------------------------------------------------
  // Accept / reject
  // -------------------------------------------------------------------------

  const accept = useCallback(
    async (jobId: string) => {
      setAccepting(jobId);
      setError(null);
      try {
        const res = await fetch(`/api/ai/jobs/${jobId}/accept`, { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? `Accept failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { job: Job; newHeadCommitSha: string };
        setJobs((prev) => ({ ...prev, [body.job.id]: body.job }));
        // Bump local head so CurrentPreview's iframe remounts with a fresh
        // URL (see headCommitSha state comment above). router.refresh()
        // still runs so the page header (HEAD short sha) and any other
        // server-fetched data stay in sync.
        setHeadCommitSha(body.newHeadCommitSha);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setAccepting(null);
      }
    },
    [router],
  );

  const reject = useCallback(async (jobId: string) => {
    setRejecting(jobId);
    setError(null);
    try {
      const res = await fetch(`/api/ai/jobs/${jobId}/reject`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Reject failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { job: Job };
      setJobs((prev) => ({ ...prev, [body.job.id]: body.job }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRejecting(null);
    }
  }, []);

  const takeOverLock = useCallback(async () => {
    try {
      const res = await fetch(`/api/decks/${props.deck.id}/lock`, { method: 'PUT' });
      if (res.ok) {
        const body = (await res.json()) as { lock: LockState };
        setLock(body.lock);
      }
    } catch {
      /* ignore */
    }
  }, [props.deck.id]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const locked = lock?.heldByOther && lock.ownerUserId !== props.currentUserId;

  // Chat panel open/closed — persisted across reloads so the user's last
  // preference sticks. Default open so first-time visitors discover the
  // editor (and the Playwright smoke test finds the composer).
  const [chatOpen, setChatOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_OPEN_KEY);
      if (stored === '0') setChatOpen(false);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleChat = useCallback((next: boolean) => {
    setChatOpen(next);
    try {
      window.localStorage.setItem(CHAT_OPEN_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        chatOpen
          ? 'lg:grid-cols-[22rem_1fr] xl:grid-cols-[26rem_1fr]'
          : 'lg:grid-cols-[2.5rem_1fr]',
      )}
    >
      {/* Chat panel — collapsible, on the LEFT of the deck. When closed it
          collapses to a thin vertical rail that runs the full height of the
          deck container, in-flow (not fixed). */}
      {chatOpen ? (
        <aside className="flex h-[calc(100vh-9rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm lg:order-first">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-eyebrow">AI Editor</span>
            </div>
            <div className="flex items-center gap-2">
              {locked && <LockBadge lock={lock!} onTakeOver={() => void takeOverLock()} />}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Collapse chat"
                onClick={() => toggleChat(false)}
                className="h-7 w-7"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <MessageList
            messages={messages}
            jobs={jobs}
            pendingJobId={pending?.job.id ?? null}
            accepting={accepting}
            rejecting={rejecting}
            onAccept={accept}
            onReject={reject}
          />

          <Composer
            input={input}
            onInput={setInput}
            sending={sending}
            disabled={Boolean(locked)}
            confirmSupersede={confirmSupersede}
            onCancelSupersede={() => setConfirmSupersede(false)}
            onSend={(supersede) => void send(input, supersede)}
            error={error}
            brandKitId={props.deck.brandKitId}
            brandKitVersionId={props.deck.brandKitVersionId}
          />
        </aside>
      ) : (
        <button
          type="button"
          aria-label="Expand AI Editor"
          onClick={() => toggleChat(true)}
          className="group flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg border bg-card py-2 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground lg:order-first lg:h-[calc(100vh-9rem)] lg:min-h-[28rem] lg:flex-col lg:justify-between lg:py-3"
        >
          <span className="flex items-center gap-2 lg:flex-col">
            <Sparkles className="h-4 w-4 text-primary" />
            <ChevronRight className="h-4 w-4" />
          </span>
          <span className="text-eyebrow whitespace-nowrap lg:[writing-mode:vertical-rl]">
            AI Editor
          </span>
          <ChevronRight className="hidden h-4 w-4 opacity-0 lg:block" aria-hidden />
        </button>
      )}

      {/* Main area: proposal review when pending, otherwise current head preview */}
      <section className="min-w-0">
        {pending ? (
          <ProposalPreview deckSlug={props.deck.slug} pending={pending} />
        ) : (
          <CurrentPreview deckSlug={props.deck.slug} headCommitSha={headCommitSha} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main-area variants
// ---------------------------------------------------------------------------

type SlideMeta = { id: string; title: string | null; index: number };

function CurrentPreview({
  deckSlug,
  headCommitSha,
}: {
  deckSlug: string;
  headCommitSha: string | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [slides, setSlides] = useState<SlideMeta[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [navOpen, setNavOpen] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pinMode, setPinMode] = useState(false);

  // postMessage helper -> iframe (origin-checked by the receiver).
  const postToViewer = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(msg, window.location.origin);
    } catch {
      /* ignore — iframe may have navigated */
    }
  }, []);

  // Reset transient slide state whenever the bundle changes (Accept ->
  // headCommitSha bumps -> iframe remounts via key).
  useEffect(() => {
    setSlides([]);
    setCurrentIdx(0);
  }, [headCommitSha]);

  // Listen for viewer-chrome messages so we can render the slide strip and
  // counter from the actual bundled deck. Origin-locked.
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; slides?: SlideMeta[]; index?: number };
      if (!data || typeof data !== 'object') return;
      if (data.type === 'bip:ready' && Array.isArray(data.slides)) {
        setSlides(data.slides);
        setCurrentIdx(typeof data.index === 'number' ? data.index : 0);
      } else if (data.type === 'bip:slide-change' && typeof data.index === 'number') {
        setCurrentIdx(data.index);
      } else if (data.type === 'bip:comments-state') {
        setCommentsOpen(Boolean((data as { open?: boolean }).open));
      } else if (data.type === 'bip:pin-state') {
        setPinMode(Boolean((data as { on?: boolean }).on));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const total = slides.length;
  const canPrev = currentIdx > 0;
  const canNext = currentIdx < total - 1;

  const handleLoad = () => {
    // Tell the viewer chrome a parent is hosting controls so it hides
    // the overlay's floating buttons + sends an immediate bip:ready.
    postToViewer({ type: 'bip:embed' });
  };

  return (
    <Card className="flex h-[calc(100vh-9rem)] min-h-[28rem] flex-col overflow-hidden p-0">
      {/* Toolbar: prev/next + slide counter + comments/pin + open external */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-primary/95 px-3 py-1.5 text-primary-foreground">
        <span className="text-eyebrow opacity-90">Preview</span>
        <div className="ml-1 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous slide"
            disabled={!canPrev}
            onClick={() => postToViewer({ type: 'bip:prev' })}
            className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next slide"
            disabled={!canNext}
            onClick={() => postToViewer({ type: 'bip:next' })}
            className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="font-mono text-[11px] tabular-nums opacity-90">
          {total === 0 ? '—' : `${currentIdx + 1} / ${total}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={commentsOpen}
            onClick={() => postToViewer({ type: 'bip:comments-toggle' })}
            className={cn(
              'h-7 gap-1.5 px-2 text-xs text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground',
              commentsOpen && 'bg-primary-foreground/20',
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Comments
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={pinMode}
            onClick={() => postToViewer({ type: 'bip:pin-toggle' })}
            className={cn(
              'h-7 gap-1.5 px-2 text-xs text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground',
              pinMode && 'bg-primary-foreground/20',
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            Pin
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
          >
            <a href={`/d/${deckSlug}`} target="_blank" rel="noreferrer">
              Open
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        // Both key and the query param change with the head sha: the key
        // forces a React remount, and the ?v={sha} bypasses the
        // /d/{slug} response's 60s private cache so the new commit's
        // HTML loads immediately after Accept.
        key={headCommitSha ?? 'empty'}
        src={`/d/${deckSlug}${headCommitSha ? `?v=${headCommitSha}` : ''}`}
        title="Deck preview"
        onLoad={handleLoad}
        className="min-h-0 w-full flex-1 bg-background"
      />

      {/* Footer: collapsible horizontal slide strip */}
      {navOpen ? (
        <div className="flex items-stretch gap-1 border-t bg-muted/40 px-2 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Hide slide list"
            onClick={() => setNavOpen(false)}
            className="h-8 w-7 shrink-0"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <ol className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {slides.length === 0 ? (
              <li className="text-xs text-muted-foreground">Loading slides…</li>
            ) : (
              slides.map((s, i) => {
                const active = i === currentIdx;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => postToViewer({ type: 'bip:goto', slideId: s.id })}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                        'max-w-[8rem] sm:max-w-[12rem]',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card hover:bg-accent hover:text-accent-foreground',
                      )}
                      title={s.title ?? s.id}
                    >
                      <span className="font-mono text-[10px] opacity-75">{i + 1}</span>
                      <span className="truncate">{s.title ?? s.id}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ol>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Show slide list"
          className="flex items-center justify-center gap-1.5 border-t bg-muted/40 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Slides ({total || '—'})
        </button>
      )}
    </Card>
  );
}

function ProposalPreview({
  deckSlug,
  pending,
}: {
  deckSlug: string;
  pending: { message: AIMessage; job: Job };
}) {
  const [tab, setTab] = useState<'visual' | 'code'>('visual');
  const output = (pending.job.output ?? null) as {
    proposedCommitSha?: string;
    baseCommitSha?: string;
  } | null;
  const base = output?.baseCommitSha;
  const proposed = output?.proposedCommitSha;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />
            Proposed change
          </Badge>
          <span className="text-xs text-muted-foreground">review before accepting</span>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'visual' | 'code')}>
          <TabsList className="h-8">
            <TabsTrigger value="visual" className="text-xs">
              Visual
            </TabsTrigger>
            <TabsTrigger value="code" className="text-xs">
              Code
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'visual' ? (
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
          <PreviewPane label="Before" sha={base ?? null} deckSlug={deckSlug} />
          <PreviewPane label="After" sha={proposed ?? null} deckSlug={deckSlug} />
        </div>
      ) : (
        <div className="h-[calc(100vh-9rem)] min-h-[28rem] overflow-auto bg-background">
          <CodeDiff jobId={pending.job.id} />
        </div>
      )}
    </Card>
  );
}

function PreviewPane({
  label,
  sha,
  deckSlug,
}: {
  label: string;
  sha: string | null;
  deckSlug: string;
}) {
  return (
    <div className="flex flex-col bg-card">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <span className="text-eyebrow">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {sha ? sha.slice(0, 7) : '—'}
        </span>
      </div>
      {sha ? (
        <iframe
          key={sha}
          src={`/d/${deckSlug}?at_commit=${sha}`}
          title={`${label} preview`}
          className="h-[calc(100vh-10rem)] min-h-[28rem] w-full bg-background"
        />
      ) : (
        <div className="flex h-[calc(100vh-10rem)] min-h-[28rem] items-center justify-center text-xs text-muted-foreground">
          Missing commit
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat panel pieces
// ---------------------------------------------------------------------------

function MessageList({
  messages,
  jobs,
  pendingJobId,
  accepting,
  rejecting,
  onAccept,
  onReject,
}: {
  messages: AIMessage[];
  jobs: Record<string, Job>;
  pendingJobId: string | null;
  accepting: string | null;
  rejecting: string | null;
  onAccept: (jobId: string) => void;
  onReject: (jobId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingJobId]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          Start a conversation to edit this deck with AI.
          <br />
          <span className="text-xs">Try “Tighten the headline on slide 1.”</span>
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
      {messages.map((m) => {
        const c = asContent(m.content);
        const job = m.relatedJobId ? (jobs[m.relatedJobId] ?? null) : null;
        return (
          <MessageRow
            key={m.id}
            message={m}
            content={c}
            job={job}
            isPending={Boolean(job && job.id === pendingJobId)}
            accepting={accepting === job?.id}
            rejecting={rejecting === job?.id}
            onAccept={() => job && onAccept(job.id)}
            onReject={() => job && onReject(job.id)}
          />
        );
      })}
    </div>
  );
}

function MessageRow({
  message,
  content,
  job,
  isPending,
  accepting,
  rejecting,
  onAccept,
  onReject,
}: {
  message: AIMessage;
  content: MessageContent;
  job: Job | null;
  isPending: boolean;
  accepting: boolean;
  rejecting: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  if (message.role === 'USER' && content.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
          {content.text}
        </div>
      </div>
    );
  }
  if (message.role === 'ASSISTANT' && content.kind === 'assistant') {
    return (
      <div className="space-y-2">
        <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground whitespace-pre-wrap">
          {content.parsed.explanation}
        </div>
        {job && (
          <ProposalActions
            job={job}
            isPending={isPending}
            accepting={accepting}
            rejecting={rejecting}
            onAccept={onAccept}
            onReject={onReject}
          />
        )}
      </div>
    );
  }
  if (message.role === 'ASSISTANT' && content.kind === 'assistant_error') {
    return (
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {content.userMessage}
      </div>
    );
  }
  return null;
}

function ProposalActions({
  job,
  isPending,
  accepting,
  rejecting,
  onAccept,
  onReject,
}: {
  job: Job;
  isPending: boolean;
  accepting: boolean;
  rejecting: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  if (job.status === 'DONE') {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
        <Check className="h-3.5 w-3.5" />
        Accepted · deck updated
      </div>
    );
  }
  if (job.status === 'CANCELED') {
    return (
      <div className="inline-flex items-center rounded-md border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        Discarded
      </div>
    );
  }
  if (job.status === 'FAILED') {
    return (
      <div className="inline-flex items-center rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
        Failed to apply
      </div>
    );
  }
  if (!isPending) return null;
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        size="sm"
        variant="success"
        onClick={onAccept}
        disabled={accepting || rejecting}
        loading={accepting}
      >
        Accept
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onReject}
        disabled={accepting || rejecting}
        loading={rejecting}
      >
        Reject
      </Button>
    </div>
  );
}

function Composer({
  input,
  onInput,
  sending,
  disabled,
  confirmSupersede,
  onCancelSupersede,
  onSend,
  error,
  brandKitId,
  brandKitVersionId,
}: {
  input: string;
  onInput: (v: string) => void;
  sending: boolean;
  disabled: boolean;
  confirmSupersede: boolean;
  onCancelSupersede: () => void;
  onSend: (supersede: boolean) => void;
  error: string | null;
  brandKitId: string | null;
  brandKitVersionId: string | null;
}) {
  return (
    <div className="border-t bg-card px-3 py-3">
      {/* Depth selector (Phase 1: chat only). Disabled placeholder for the
          Quick/Agentic depths that arrive in Phase 3 — muscle-memory only. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-eyebrow">Depth</span>
        <Badge
          variant="outline"
          title="Quick and Agentic coming soon"
          className="cursor-not-allowed gap-1 font-normal text-muted-foreground"
        >
          Chat
          <ChevronRight className="h-3 w-3" />
        </Badge>
        {brandKitId && brandKitVersionId && (
          <PatternPickerButton
            kitId={brandKitId}
            versionId={brandKitVersionId}
            disabled={disabled || sending}
            onPick={(prompt) => onInput(prompt + input)}
          />
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {confirmSupersede && (
        <div className="mb-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-2 text-xs text-warning">
          A previous proposal is still pending. Sending this message will discard it.
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onSend(true)}
              disabled={sending}
              loading={sending}
            >
              Discard & send
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancelSupersede}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(false);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter sends; plain Enter inserts a newline.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSend(false);
            }
          }}
          rows={3}
          disabled={disabled || sending}
          placeholder={disabled ? 'Editor locked by another user' : 'Ask Claude to change a slide…'}
          className="resize-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</span>
          <Button
            type="submit"
            size="sm"
            disabled={disabled || sending || !input.trim()}
            loading={sending}
            leadingIcon={sending ? undefined : <SendIcon className="h-3.5 w-3.5" />}
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function LockBadge({ lock, onTakeOver }: { lock: LockState; onTakeOver: () => void }) {
  const age = lock.ageMs ? Math.round(lock.ageMs / 1000) : null;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
      <LockIcon className="h-3 w-3" />
      <span>Locked{age !== null ? ` · ${age}s ago` : ''}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onTakeOver}
        className="h-5 px-1.5 text-[10px]"
      >
        Take over
      </Button>
    </div>
  );
}
