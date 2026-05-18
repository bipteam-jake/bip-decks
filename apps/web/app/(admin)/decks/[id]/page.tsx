// Single deck view: preview iframe on the left, metadata + actions sidebar on
// the right. Auth: covered by the (admin)/layout.tsx session check. The
// preview iframe loads /d/{slug}, which is also team-gated and shares the
// session cookie.

import { notFound } from 'next/navigation';
import Link from 'next/link';

import { AppError } from '@/lib/errors';
import { getDeckById } from '@/lib/decks/service';
import { DeckActions } from './deck-actions';
import { RenameDeck } from './rename-deck';

export const dynamic = 'force-dynamic';

export default async function DeckDetailPage({ params }: { params: { id: string } }) {
  let deck;
  try {
    deck = await getDeckById(params.id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href="/decks" className="text-xs text-neutral-600 hover:text-neutral-900">
            ← All decks
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold">{deck.title}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="rounded border border-neutral-200 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs text-neutral-600">
            <span className="font-medium">Preview</span>
            <a
              href={`/d/${deck.slug}`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-neutral-900"
            >
              Open in new tab
            </a>
          </div>
          <iframe
            // key forces a reload whenever the head commit changes so a rename
            // or any future content edit shows up without a manual refresh.
            key={deck.headCommitSha ?? 'empty'}
            src={`/d/${deck.slug}`}
            title={`Preview of ${deck.title}`}
            className="h-[calc(100vh-14rem)] w-full rounded-b bg-white"
          />
        </section>

        <aside className="space-y-4">
          <section className="rounded border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Metadata</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Title">
                <RenameDeck id={deck.id} initialTitle={deck.title} />
              </Row>
              <Row label="Slug">
                <span className="font-mono text-xs text-neutral-700">{deck.slug}</span>
              </Row>
              <Row label="Stage">
                <span className="font-mono text-xs">{deck.lifecycleStage}</span>
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
              <Row label="HEAD">
                <span className="font-mono text-[10px] text-neutral-600">
                  {deck.headCommitSha?.slice(0, 12) ?? '—'}
                </span>
              </Row>
              <Row label="Status">
                <span className="text-xs">
                  {deck.archivedAt ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                      Archived
                    </span>
                  ) : (
                    <span className="text-neutral-700">Active</span>
                  )}
                </span>
              </Row>
            </dl>
          </section>

          <section className="rounded border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Actions</h2>
            <div className="mt-3">
              <DeckActions id={deck.id} archived={Boolean(deck.archivedAt)} />
            </div>
          </section>
        </aside>
      </div>
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
