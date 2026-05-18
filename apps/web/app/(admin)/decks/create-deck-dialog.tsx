'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { CreateDeckForm } from './create-deck-form';

export function CreateDeckDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" leadingIcon={<Plus className="h-4 w-4" />}>
          New deck
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a deck</DialogTitle>
          <DialogDescription>
            Pick a title. A slug and starter scaffold will be generated for you.
          </DialogDescription>
        </DialogHeader>
        <CreateDeckForm onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
