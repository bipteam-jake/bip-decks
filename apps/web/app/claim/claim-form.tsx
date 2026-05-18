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
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setSubmitting(true);
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
      toast.error(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="claim-name">Your name</Label>
        <Input
          id="claim-name"
          required
          type="text"
          autoFocus
          maxLength={120}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="claim-email">Email (optional)</Label>
        <Input
          id="claim-email"
          type="email"
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={displayName.trim().length === 0}
        loading={submitting}
      >
        Open deck
      </Button>
    </form>
  );
}
