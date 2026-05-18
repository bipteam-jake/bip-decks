'use client';

// Patterns tab for the brand-kit detail page (Phase 2.2).
//
// Patterns are reusable on-brand slide layouts attached to a specific
// brand-kit version. The list reflects the *latest published version* (the
// same one the editor uses to seed brand-kit context for AI turns).
//
// Phase 2.2 scope:
//   - List all patterns for the version.
//   - Create a new pattern via a Dialog (name, description, category,
//     html template, optional css, JSON parameters, approve toggle).
//   - Toggle approved on an existing pattern.
//   - Delete a pattern.
// Out of scope (Phase 3+):
//   - Live preview / Playwright thumbnails.
//   - In-place editing of html/css/parameters (delete-and-recreate instead;
//     patterns are intentionally stable for AI prompt cacheability).
//   - Per-pattern usage analytics.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Pattern = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  htmlTemplate: string;
  cssTemplate: string | null;
  parameters: unknown;
  approved: boolean;
  createdAt: string;
};

interface PatternsTabProps {
  kitId: string;
  versionId: string;
}

export function PatternsTab({ kitId, versionId }: PatternsTabProps) {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brand-kits/${kitId}/versions/${versionId}/patterns`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Failed to load');
      const body = (await res.json()) as { patterns: Pattern[] };
      setPatterns(body.patterns);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kitId, versionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Pattern library</h3>
          <p className="text-xs text-muted-foreground">
            Reusable on-brand slide layouts. Approved patterns are exposed to the AI editor so it
            can request them by slug.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> New pattern
            </Button>
          </DialogTrigger>
          <CreatePatternDialogContent
            kitId={kitId}
            versionId={versionId}
            onCreated={() => {
              setCreateOpen(false);
              void refresh();
            }}
          />
        </Dialog>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading patterns…
          </CardContent>
        </Card>
      ) : patterns.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No patterns yet. Create one above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {patterns.map((p) => (
            <PatternCard
              key={p.id}
              kitId={kitId}
              versionId={versionId}
              pattern={p}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-pattern card
// ---------------------------------------------------------------------------

function PatternCard({
  kitId,
  versionId,
  pattern,
  onChanged,
}: {
  kitId: string;
  versionId: string;
  pattern: Pattern;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const toggleApproved = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/brand-kits/${kitId}/versions/${versionId}/patterns/${pattern.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ approved: !pattern.approved }),
        },
      );
      if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Failed');
      toast.success(pattern.approved ? 'Pattern unapproved' : 'Pattern approved');
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/brand-kits/${kitId}/versions/${versionId}/patterns/${pattern.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        throw new Error((await res.json()).error?.message ?? 'Failed');
      }
      toast.success('Pattern deleted');
      setDeleteOpen(false);
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paramCount = Array.isArray(pattern.parameters) ? pattern.parameters.length : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{pattern.name}</CardTitle>
            <p className="truncate font-mono text-xs text-muted-foreground">{pattern.slug}</p>
          </div>
          {pattern.approved ? (
            <Badge variant="default">Approved</Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {pattern.description && (
          <p className="text-muted-foreground line-clamp-2">{pattern.description}</p>
        )}
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{pattern.category}</Badge>
          <span>
            {paramCount} parameter{paramCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={toggleApproved}>
            {pattern.approved ? 'Unapprove' : 'Approve'}
          </Button>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete pattern?</DialogTitle>
                <DialogDescription>
                  This removes <span className="font-mono">{pattern.slug}</span> from the AI
                  editor's pattern catalog. Existing slides that already used the pattern keep their
                  inlined HTML.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create-pattern dialog
// ---------------------------------------------------------------------------

const DEFAULT_PARAMETERS_JSON = `[
  { "name": "title", "type": "string", "required": true }
]`;

const DEFAULT_HTML_TEMPLATE = `<section class="slide" data-slide-id="{{slide-id}}" data-slide-title="{{title}}">
  <h1>{{title}}</h1>
</section>
`;

function CreatePatternDialogContent({
  kitId,
  versionId,
  onCreated,
}: {
  kitId: string;
  versionId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [html, setHtml] = useState(DEFAULT_HTML_TEMPLATE);
  const [css, setCss] = useState('');
  const [parametersJson, setParametersJson] = useState(DEFAULT_PARAMETERS_JSON);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    let parameters: unknown;
    try {
      parameters = JSON.parse(parametersJson);
    } catch (err) {
      setError(`Parameters must be valid JSON: ${(err as Error).message}`);
      return;
    }
    if (!Array.isArray(parameters)) {
      setError('Parameters must be a JSON array.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/brand-kits/${kitId}/versions/${versionId}/patterns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          category,
          htmlTemplate: html,
          cssTemplate: css || undefined,
          parameters,
          approved,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('Pattern created');
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>New pattern</DialogTitle>
        <DialogDescription>
          Describe a reusable on-brand slide layout. Use{' '}
          <code className="font-mono text-xs">{'{{param-name}}'}</code> placeholders in the HTML/CSS
          — they will be substituted with caller values when the pattern is instantiated.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pattern-name">Name</Label>
          <Input
            id="pattern-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cover with image"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pattern-category">Category</Label>
          <Input
            id="pattern-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="cover, content, divider, …"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pattern-description">Description</Label>
        <Textarea
          id="pattern-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One-line description Claude will see when picking patterns."
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pattern-html">HTML template</Label>
        <Textarea
          id="pattern-html"
          rows={6}
          className="font-mono text-xs"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pattern-css">CSS template (optional)</Label>
        <Textarea
          id="pattern-css"
          rows={4}
          className="font-mono text-xs"
          value={css}
          onChange={(e) => setCss(e.target.value)}
          placeholder="/* Pattern-scoped CSS, optional */"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pattern-params">Parameters (JSON array)</Label>
        <Textarea
          id="pattern-params"
          rows={5}
          className="font-mono text-xs"
          value={parametersJson}
          onChange={(e) => setParametersJson(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Each item:{' '}
          <code className="font-mono">{'{ name, type, required?, default?, description? }'}</code>.
          Allowed types: string, number, boolean, color, image-url.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={approved ? 'default' : 'outline'}
          size="sm"
          onClick={() => setApproved((v) => !v)}
        >
          {approved ? 'Approved (visible to AI)' : 'Draft (hidden from AI)'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button onClick={submit} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Create pattern
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
