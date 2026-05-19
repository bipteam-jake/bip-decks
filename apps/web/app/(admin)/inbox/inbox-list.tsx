'use client';

// Inbox list client. Owns the local read-state mutations so the user can
// dismiss a mention and see it grey out without a full refetch.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, CheckCheck, MessageSquare } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface InboxEntryDTO {
  id: string;
  createdAt: string;
  readAt: string | null;
  comment: {
    id: string;
    body: string;
    slideId: string;
    status: string;
    authorDisplayName: string;
    createdAt: string;
  };
  deck: { id: string; slug: string; title: string };
}

export function InboxList({ initialEntries }: { initialEntries: InboxEntryDTO[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const unreadCount = useMemo(
    () => entries.filter((e) => e.readAt === null).length,
    [entries],
  );

  async function markRead(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/inbox/${id}/read`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, readAt: new Date().toISOString() } : e)),
      );
    } catch (err) {
      toast.error(`Could not mark read: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function markAllRead() {
    setBulkBusy(true);
    try {
      const res = await fetch('/api/inbox/read-all', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const now = new Date().toISOString();
      setEntries((prev) => prev.map((e) => (e.readAt ? e : { ...e, readAt: now })));
      toast.success('Inbox cleared');
    } catch (err) {
      toast.error(`Could not mark all read: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No mentions yet</p>
            <p className="text-sm text-muted-foreground">
              When someone @mentions you in a comment or admin note, it shows up here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {unreadCount > 0 ? (
            <>
              <strong className="text-foreground">{unreadCount}</strong> unread
              {' · '}
              {entries.length} total
            </>
          ) : (
            <>{entries.length} total · all read</>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={unreadCount === 0 || bulkBusy}
          loading={bulkBusy}
          onClick={() => void markAllRead()}
          leadingIcon={<CheckCheck className="h-3.5 w-3.5" />}
        >
          Mark all read
        </Button>
      </div>

      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id}>
            <InboxRow
              entry={e}
              busy={busy === e.id}
              onMarkRead={() => void markRead(e.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function InboxRow({
  entry,
  busy,
  onMarkRead,
}: {
  entry: InboxEntryDTO;
  busy: boolean;
  onMarkRead: () => void;
}) {
  const unread = entry.readAt === null;
  return (
    <Card className={unread ? 'border-primary/40' : 'opacity-75'}>
      <CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={`/decks/${entry.deck.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {entry.deck.title}
            </Link>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-muted-foreground">slide {entry.comment.slideId}</span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {entry.comment.status.toLowerCase().replace('_', ' ')}
            </Badge>
            {unread && (
              <Badge className="bg-primary text-primary-foreground text-[10px]">New</Badge>
            )}
          </div>
          <p className="text-sm">
            <span className="font-medium">{entry.comment.authorDisplayName}</span>
            <span className="text-muted-foreground"> mentioned you</span>
          </p>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {entry.comment.body}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-row gap-2 sm:flex-col">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/decks/${entry.deck.id}`}>Open deck</Link>
          </Button>
          {unread && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onMarkRead}
              leadingIcon={<Check className="h-3.5 w-3.5" />}
            >
              Mark read
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
