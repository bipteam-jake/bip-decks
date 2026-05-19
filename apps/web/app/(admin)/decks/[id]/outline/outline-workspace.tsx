'use client';

// Two-pane outline workspace: chat on the left, structured outline preview
// on the right. Single-column stack on mobile. Phase 2.5; see
// docs/bip-deck-platform-phasing.md §3 item 3 and
// /workspaces/bip-decks/apps/web/lib/outline/service.ts for the persistence
// shape this client mirrors.

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Send, Sparkles, CheckCircle2, Pencil, X, Plus, Trash2 } from 'lucide-react';

import type { AIConversation, AIMessage } from '@bip/db';
import type { OutlineDraft, OutlineSlide, OutlineTurnPayload } from '@bip/ai-gateway';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface OutlineWorkspaceProps {
  deck: { id: string; slug: string; title: string };
  initialConversation: AIConversation;
  initialMessages: AIMessage[];
}

// Mirror of OutlineMessageContent in lib/outline/service.ts. Duplicated here
// (rather than imported) because the service module pulls in server-only
// dependencies (prisma, simple-git).
type ChatRow =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'user_edit'; text: string; outline: OutlineDraft }
  | { id: string; role: 'assistant'; text: string; outline?: OutlineDraft }
  | { id: string; role: 'assistant_error'; text: string };

function messagesToRows(messages: AIMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const m of messages) {
    const c = m.content as Record<string, unknown>;
    if (m.role === 'USER') {
      if (c.kind === 'edit') {
        rows.push({
          id: m.id,
          role: 'user_edit',
          text: typeof c.text === 'string' ? c.text : 'I edited the outline directly.',
          outline: c.outline as OutlineDraft,
        });
      } else {
        const text = typeof c.text === 'string' ? c.text : '';
        rows.push({ id: m.id, role: 'user', text });
      }
    } else if (m.role === 'ASSISTANT') {
      if (c.kind === 'assistant') {
        const payload = c.payload as OutlineTurnPayload;
        rows.push({
          id: m.id,
          role: 'assistant',
          text: payload.message,
          outline: payload.kind === 'outline' ? payload.outline : undefined,
        });
      } else {
        const userMessage =
          typeof c.userMessage === 'string' ? c.userMessage : 'Something went wrong.';
        rows.push({ id: m.id, role: 'assistant_error', text: userMessage });
      }
    }
  }
  return rows;
}

function findLatestOutline(messages: AIMessage[]): OutlineDraft | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const c = m.content as Record<string, unknown>;
    if (m.role === 'ASSISTANT' && c.kind === 'assistant') {
      const payload = c.payload as OutlineTurnPayload;
      if (payload.kind === 'outline') return payload.outline;
    } else if (m.role === 'USER' && c.kind === 'edit') {
      return c.outline as OutlineDraft;
    }
  }
  return null;
}

