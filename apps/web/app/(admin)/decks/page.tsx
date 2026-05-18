// Deck list — server component. Pulls straight from the service layer with
// the auth context already validated in the parent layout.

import Link from 'next/link';

import { listDecks } from '@/lib/decks/service';
import { CreateDeckForm } from './create-deck-form';

export const dynamic = 'force-dynamic';

export default async function DecksPage({ searchParams }: { searchParams: { archived?: string } }) {
  const includeArchived = searchParams.archived === '1';
  const decks = await listDecks({ includeArchived });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Decks</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {decks.length} {decks.length === 1 ? 'deck' : 'decks'}
            {includeArchived ? ' (including archived)' : ''}
          </p>
        </div>
        <Link
          href={includeArchived ? '/decks' : '/decks?archived=1'}
          className="text-sm text-neutral-700 underline hover:text-neutral-900"
        >
          {includeArchived ? 'Hide archived' : 'Show archived'}
        </Link>
      </div>

      <section className="rounded border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Create a deck</h2>
        <div className="mt-3">
          <CreateDeckForm />
        </div>
      </section>

      <section>
        {decks.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-600">
            No decks yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
            {decks.map((deck) => (
              <li key={deck.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/decks/${deck.id}`}
                    className="block truncate text-sm font-medium text-neutral-900 hover:underline"
                  >
                    {deck.title}
                  </Link>
                  <div className="mt-0.5 truncate font-mono text-xs text-neutral-500">
                    {deck.slug}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-neutral-600">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">
                    {deck.lifecycleStage}
                  </span>
                  {deck.archivedAt && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                      archived
                    </span>
                  )}
                  <span title={deck.updatedAt.toISOString()}>
                    {deck.updatedAt.toISOString().slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
