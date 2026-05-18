'use client';

// Client-side search + stage filter over the already-fetched deck list.
// Server still loads everything (page size is capped at 200 in the service),
// so we do all filtering locally — no extra round-trips.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Archive, FileText, Search, X } from 'lucide-react';

import type { LifecycleStage } from '@bip/db';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type DeckRow = {
  id: string;
  title: string;
  slug: string;
  lifecycleStage: LifecycleStage;
  updatedAt: string;
  archivedAt: string | null;
};

const STAGES: Array<{ value: 'ALL' | LifecycleStage; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OUTLINE', label: 'Outline' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'REVIEWING', label: 'Reviewing' },
  { value: 'FINAL', label: 'Final' },
];

export function DecksTable({ decks }: { decks: DeckRow[] }) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'ALL' | LifecycleStage>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decks.filter((d) => {
      if (stage !== 'ALL' && d.lifecycleStage !== stage) return false;
      if (!q) return true;
      return d.title.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q);
    });
  }, [decks, query, stage]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or slug"
            className="pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Tabs value={stage} onValueChange={(v) => setStage(v as 'ALL' | LifecycleStage)}>
          <TabsList>
            {STAGES.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="text-xs">
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {decks.length === 0 ? 'No decks yet' : 'No decks match your filters'}
              </p>
              <p className="text-sm text-muted-foreground">
                {decks.length === 0
                  ? 'Click “New deck” to create your first one.'
                  : 'Try a different search or stage filter.'}
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="hidden md:table-cell">Slug</TableHead>
                <TableHead className="hidden sm:table-cell">Stage</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                <TableHead className="w-12 text-right" aria-label="Status" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((deck) => (
                <TableRow key={deck.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/decks/${deck.id}`} className="block hover:underline">
                      {deck.title}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {deck.slug}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {deck.lifecycleStage}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="hidden text-xs text-muted-foreground lg:table-cell"
                    title={deck.updatedAt}
                  >
                    {deck.updatedAt.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right">
                    {deck.archivedAt ? (
                      <Badge variant="secondary" className="gap-1">
                        <Archive className="h-3 w-3" />
                        Archived
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {decks.length}
      </p>
    </div>
  );
}