export function OutlineWorkspace({
  deck,
  initialConversation,
  initialMessages,
}: OutlineWorkspaceProps) {
  const router = useRouter();
  const [conversation, setConversation] = useState(initialConversation);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<OutlineSlide[] | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => messagesToRows(messages), [messages]);
  const latest = useMemo(() => findLatestOutline(messages), [messages]);
  const approved = Boolean(conversation.approvedAt);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || approved) return;
    setSending(true);
    try {
      const res = await fetch(`/api/outline-conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Failed to send (${res.status})`);
        return;
      }
      setConversation(body.conversation);
      setMessages(body.messages);
      setDraft('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function approve() {
    if (approving || approved || !latest) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/outline-conversations/${conversation.id}/approve`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Approve failed (${res.status})`);
        setApproving(false);
        return;
      }
      toast.success(`Scaffolded ${body.slideCount} slide${body.slideCount === 1 ? '' : 's'}`);
      // Lock the dialog + button until navigation completes so a double-click
      // during the route transition can't fire a second approve (which would
      // 409 with "Outline already approved").
      setApproveOpen(false);
      router.push(`/decks/${deck.id}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      setApproving(false);
    }
  }

  function beginEdit() {
    if (!latest || approved || editing) return;
    // Deep-clone so edits don't mutate the source-of-truth payload.
    setEditDraft(
      latest.slides.map((s) => ({
        id: s.id,
        title: s.title,
        notes: s.notes,
        layoutHint: s.layoutHint ?? null,
        dataPoints: s.dataPoints ? [...s.dataPoints] : [],
      })),
    );
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditDraft(null);
  }

  async function saveEdit() {
    if (!editDraft || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/outline-conversations/${conversation.id}/outline-edits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outline: { slides: editDraft } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Save failed (${res.status})`);
        return;
      }
      setConversation(body.conversation);
      setMessages(body.messages);
      setEditing(false);
      setEditDraft(null);
      toast.success('Outline updated');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  function updateSlide(idx: number, patch: Partial<OutlineSlide>) {
    setEditDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  }

  function addSlide() {
    setEditDraft((prev) => {
      const base = prev ?? [];
      if (base.length >= 50) return prev;
      const id = `s${base.length + 1}`;
      return [...base, { id, title: '', notes: '' }];
    });
  }

  function removeSlide(idx: number) {
    setEditDraft((prev) => (prev && prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Chat pane */}
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Outline chat
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <div
            ref={scrollerRef}
            className="flex max-h-[60vh] min-h-80 flex-col gap-3 overflow-y-auto rounded-md border bg-muted/20 p-3"
          >
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Conversation will appear here.</p>
            ) : (
              rows.map((row) => <ChatBubble key={row.id} row={row} />)
            )}
            {sending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking…
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
              placeholder={
                approved
                  ? 'Outline approved — use the editor for further changes.'
                  : 'Reply, ask for changes, or request a fresh outline. ⌘+Enter to send.'
              }
              disabled={sending || approved}
            />
            <div className="flex justify-end">
              <Button
                onClick={send}
                disabled={!draft.trim() || sending || approved}
                loading={sending}
              >
                <Send className="h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Outline preview pane */}
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Outline preview
              {latest ? (
                <Badge variant="outline" className="ml-2">
                  {editing && editDraft ? editDraft.length : latest.slides.length} slide
                  {(editing && editDraft ? editDraft.length : latest.slides.length) === 1
                    ? ''
                    : 's'}
                </Badge>
              ) : null}
            </span>
            {latest && !approved ? (
              editing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={savingEdit}
                  leadingIcon={<X className="h-4 w-4" />}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={beginEdit}
                  leadingIcon={<Pencil className="h-4 w-4" />}
                >
                  Edit
                </Button>
              )
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {latest ? (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
              {editing && editDraft ? (
                <>
                  {editDraft.map((slide, idx) => (
                    <SlideEditor
                      key={`edit-${idx}`}
                      index={idx + 1}
                      slide={slide}
                      canDelete={editDraft.length > 1}
                      onChange={(patch) => updateSlide(idx, patch)}
                      onRemove={() => removeSlide(idx)}
                    />
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addSlide}
                    disabled={editDraft.length >= 50}
                    leadingIcon={<Plus className="h-4 w-4" />}
                  >
                    Add slide
                  </Button>
                </>
              ) : (
                latest.slides.map((slide, idx) => (
                  <SlidePreview key={slide.id} index={idx + 1} slide={slide} />
                ))
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No outline drafted yet. Once Claude proposes one, it will appear here.
            </p>
          )}

          <div className="flex justify-end gap-2">
            {approved ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Approved
              </Badge>
            ) : editing ? (
              <Button
                onClick={saveEdit}
                loading={savingEdit}
                disabled={!editDraft || editDraft.length === 0}
              >
                Save edits
              </Button>
            ) : (
              <Dialog open={approveOpen} onOpenChange={(o) => !approving && setApproveOpen(o)}>
                <Button
                  disabled={!latest || approving}
                  loading={approving}
                  onClick={() => setApproveOpen(true)}
                >
                  Approve outline
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Approve outline?</DialogTitle>
                    <DialogDescription>
                      {latest
                        ? `This will scaffold ${latest.slides.length} slide stub${latest.slides.length === 1 ? '' : 's'} into the deck and replace the starter slide. You can then refine each slide with the AI editor.`
                        : ''}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setApproveOpen(false)}
                      disabled={approving}
                    >
                      Cancel
                    </Button>
                    <Button onClick={approve} loading={approving} disabled={approving}>
                      Approve &amp; scaffold
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChatBubble({ row }: { row: ChatRow }) {
  if (row.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {row.text}
        </div>
      </div>
    );
  }
  if (row.role === 'user_edit') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <p className="flex items-center gap-1 text-xs font-medium text-primary">
            <Pencil className="h-3 w-3" />
            Manual edit
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Outline now has {row.outline.slides.length} slide
            {row.outline.slides.length === 1 ? '' : 's'} — see preview pane.
          </p>
        </div>
      </div>
    );
  }
  if (row.role === 'assistant_error') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {row.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-md border bg-background px-3 py-2 text-sm">
        {row.text}
        {row.outline ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Updated outline ({row.outline.slides.length} slide
            {row.outline.slides.length === 1 ? '' : 's'}) — see preview pane.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SlidePreview({ index, slide }: { index: number; slide: OutlineSlide }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            {String(index).padStart(2, '0')}
          </span>
          {slide.title}
        </h3>
        {slide.layoutHint ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {slide.layoutHint}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{slide.notes}</p>
      {slide.dataPoints && slide.dataPoints.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {slide.dataPoints.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface SlideEditorProps {
  index: number;
  slide: OutlineSlide;
  canDelete: boolean;
  onChange: (patch: Partial<OutlineSlide>) => void;
  onRemove: () => void;
}

function SlideEditor({ index, slide, canDelete, onChange, onRemove }: SlideEditorProps) {
  const dataPointsText = (slide.dataPoints ?? []).join('\n');
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {String(index).padStart(2, '0')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={!canDelete}
          leadingIcon={<Trash2 className="h-3 w-3" />}
        >
          Remove
        </Button>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <Input
            value={slide.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Slide title"
            maxLength={200}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <Textarea
            value={slide.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            rows={3}
            placeholder="1–3 sentences describing the slide's narrative."
            maxLength={2000}
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Layout hint</span>
            <Input
              value={slide.layoutHint ?? ''}
              onChange={(e) => onChange({ layoutHint: e.target.value || null })}
              placeholder="e.g. hero, two-column"
              maxLength={100}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Data points (one per line)
            </span>
            <Textarea
              value={dataPointsText}
              onChange={(e) =>
                onChange({
                  dataPoints: e.target.value
                    .split(/\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                })
              }
              rows={3}
              placeholder={'Stat: 32% YoY growth\nQuote: “…”'}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
