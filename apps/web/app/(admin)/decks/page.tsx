// Deck list — server component. Pulls straight from the service layer with
// the auth context already validated in the parent layout.

import Link from 'next/link';
import { Archive, FileText } from 'lucide-react';

import { listDecks } from '@/lib/decks/service';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CreateDeckForm } from './create-deck-form';

export const dynamic = 'force-dynamic';

export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const includeArchived = sp.archived === '1';
  const decks = await listDecks({ includeArchived });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decks"
        description={`${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}${includeArchived ? ' (including archived)' : ''}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={includeArchived ? '/decks' : '/decks?archived=1'}>
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a deck</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateDeckForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {decks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileText className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">No decks yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first deck using the form above.
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
                {decks.map((deck) => (
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
                      title={deck.updatedAt.toISOString()}
                    >
                      {deck.updatedAt.toISOString().slice(0, 10)}
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
        </CardContent>
      </Card>
    </div>
  );
}
