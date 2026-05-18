'use client';

// Claim form: collects a display name (optional email) and POSTs to
// /api/share-links/claim. On success the API sets a per-deck recipient
// cookie and returns `{ redirectTo }`; we navigate there.
//
// We persist a `clientId` (uuid) in localStorage keyed by the share token
// so a refresh of the deck on the same browser stays stitched to the same
// ShareLinkRecipient row. Without that key, claiming twice would create
// two recipient rows for the same browser.

import { useState, type FormEvent } from 'react';

type Props = { token: string };

const LS_PREFIX = 'bip.share-link.client-id.';

function getOrCreateClientId(token: string): string {
  const key = LS_PREFIX + token;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    // Private mode / disabled storage — fall back to an ephemeral id.
    return crypto.randomUUID();
  }
}

export function ClaimForm({ token }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/share-links/claim', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          displayName: displayName.trim(),
          email: email.trim() || undefined,
          clientId: getOrCreateClientId(token),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        redirectTo?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !data?.redirectTo) {
        throw new Error(data?.error?.message ?? 'Unable to continue. Please try again.');
      }
      window.location.href = data.redirectTo;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-700">Your name</span>
        <input
          required
          type="text"
          autoFocus
          maxLength={120}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-700">Email (optional)</span>
        <input
          type="email"
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting || displayName.trim().length === 0}
        className="mt-2 rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Opening…' : 'Open deck'}
      </button>
    </form>
  );
}
