'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function CreateBrandKitDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/brand-kits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Create failed (${res.status})`);
        return;
      }
      setName('');
      setDescription('');
      setOpen(false);
      router.push(`/brand-kits/${body.kit.id}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" leadingIcon={<Plus className="h-4 w-4" />}>
          New brand kit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a brand kit</DialogTitle>
          <DialogDescription>
            A slug is generated from the name. You can publish version 1 from the kit detail page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bk-name">Name</Label>
            <Input
              id="bk-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-desc">Description (optional)</Label>
            <Textarea
              id="bk-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Internal notes about this brand kit"
              disabled={busy}
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!name.trim()} loading={busy}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
