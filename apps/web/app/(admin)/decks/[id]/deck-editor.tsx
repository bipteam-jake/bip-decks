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

import type { AIConversation, AIMessage, Job } from '@bip/db';
import {
  HEARTBEAT_INTERVAL_MS,
  type LockState,
} from '@/lib/ai/lock';

const CodeDiff = dynamic(() => import('./code-diff').then((m) => m.CodeDiff), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-neutral-500">Loading diff…</div>,
});

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
        // The deck head changed — refresh the server-fetched props so the
        // main preview iframe gets the new SHA and any cached bundles are
        // re-resolved with the new context.
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_28rem]">
      {/* Main area: proposal review when pending, otherwise current head preview */}
      <section className="rounded border border-neutral-200 bg-white">
        {pending ? (
          <ProposalPreview deckSlug={props.deck.slug} pending={pending} />
        ) : (
          <CurrentPreview deckSlug={props.deck.slug} headCommitSha={props.deck.headCommitSha} />
        )}
      </section>

      {/* Chat panel */}
      <aside className="flex h-[calc(100vh-12rem)] flex-col rounded border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            AI Editor
          </span>
          {locked && (
            <LockBadge lock={lock!} onTakeOver={() => void takeOverLock()} />
          )}
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
        />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main-area variants
// ---------------------------------------------------------------------------

function CurrentPreview({
  deckSlug,
  headCommitSha,
}: {
  deckSlug: string;
  headCommitSha: string | null;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs text-neutral-600">
        <span className="font-medium">Preview</span>
        <a
          href={`/d/${deckSlug}`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-900"
        >
          Open in new tab
        </a>
      </div>
      <iframe
        key={headCommitSha ?? 'empty'}
        src={`/d/${deckSlug}`}
        title="Deck preview"
        className="h-[calc(100vh-15rem)] w-full rounded-b bg-white"
      />
    </>
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
    <>
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs text-neutral-600">
        <span className="font-medium">Proposed change · review</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab('visual')}
            className={`rounded px-2 py-0.5 text-xs ${
              tab === 'visual'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            Visual
          </button>
          <button
            type="button"
            onClick={() => setTab('code')}
            className={`rounded px-2 py-0.5 text-xs ${
              tab === 'code'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            Code
          </button>
        </div>
      </div>
      {tab === 'visual' ? (
        <div className="grid grid-cols-2 gap-px bg-neutral-200">
          <PreviewPane label="Before" sha={base ?? null} deckSlug={deckSlug} />
          <PreviewPane label="After" sha={proposed ?? null} deckSlug={deckSlug} />
        </div>
      ) : (
        <div className="h-[calc(100vh-15rem)] overflow-auto bg-white">
          <CodeDiff jobId={pending.job.id} />
        </div>
      )}
    </>
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
    <div className="flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-2 py-1 text-[11px] text-neutral-600">
        <span className="font-semibold uppercase tracking-wide">{label}</span>
        <span className="font-mono text-neutral-500">{sha ? sha.slice(0, 7) : '—'}</span>
      </div>
      {sha ? (
        <iframe
          key={sha}
          src={`/d/${deckSlug}?at_commit=${sha}`}
          title={`${label} preview`}
          className="h-[calc(100vh-16rem)] w-full bg-white"
        />
      ) : (
        <div className="flex h-[calc(100vh-16rem)] items-center justify-center text-xs text-neutral-500">
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
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-neutral-500">
        Start a conversation to edit this deck with AI. Try “Tighten the headline on slide 1.”
      </div>
    );
  }

  return (
    <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
      {messages.map((m) => {
        const c = asContent(m.content);
        const job = m.relatedJobId ? jobs[m.relatedJobId] ?? null : null;
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
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-900 px-3 py-2 text-sm text-white">
          {content.text}
        </div>
      </div>
    );
  }
  if (message.role === 'ASSISTANT' && content.kind === 'assistant') {
    return (
      <div className="space-y-2">
        <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-2 text-sm text-neutral-900 whitespace-pre-wrap">
          {content.parsed.explanation}
        </div>
        {job && <ProposalActions job={job} isPending={isPending} accepting={accepting} rejecting={rejecting} onAccept={onAccept} onReject={onReject} />}
      </div>
    );
  }
  if (message.role === 'ASSISTANT' && content.kind === 'assistant_error') {
    return (
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
        Accepted · deck updated
      </div>
    );
  }
  if (job.status === 'CANCELED') {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
        Discarded
      </div>
    );
  }
  if (job.status === 'FAILED') {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-900">
        Failed to apply
      </div>
    );
  }
  if (!isPending) return null;
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onAccept}
        disabled={accepting || rejecting}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {accepting ? 'Accepting…' : 'Accept'}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={accepting || rejecting}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
      >
        {rejecting ? 'Rejecting…' : 'Reject'}
      </button>
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
}: {
  input: string;
  onInput: (v: string) => void;
  sending: boolean;
  disabled: boolean;
  confirmSupersede: boolean;
  onCancelSupersede: () => void;
  onSend: (supersede: boolean) => void;
  error: string | null;
}) {
  return (
    <div className="border-t border-neutral-200 px-3 py-3">
      {/* Depth selector (Phase 1: chat only). The dropdown is disabled with
          a tooltip per §11 — muscle-memory groundwork for Phase 3. */}
      <div className="mb-2 flex items-center gap-2 text-[11px] text-neutral-500">
        <span>Depth:</span>
        <select
          disabled
          title="Quick and Agentic coming soon"
          className="rounded border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs disabled:cursor-not-allowed"
          value="chat"
          onChange={() => undefined}
        >
          <option value="chat">Chat</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </div>
      )}

      {confirmSupersede && (
        <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-900">
          A previous proposal is still pending. Sending this message will discard it.
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onSend(true)}
              disabled={sending}
              className="rounded bg-amber-700 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Discard & send
            </button>
            <button
              type="button"
              onClick={onCancelSupersede}
              className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(false);
        }}
      >
        <textarea
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
          placeholder={
            disabled ? 'Editor locked by another user' : 'Ask Claude to change a slide…'
          }
          className="w-full resize-none rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
          <span>⌘/Ctrl + Enter to send</span>
          <button
            type="submit"
            disabled={disabled || sending || !input.trim()}
            className="rounded bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LockBadge({ lock, onTakeOver }: { lock: LockState; onTakeOver: () => void }) {
  const age = lock.ageMs ? Math.round(lock.ageMs / 1000) : null;
  return (
    <div className="flex items-center gap-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">
      <span>
        Locked{age !== null ? ` · ${age}s ago` : ''}
      </span>
      <button
        type="button"
        onClick={onTakeOver}
        className="rounded bg-amber-700 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-800"
      >
        Take over
      </button>
    </div>
  );
}
