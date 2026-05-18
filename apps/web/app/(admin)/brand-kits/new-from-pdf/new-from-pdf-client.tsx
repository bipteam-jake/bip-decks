'use client';

// Three-step wizard: upload PDF → stream extraction progress → review and
// edit → create kit + publish v1. Reuses the TokensEditor/VoiceEditor from
// the kit detail page so the review step is identical to the manual editor.
//
// Consumes the SSE stream from /api/brand-kits/extract by parsing the
// `event:` + `data:` lines manually — we don't need EventSource because we
// POST the PDF body and fetch() is the only way to do that without
// downgrading to a presigned upload step.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowLeft, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  BrandTokensSchema,
  BrandVoiceSchema,
  emptyTokens,
  emptyVoice,
  type BrandTokens,
  type BrandVoice,
} from '@/lib/brand-kits/tokens';

import { TokensEditor, VoiceEditor } from '../[id]/kit-detail-client';

type WizardStep = 'upload' | 'streaming' | 'review';

interface StreamLogEntry {
  id: number;
  message: string;
}

export function NewFromPdfClient() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('upload');

  // upload step
  const [file, setFile] = useState<File | null>(null);

  // streaming step
  const [log, setLog] = useState<StreamLogEntry[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // review step
  const [tokens, setTokens] = useState<BrandTokens>(emptyTokens());
  const [voice, setVoice] = useState<BrandVoice>(emptyVoice());
  const [notes, setNotes] = useState<string>('');
  const [name, setName] = useState('');
  const [versionLabel, setVersionLabel] = useState('v1');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep('upload');
    setLog([]);
    setStreamError(null);
    setTokens(emptyTokens());
    setVoice(emptyVoice());
    setNotes('');
    setName('');
    setVersionLabel('v1');
    setSummary('');
  }

  async function onStartExtract() {
    if (!file) return;
    setStep('streaming');
    setLog([{ id: Date.now(), message: 'Submitting PDF…' }]);
    setStreamError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const form = new FormData();
    form.set('file', file);
    let res: Response;
    try {
      res = await fetch('/api/brand-kits/extract', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setStreamError((err as Error).message);
      return;
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      setStreamError(`Extract failed (${res.status}): ${body.slice(0, 200)}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) buffer += decoder.decode(value, { stream: true });
      // Parse one or more SSE events terminated by \n\n.
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleSseEvent(raw);
      }
    }
  }

  function handleSseEvent(raw: string) {
    // Ignore comment-only frames (": stream-open").
    const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLine.slice(6));
    } catch {
      return;
    }
    if (typeof payload !== 'object' || payload === null || !('kind' in payload)) return;
    const ev = payload as
      | { kind: 'status'; message: string }
      | { kind: 'error'; message: string }
      | {
          kind: 'done';
          result: { tokens: unknown; voice: unknown; notes: string };
        };
    if (ev.kind === 'status') {
      setLog((prev) => [...prev, { id: prev.length + 1, message: ev.message }]);
    } else if (ev.kind === 'error') {
      setStreamError(ev.message);
    } else if (ev.kind === 'done') {
      const tokensParsed = BrandTokensSchema.safeParse(ev.result.tokens);
      const voiceParsed = BrandVoiceSchema.safeParse(ev.result.voice);
      if (!tokensParsed.success) {
        setStreamError(
          `Extracted tokens failed validation: ${tokensParsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        );
        return;
      }
      setTokens(tokensParsed.success ? tokensParsed.data : emptyTokens());
      setVoice(voiceParsed.success ? voiceParsed.data : emptyVoice());
      setNotes(ev.result.notes ?? '');
      setStep('review');
    }
  }

  async function onSave() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      // 1) Create the kit.
      const createRes = await fetch('/api/brand-kits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description: notes || undefined }),
      });
      const createBody = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        toast.error(createBody?.error?.message ?? `Create failed (${createRes.status})`);
        return;
      }
      const kitId = createBody.kit.id as string;

      // 2) Publish v1 with the (edited) extracted tokens + voice.
      const publishRes = await fetch(`/api/brand-kits/${kitId}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          versionLabel,
          tokens,
          voice,
          summary: summary || `Extracted from PDF: ${file?.name ?? ''}`.trim(),
        }),
      });
      const publishBody = await publishRes.json().catch(() => null);
      if (!publishRes.ok) {
        toast.error(publishBody?.error?.message ?? `Publish failed (${publishRes.status})`);
        // Still navigate to the (empty-versions) kit so the user can recover.
        router.push(`/brand-kits/${kitId}`);
        return;
      }
      toast.success(`Created "${name}" with ${versionLabel}`);
      router.push(`/brand-kits/${kitId}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render per step
  // -------------------------------------------------------------------------

  if (step === 'upload') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a brand guidelines PDF</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed bg-card px-4 py-10 text-center hover:bg-muted">
            {file ? (
              <>
                <FileText className="h-6 w-6" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · click to choose a different file
                </p>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6" />
                <p className="text-sm font-medium">Choose a PDF</p>
                <p className="text-xs text-muted-foreground">Up to 32 MB</p>
              </>
            )}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
                e.target.value = '';
              }}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/brand-kits">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to kits
              </Link>
            </Button>
            <Button onClick={onStartExtract} disabled={!file}>
              Extract with Claude
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'streaming') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {streamError ? 'Extraction failed' : 'Extracting brand kit…'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!streamError ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Streaming from Claude…</span>
            </div>
          ) : null}
          <ul className="space-y-1 rounded border bg-muted p-3 font-mono text-xs">
            {log.map((entry) => (
              <li key={entry.id}>· {entry.message}</li>
            ))}
            {log.length === 0 ? <li className="text-muted-foreground">(no events yet)</li> : null}
          </ul>
          {streamError ? <p className="text-sm text-destructive">{streamError}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                abortRef.current?.abort();
                reset();
              }}
            >
              {streamError ? 'Start over' : 'Cancel'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // step === 'review'
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kit details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nfp-name">Name</Label>
            <Input
              id="nfp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nfp-label">Version label</Label>
            <Input
              id="nfp-label"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              className="font-mono"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nfp-summary">Version summary (optional)</Label>
            <Textarea
              id="nfp-summary"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={`Extracted from PDF: ${file?.name ?? ''}`}
              disabled={saving}
            />
          </div>
          {notes ? (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Claude&rsquo;s notes:</span> {notes}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TokensEditor tokens={tokens} onChange={setTokens} />
      <VoiceEditor voice={voice} onChange={setVoice} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
          Start over
        </Button>
        <Button onClick={onSave} loading={saving} disabled={!name.trim()}>
          Create kit and publish {versionLabel || 'version'}
        </Button>
      </div>
    </div>
  );
}
