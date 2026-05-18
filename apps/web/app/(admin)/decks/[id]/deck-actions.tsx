'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DeckActions({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function call(label: string, path: string, method: 'POST' | 'DELETE') {
    setBusy(label);
    try {
      const res = await fetch(path, { method });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? `${label} failed (${res.status})`);
        return false;
      }
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function toggleArchive() {
    const path = archived ? `/api/decks/${id}/unarchive` : `/api/decks/${id}/archive`;
    if (await call(archived ? 'Unarchive' : 'Archive', path, 'POST')) {
      router.refresh();
    }
  }

  async function softDelete() {
    setConfirmOpen(false);
    if (await call('Delete', `/api/decks/${id}`, 'DELETE')) {
      router.push('/decks');
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        loading={busy === 'Archive' || busy === 'Unarchive'}
        disabled={busy !== null}
        onClick={() => void toggleArchive()}
      >
        {archived ? 'Unarchive' : 'Archive'}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="w-full"
        loading={busy === 'Delete'}
        disabled={busy !== null}
        onClick={() => setConfirmOpen(true)}
      >
        Soft-delete
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft-delete this deck?</DialogTitle>
            <DialogDescription>
              The deck will be hidden from lists and hard-deleted after 30 days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void softDelete()}>
              Soft-delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
