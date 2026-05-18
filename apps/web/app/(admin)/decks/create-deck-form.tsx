'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CreateDeckForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? `Create failed (${res.status})`);
        return;
      }
      setTitle('');
      // Jump straight into the new deck so the create flow feels finished.
      router.push(`/decks/${body.deck.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2">
      <input
        type="text"
        required
        value={title}
        placeholder="Deck title"
        onChange={(e) => setTitle(e.target.value)}
        className="min-w-[16rem] flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create deck'}
      </button>
      {error && (
        <p role="alert" className="basis-full text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
