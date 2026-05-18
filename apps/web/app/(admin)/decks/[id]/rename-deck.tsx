'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';

export function RenameDeck({ id, initialTitle }: { id: string; initialTitle: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);

  async function save() {
    const next = title.trim();
    if (!next || next === initialTitle) {
      setEditing(false);
      setTitle(initialTitle);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? `Rename failed (${res.status})`);
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
        className="block w-full truncate rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-accent"
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
    >
      <Input
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
        className="h-8"
      />
    </form>
  );
}
