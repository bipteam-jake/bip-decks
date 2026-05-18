'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RenameDeck({ id, initialTitle }: { id: string; initialTitle: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const next = title.trim();
    if (!next || next === initialTitle) {
      setEditing(false);
      setTitle(initialTitle);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Rename failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block w-full truncate text-left text-sm text-neutral-900 hover:underline"
        title="Click to rename"
      >
        {initialTitle}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-1"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setTitle(initialTitle);
            setEditing(false);
          }
        }}
        disabled={busy}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-900 focus:outline-none"
      />
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </form>
  );
}
