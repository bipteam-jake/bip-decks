'use client';

// Phase 2.5: Create-deck dialog with a "Quick" vs "Outline-first" toggle.
// - Quick: title + brand kit, mirrors the previous behavior.
// - Outline-first: title + audience/goal/talking points (+ optional tone,
//   target slide count, brand kit) -> creates the deck, opens an outline
//   conversation seeded with the brief, then routes to /decks/[id]/outline.
//
// See docs/bip-deck-platform-phasing.md §3 item 3.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import { BrandKitPicker } from './_components/brand-kit-picker';

type Mode = 'quick' | 'outline';

export function CreateDeckForm({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('quick');
  const [title, setTitle] = useState('');
  const [brandKitVersionId, setBrandKitVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Outline-only fields
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [talkingPoints, setTalkingPoints] = useState('');
  const [tone, setTone] = useState('');
  const [targetSlideCount, setTargetSlideCount] = useState('');

  function reset() {
    setTitle('');
    setBrandKitVersionId(null);
    setAudience('');
    setGoal('');
    setTalkingPoints('');
    setTone('');
    setTargetSlideCount('');
  }

  async function createDeck(): Promise<{ id: string } | null> {
    const res = await fetch('/api/decks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), brandKitVersionId }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(body?.error?.message ?? `Create failed (${res.status})`);
      return null;
    }
    return body.deck as { id: string };
  }

  async function onQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const deck = await createDeck();
      if (!deck) return;
      reset();
      onCreated?.();
      router.push(`/decks/${deck.id}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function outlineValid(): boolean {
    return (
      title.trim().length > 0 &&
      audience.trim().length > 0 &&
      goal.trim().length > 0 &&
      talkingPoints.trim().length > 0
    );
  }

  async function onOutlineSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outlineValid()) return;
    setBusy(true);
    try {
      const deck = await createDeck();
      if (!deck) return;

      const parsedSlideCount = targetSlideCount.trim()
        ? Number.parseInt(targetSlideCount.trim(), 10)
        : undefined;

      const brief = {
        title: title.trim(),
        audience: audience.trim(),
        goal: goal.trim(),
        talkingPoints: talkingPoints.trim(),
        ...(tone.trim() ? { tone: tone.trim() } : {}),
        ...(Number.isFinite(parsedSlideCount) ? { targetSlideCount: parsedSlideCount } : {}),
      };

      const res = await fetch(`/api/decks/${deck.id}/outline-conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Failed to start outline (${res.status})`);
        // Deck was created but conversation wasn't — send the user to the
        // deck page so they can fall back to the editor.
        router.push(`/decks/${deck.id}`);
        return;
      }

      reset();
      onCreated?.();
      router.push(`/decks/${deck.id}/outline`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex flex-col gap-4">
      <TabsList className="grid grid-cols-2"> {/* responsive-allow: 2 short tab labels */}
        <TabsTrigger value="quick" disabled={busy}>
          Quick
        </TabsTrigger>
        <TabsTrigger value="outline" disabled={busy}>
          Outline-first
        </TabsTrigger>
      </TabsList>

      <TabsContent value="quick" className="m-0">
        <form onSubmit={onQuickSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="text"
              required
              value={title}
              placeholder="Deck title"
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1"
              disabled={busy}
            />
            <Button type="submit" disabled={!title.trim()} loading={busy}>
              Create deck
            </Button>
          </div>
          <BrandKitPicker
            value={brandKitVersionId}
            onChange={setBrandKitVersionId}
            disabled={busy}
          />
        </form>
      </TabsContent>

      <TabsContent value="outline" className="m-0">
        <form onSubmit={onOutlineSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Sketch a brief and chat with the AI to lock in slide titles and notes before
            generating the deck. You can refine slide-by-slide before approving.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outline-title">Deck title</Label>
            <Input
              id="outline-title"
              type="text"
              required
              value={title}
              placeholder="e.g. Q1 product strategy"
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outline-audience">Audience</Label>
            <Input
              id="outline-audience"
              type="text"
              required
              value={audience}
              placeholder="e.g. CFO of a mid-market retail client"
              onChange={(e) => setAudience(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outline-goal">Goal</Label>
            <Input
              id="outline-goal"
              type="text"
              required
              value={goal}
              placeholder="What outcome do you want from this deck?"
              onChange={(e) => setGoal(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outline-talking-points">Key talking points</Label>
            <Textarea
              id="outline-talking-points"
              required
              value={talkingPoints}
              placeholder="One per line, or a paragraph — whatever you have."
              onChange={(e) => setTalkingPoints(e.target.value)}
              rows={5}
              disabled={busy}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="outline-tone">Tone (optional)</Label>
              <Input
                id="outline-tone"
                type="text"
                value={tone}
                placeholder="e.g. confident, data-driven"
                onChange={(e) => setTone(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="outline-slide-count">Target slide count (optional)</Label>
              <Input
                id="outline-slide-count"
                type="number"
                min={1}
                max={50}
                value={targetSlideCount}
                placeholder="e.g. 10"
                onChange={(e) => setTargetSlideCount(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <BrandKitPicker
            value={brandKitVersionId}
            onChange={setBrandKitVersionId}
            disabled={busy}
          />

          <div className="flex justify-end">
            <Button type="submit" disabled={!outlineValid()} loading={busy}>
              Start outline
            </Button>
          </div>
        </form>
      </TabsContent>
    </Tabs>
  );
}
