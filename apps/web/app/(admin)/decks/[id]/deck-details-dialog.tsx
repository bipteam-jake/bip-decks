'use client';

// Deck details lives in a Dialog so it doesn't crowd the editor on the
// detail page. Triggered from the PageHeader actions slot.

import { useState } from 'react';
import { Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

import { DeckActions } from './deck-actions';
import { RenameDeck } from './rename-deck';
import { DeckBrandKitRow } from '../_components/deck-brand-kit-row';

interface Props {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  brandKitVersionId: string | null;
}

export function DeckDetailsDialog({
  id,
  title,
  createdAt,
  updatedAt,
  archived,
  brandKitVersionId,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" leadingIcon={<Settings2 className="h-4 w-4" />}>
          Details
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deck details</DialogTitle>
          <DialogDescription>Rename, archive, or soft-delete this deck.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Row label="Title">
            <RenameDeck id={id} initialTitle={title} />
          </Row>
          <Row label="Created">
            <span className="text-xs text-muted-foreground">{createdAt}</span>
          </Row>
          <Row label="Updated">
            <span className="text-xs text-muted-foreground">{updatedAt}</span>
          </Row>
          <Row label="Brand kit">
            <DeckBrandKitRow deckId={id} initialBrandKitVersionId={brandKitVersionId} />
          </Row>
          <Separator />
          <DeckActions id={id} archived={archived} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[6rem_1fr] sm:gap-2">
      <dt className="text-eyebrow">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
