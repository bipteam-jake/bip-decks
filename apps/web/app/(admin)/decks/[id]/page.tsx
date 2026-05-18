// Single deck view: chat-driven editor per docs/bip-deck-platform-ai-editor.md
// §11. Server renders the shell + initial AI state; <DeckEditor> takes over on
// the client for chat, lock heartbeat, and proposal review.
//
// Auth: covered by the (admin)/layout.tsx session check. The preview iframes
// load /d/{slug}[?at_commit=...], which is team-gated and shares the session
// cookie.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Archive, ChevronLeft } from 'lucide-react';

import { AppError } from '@/lib/errors';
import { getDeckById } from '@/lib/decks/service';
import {
  getConversation,
  listConversationsForDeck,
  type ConversationWithMessages,
} from '@/lib/ai/service';
import { getSessionContext } from '@/lib/auth/middleware';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { DeckDetailsDialog } from './deck-details-dialog';
import { DeckEditor } from './deck-editor';

export const dynamic = 'force-dynamic';

export default async function DeckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSessionContext();
  if (!ctx) notFound();

  let deck;
  try {
    deck = await getDeckById(id);
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
      <PageHeader
        title={deck.title}
        description={
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{deck.slug}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground">
              HEAD {deck.headCommitSha?.slice(0, 7) ?? '—'}
            </span>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {deck.lifecycleStage}
            </Badge>
            {deck.archivedAt ? (
              <Badge variant="secondary" className="gap-1">
                <Archive className="h-3 w-3" />
                Archived
              </Badge>
            ) : null}
          </span>
        }
        breadcrumb={
          <Link
            href="/decks"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            All decks
          </Link>
        }
        actions={
          <DeckDetailsDialog
            id={deck.id}
            title={deck.title}
            createdAt={deck.createdAt.toISOString().slice(0, 10)}
            updatedAt={deck.updatedAt.toISOString().slice(0, 10)}
            archived={Boolean(deck.archivedAt)}
          />
        }
      />

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
