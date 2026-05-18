'use client';

// Brand-kit version picker used both at deck-create time and from the deck
// details dialog. Renders a button showing the current selection; opening it
// pops a Dialog listing every (non-archived) brand kit + its published
// versions and lets the user pin one or clear the binding.
//
// We use a Dialog with a flat list rather than a Combobox/Command primitive
// because the shadcn `combobox` isn't installed yet and "pick a kit + version
// out of <50 items" is well-served by a simple tree-style list.

import { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Palette, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

export interface PickerKitVersion {
  id: string;
  versionLabel: string;
  publishedAt: string;
}

export interface PickerKit {
  id: string;
  name: string;
  slug: string;
  versions: PickerKitVersion[];
}

interface Props {
  value: string | null;
  onChange: (versionId: string | null) => void;
  disabled?: boolean;
  /** Override the trigger label. Defaults to "No brand kit" / "{name} @ {label}". */
  triggerClassName?: string;
}

export function BrandKitPicker({ value, onChange, disabled, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [kits, setKits] = useState<PickerKit[] | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(value);

  // Refresh on every open so newly-published versions surface without a hard reload.
  useEffect(() => {
    if (!open) return;
    setSelectedVersionId(value);
    let cancelled = false;
    setLoading(true);
    fetch('/api/brand-kits?withVersions=1')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? `Load failed (${res.status})`);
        if (!cancelled) setKits(body.kits as PickerKit[]);
      })
      .catch((err) => {
        if (!cancelled) toast.error((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, value]);

  const currentLabel = useTriggerLabel(value, kits);

  function commit() {
    onChange(selectedVersionId);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          leadingIcon={<Palette className="h-4 w-4" />}
          className={triggerClassName}
        >
          {currentLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose brand kit</DialogTitle>
          <DialogDescription>
            Pin a published version. The deck re-renders with the kit&rsquo;s tokens injected as CSS
            custom properties.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSelectedVersionId(null)}
            className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm transition ${
              selectedVersionId === null
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted'
            }`}
          >
            <span className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              No brand kit
            </span>
            {selectedVersionId === null ? (
              <span className="text-xs font-medium text-primary">Selected</span>
            ) : null}
          </button>
        </div>

        <Separator />

        <ScrollArea className="max-h-[50vh] pr-2">
          {loading && !kits ? (
            <p className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading kits…
            </p>
          ) : !kits || kits.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">No brand kits exist yet.</p>
          ) : (
            <ul className="space-y-3">
              {kits.map((k) => (
                <li key={k.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{k.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{k.slug}</p>
                  </div>
                  {k.versions.length === 0 ? (
                    <p className="rounded border border-dashed bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                      No versions published.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {k.versions.map((v) => {
                        const sel = selectedVersionId === v.id;
                        return (
                          <li key={v.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedVersionId(v.id)}
                              className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm transition ${
                                sel ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <ChevronRight
                                  className={`h-3.5 w-3.5 ${sel ? 'text-primary' : 'text-muted-foreground'}`}
                                />
                                <span className="font-mono text-xs">{v.versionLabel}</span>
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(v.publishedAt).toISOString().slice(0, 10)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={<X className="h-4 w-4" />}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={commit}>
            Use selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useTriggerLabel(value: string | null, kits: PickerKit[] | null): string {
  if (!value) return 'No brand kit';
  if (!kits) return 'Brand kit…';
  for (const k of kits) {
    const v = k.versions.find((x) => x.id === value);
    if (v) return `${k.name} @ ${v.versionLabel}`;
  }
  return 'Brand kit (unknown)';
}
