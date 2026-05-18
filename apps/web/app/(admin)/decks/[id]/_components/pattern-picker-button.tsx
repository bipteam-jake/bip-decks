'use client';

// Pattern picker — Dialog-trigger button surfaced in the AI editor chat
// composer when the deck is bound to a brand-kit version. Lists approved
// patterns for that version and, on select, prepends a "Create a slide
// using the {name} pattern" line to the chat input so the user can refine
// before sending.
//
// The picker is a convenience, not a constraint: approved patterns are
// already included in the AI system prompt (see packages/ai-gateway
// buildPatternSystemPrompt + apps/web/lib/ai/service.ts), so users can also
// reference a pattern by slug in free-text. The button is a discovery aid.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LayoutGrid, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ApprovedPattern {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  parameters: unknown;
}

export interface PatternPickerButtonProps {
  /**
   * Brand-kit id is required for the nested REST route. Caller resolves
   * this from the deck's brand-kit version (one HTTP round trip avoided by
   * passing both ids down from the server component).
   */
  kitId: string;
  versionId: string;
  /** Disabled when the chat is locked or sending. */
  disabled?: boolean;
  /**
   * Called with a fully-formed prompt string when the user picks a
   * pattern. The composer is responsible for inserting it (typically by
   * prepending to the current input value).
   */
  onPick: (prompt: string) => void;
}

export function PatternPickerButton(props: PatternPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [patterns, setPatterns] = useState<ApprovedPattern[]>([]);

  // Fetch on first open; cache for the dialog session. Refetch each time
  // the dialog reopens so newly-approved patterns appear without a reload.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/brand-kits/${props.kitId}/versions/${props.versionId}/patterns?approvedOnly=1`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          throw new Error((await res.json()).error?.message ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { patterns: ApprovedPattern[] };
        if (!cancelled) setPatterns(body.patterns);
      } catch (err) {
        if (!cancelled) toast.error(`Could not load patterns: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, props.kitId, props.versionId]);

  const pick = (p: ApprovedPattern) => {
    const desc = p.description ? `: ${p.description}` : '';
    props.onPick(`Create a new slide using the \`${p.slug}\` pattern (${p.name})${desc}\n\n`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          className="h-6 gap-1 px-2 text-[11px]"
          title="Insert a brand-kit pattern"
        >
          <LayoutGrid className="h-3 w-3" />
          Pattern
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Use a pattern</DialogTitle>
          <DialogDescription>
            Approved on-brand slide layouts for this deck's brand kit. Picking
            one prepends a prompt to your message; edit it before sending.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : patterns.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No approved patterns yet for this brand-kit version.
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <ul className="space-y-2">
              {patterns.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="w-full rounded-md border bg-card px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {p.category}
                      </Badge>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {p.slug}
                    </div>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
