// Deck list — server component. Pulls straight from the service layer with
// the auth context already validated in the parent layout.

import Link from 'next/link';

import { listDecks } from '@/lib/decks/service';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { CreateDeckDialog } from './create-deck-dialog';
import { DecksTable } from './decks-table';

export const dynamic = 'force-dynamic';

export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const includeArchived = sp.archived === '1';
  const decks = await listDecks({ includeArchived });

  const rows = decks.map((d) => ({
    id: d.id,
    title: d.title,
    slug: d.slug,
    lifecycleStage: d.lifecycleStage,
    updatedAt: d.updatedAt.toISOString(),
    archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decks"
        description={`${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}${includeArchived ? ' (including archived)' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={includeArchived ? '/decks' : '/decks?archived=1'}>
                {includeArchived ? 'Hide archived' : 'Show archived'}
              </Link>
            </Button>
            <CreateDeckDialog />
          </div>
        }
      />

      <DecksTable decks={rows} />
    </div>
  );
}
