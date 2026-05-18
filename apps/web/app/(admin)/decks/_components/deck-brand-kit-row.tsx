'use client';

// Brand-kit binding row used inside the deck details dialog. Owns:
//   - rendering the current binding label
//   - the BrandKitPicker for re-pinning
//   - a one-click "Upgrade to latest" shortcut when a newer version of the
//     same kit has been published since this deck pinned its current one
//
// PATCH calls /api/decks/[id]/brand-kit; the service drops the matching
// bundle-cache entry so the preview/iframe rebuilds with new tokens.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { BrandKitPicker, type PickerKit } from './brand-kit-picker';

interface Props {
  deckId: string;
  initialBrandKitVersionId: string | null;
}

export function DeckBrandKitRow({ deckId, initialBrandKitVersionId }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(initialBrandKitVersionId);
  const [saving, setSaving] = useState(false);
  const [kits, setKits] = useState<PickerKit[] | null>(null);

  // Load kits once for the "Upgrade to latest" lookup. The picker reloads
  // independently on each open so the data there is always fresh.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/brand-kits?withVersions=1')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) return;
        if (!cancelled) setKits(body.kits as PickerKit[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next: string | null) {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/decks/${deckId}/brand-kit`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandKitVersionId: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setValue(prev);
        toast.error(body?.error?.message ?? `Update failed (${res.status})`);
        return;
      }
      toast.success(next ? 'Brand kit pinned' : 'Brand kit cleared');
      router.refresh();
    } catch (err) {
      setValue(prev);
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const upgrade = computeUpgrade(value, kits);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <BrandKitPicker value={value} onChange={persist} disabled={saving} />
        {saving ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </span>
        ) : null}
      </div>
      {upgrade ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          leadingIcon={<ArrowUpCircle className="h-4 w-4" />}
          disabled={saving}
          onClick={() => persist(upgrade.latestVersionId)}
        >
          Upgrade to {upgrade.latestLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * If the bound version is not the most-recently-published version of its
 * kit, return the latest version's id + label. Otherwise null.
 */
function computeUpgrade(
  current: string | null,
  kits: PickerKit[] | null,
): { latestVersionId: string; latestLabel: string } | null {
  if (!current || !kits) return null;
  for (const k of kits) {
    const idx = k.versions.findIndex((v) => v.id === current);
    if (idx === -1) continue;
    // Versions come back from the API ordered by publishedAt desc, so
    // index 0 is the latest. If the current pin is already index 0 there's
    // nothing to upgrade to.
    if (idx === 0) return null;
    const latest = k.versions[0];
    if (!latest) return null;
    return { latestVersionId: latest.id, latestLabel: latest.versionLabel };
  }
  return null;
}
