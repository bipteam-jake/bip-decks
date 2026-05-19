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
import { prisma } from '@/lib/prisma';
import { getDeckById } from '@/lib/decks/service';
import {
  getConversation,
  listConversationsForDeck,
  type ConversationWithMessages,
} from '@/lib/ai/service';
import { getSessionContext } from '@/lib/auth/middleware';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

  // Resolve brand-kit id (parent of the bound version) so the pattern picker
  // in the editor can call /api/brand-kits/{kitId}/versions/{versionId}/patterns
  // without an extra client round trip.
  let brandKitId: string | null = null;
  if (deck.brandKitVersionId) {
    const v = await prisma.brandKitVersion.findUnique({
      where: { id: deck.brandKitVersionId },
      select: { brandKitId: true },
    });
    brandKitId = v?.brandKitId ?? null;
  }

  return (
    <div className="space-y-3">
      {/* Compact one-row header so the editor takes most of the viewport.
          Breadcrumb + title + meta sit inline; actions hug the right edge. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2">
        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
          <Link href="/decks" aria-label="All decks">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="h3 leading-none">{deck.title}</h1>
        <span className="font-mono text-xs text-muted-foreground">{deck.slug}</span>
        <span className="font-mono text-xs text-muted-foreground">
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
        <div className="ml-auto">
          <DeckDetailsDialog
            id={deck.id}
            title={deck.title}
            createdAt={deck.createdAt.toISOString().slice(0, 10)}
            updatedAt={deck.updatedAt.toISOString().slice(0, 10)}
            archived={Boolean(deck.archivedAt)}
            brandKitVersionId={deck.brandKitVersionId}
          />
        </div>
      </div>

      <DeckEditor
        deck={{
          id: deck.id,
          slug: deck.slug,
          title: deck.title,
          headCommitSha: deck.headCommitSha,
          brandKitVersionId: deck.brandKitVersionId,
          brandKitId,
        }}
        initialConversation={initial?.conversation ?? null}
        initialMessages={initial?.messages ?? []}
        initialJobs={initial?.jobs ?? {}}
        currentUserId={ctx.user.id}
      />
    </div>
  );
}
