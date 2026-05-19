// /decks/[id]/outline — Phase 2.5 outline-first workspace.
// Left pane: chat history + composer.
// Right pane: structured preview of the latest outline + approve button.
//
// When the deck has no outline conversation, we redirect to /decks/[id].

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { AppError } from '@/lib/errors';
import { getDeckById } from '@/lib/decks/service';
import { getSessionContext } from '@/lib/auth/middleware';
import {
  findOutlineConversationForDeck,
  getOutlineConversation,
} from '@/lib/outline/service';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';

import { OutlineWorkspace } from './outline-workspace';

export const dynamic = 'force-dynamic';

export default async function OutlinePage({ params }: { params: Promise<{ id: string }> }) {
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

  const existing = await findOutlineConversationForDeck(deck.id);
  if (!existing) {
    redirect(`/decks/${deck.id}`);
  }
  const initial = await getOutlineConversation(existing.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${deck.title} — outline`}
        description={
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{deck.slug}</span>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {deck.lifecycleStage}
            </Badge>
            {initial.conversation.approvedAt ? (
              <Badge variant="secondary">Approved</Badge>
            ) : (
              <Badge variant="outline">Drafting</Badge>
            )}
          </span>
        }
        breadcrumb={
          <Link
            href={`/decks/${deck.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Back to deck
          </Link>
        }
      />

      <OutlineWorkspace
        deck={{ id: deck.id, slug: deck.slug, title: deck.title }}
        initialConversation={initial.conversation}
        initialMessages={initial.messages}
      />
    </div>
  );
}
