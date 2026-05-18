'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeckActions({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(label: string, path: string, method: 'POST' | 'DELETE') {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(path, { method });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `${label} failed (${res.status})`);
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
    if (
      !window.confirm(
        'Soft-delete this deck? It will be hidden from lists and hard-deleted after 30 days.',
      )
    ) {
      return;
    }
    if (await call('Delete', `/api/decks/${id}`, 'DELETE')) {
      router.push('/decks');
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void toggleArchive()}
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50"
      >
        {busy === 'Archive' || busy === 'Unarchive' ? '…' : archived ? 'Unarchive' : 'Archive'}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void softDelete()}
        className="w-full rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {busy === 'Delete' ? '…' : 'Soft-delete'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
