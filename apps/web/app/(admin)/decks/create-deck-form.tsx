'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { BrandKitPicker } from './_components/brand-kit-picker';

export function CreateDeckForm({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [brandKitVersionId, setBrandKitVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, brandKitVersionId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Create failed (${res.status})`);
        return;
      }
      setTitle('');
      setBrandKitVersionId(null);
      onCreated?.();
      // Jump straight into the new deck so the create flow feels finished.
      router.push(`/decks/${body.deck.id}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="text"
          required
          value={title}
          placeholder="Deck title"
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1"
          disabled={busy}
        />
        <Button type="submit" disabled={!title.trim()} loading={busy}>
          Create deck
        </Button>
      </div>
      <BrandKitPicker
        value={brandKitVersionId}
        onChange={setBrandKitVersionId}
        disabled={busy}
      />
    </form>
  );
}
