// Single deck view: chat-driven editor per docs/bip-deck-platform-ai-editor.md
// §11. Server renders the shell + initial AI state; <DeckEditor> takes over on
// the client for chat, lock heartbeat, and proposal review.
//
// Auth: covered by the (admin)/layout.tsx session check. The preview iframes
// load /d/{slug}[?at_commit=...], which is team-gated and shares the session
// cookie.

import { notFound } from 'next/navigation';
import Link from 'next/link';

import { AppError } from '@/lib/errors';
import { getDeckById } from '@/lib/decks/service';
import {
  getConversation,
  listConversationsForDeck,
  type ConversationWithMessages,
} from '@/lib/ai/service';
import { getSessionContext } from '@/lib/auth/middleware';
import { DeckActions } from './deck-actions';
import { RenameDeck } from './rename-deck';
import { DeckEditor } from './deck-editor';

export const dynamic = 'force-dynamic';

export default async function DeckDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx) notFound();

  let deck;
  try {
    deck = await getDeckById(params.id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }

  // Pick up the most recent conversation so the chat resumes across reloads.
  // No auto-create here — DeckEditor lazily creates one on first send.
  const conversations = await listConversationsForDeck(deck.id);
  let initial: ConversationWithMessages | null = null;
  if (conversations[0]) {
    initial = await getConversation(conversations[0].id);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/decks" className="text-xs text-neutral-600 hover:text-neutral-900">
            ← All decks
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold">{deck.title}</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500">
            <span className="font-mono">{deck.slug}</span>
            <span>·</span>
            <span className="font-mono">HEAD {deck.headCommitSha?.slice(0, 7) ?? '—'}</span>
            <span>·</span>
            <span className="uppercase tracking-wide">{deck.lifecycleStage}</span>
            {deck.archivedAt && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">Archived</span>
            )}
          </div>
        </div>
        <details className="group rounded border border-neutral-200 bg-white text-sm open:shadow-sm">
          <summary className="cursor-pointer list-none rounded px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
            Details ▾
          </summary>
          <div className="space-y-3 border-t border-neutral-200 px-4 py-3">
            <Row label="Title">
              <RenameDeck id={deck.id} initialTitle={deck.title} />
            </Row>
            <Row label="Created">
              <span className="text-xs text-neutral-700">
                {deck.createdAt.toISOString().slice(0, 10)}
              </span>
            </Row>
            <Row label="Updated">
              <span className="text-xs text-neutral-700">
                {deck.updatedAt.toISOString().slice(0, 10)}
              </span>
            </Row>
            <div className="pt-2">
              <DeckActions id={deck.id} archived={Boolean(deck.archivedAt)} />
            </div>
          </div>
        </details>
      </header>

      <DeckEditor
        deck={{
          id: deck.id,
          slug: deck.slug,
          title: deck.title,
          headCommitSha: deck.headCommitSha,
        }}
        initialConversation={initial?.conversation ?? null}
        initialMessages={initial?.messages ?? []}
        initialJobs={initial?.jobs ?? {}}
        currentUserId={ctx.user.id}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
