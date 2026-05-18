'use client';

// Client controller for the brand-kit detail page. Owns the editable draft
// (tokens + voice), the publish-version dialog, and renders each tab's
// content. Identity + References tabs hit live REST endpoints against the
// latest version (assets are version-scoped — if no version exists yet the
// tabs show a hint to publish v1 first).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, ChevronDown, Plus, Trash2, Upload } from 'lucide-react';

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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { FONT_CATALOG, familyCssValue, lookupFontByValue } from '@/lib/brand-kits/font-catalog';
import type { BrandTokens, BrandVoice } from '@/lib/brand-kits/tokens';
import { PatternsTab } from './_components/patterns-tab';

export type VersionSummary = {
  id: string;
  versionLabel: string;
  publishedAt: string;
  summary: string | null;
};

export interface KitDetailClientProps {
  kitId: string;
  kitName: string;
  archived: boolean;
  latestVersion: VersionSummary | null;
  versions: VersionSummary[];
  draftTokens: BrandTokens;
  draftVoice: BrandVoice;
}

export function KitDetailClient(props: KitDetailClientProps) {
  const [tokens, setTokens] = useState<BrandTokens>(props.draftTokens);
  const [voice, setVoice] = useState<BrandVoice>(props.draftVoice);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {props.latestVersion ? (
          <p className="text-xs text-muted-foreground">
            Editing draft based on latest published version{' '}
            <span className="font-mono">{props.latestVersion.versionLabel}</span>.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No published versions yet. Edit the draft and publish version 1 to attach assets.
          </p>
        )}
        <PublishVersionDialog
          kitId={props.kitId}
          tokens={tokens}
          voice={voice}
          existingLabels={props.versions.map((v) => v.versionLabel)}
        />
      </div>

      <Tabs defaultValue="tokens" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens" className="space-y-4">
          <TokensEditor tokens={tokens} onChange={setTokens} />
        </TabsContent>

        <TabsContent value="voice" className="space-y-4">
          <VoiceEditor voice={voice} onChange={setVoice} />
        </TabsContent>

        <TabsContent value="identity">
          {props.latestVersion ? (
            <IdentityTab kitId={props.kitId} versionId={props.latestVersion.id} />
          ) : (
            <EmptyVersionNotice resource="identity assets" />
          )}
        </TabsContent>

        <TabsContent value="references">
          {props.latestVersion ? (
            <ReferencesTab kitId={props.kitId} versionId={props.latestVersion.id} />
          ) : (
            <EmptyVersionNotice resource="reference materials" />
          )}
        </TabsContent>

        <TabsContent value="patterns">
          {props.latestVersion ? (
            <PatternsTab kitId={props.kitId} versionId={props.latestVersion.id} />
          ) : (
            <EmptyVersionNotice resource="slide patterns" />
          )}
        </TabsContent>

        <TabsContent value="versions">
          <VersionsTab kitId={props.kitId} versions={props.versions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyVersionNotice({ resource }: { resource: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Publish version 1 first to attach {resource}.
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$|^rgba?\(|^hsla?\(|^oklch\(|^var\(/;
const KEY_PATTERN = /^[a-z0-9-]+$/;

export function TokensEditor({
  tokens,
  onChange,
}: {
  tokens: BrandTokens;
  onChange: (next: BrandTokens) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Colors</CardTitle>
          </CardHeader>
          <CardContent>
            <ColorRows
              entries={tokens.colors}
              onChange={(next) => onChange({ ...tokens, colors: next })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fonts</CardTitle>
          </CardHeader>
          <CardContent>
            <FontFamilyRows
              entries={tokens.type.fontFamilies}
              onChange={(next) =>
                onChange({ ...tokens, type: { ...tokens.type, fontFamilies: next } })
              }
            />
          </CardContent>
        </Card>
      </div>

      <details className="rounded border bg-muted/30">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          Advanced tokens
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (type scale, spacing, radius, motion — rarely needed)
          </span>
        </summary>
        <div className="grid grid-cols-1 gap-4 p-3 pt-0 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Type — scale</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueRows
                entries={tokens.type.scale}
                placeholderKey="md"
                placeholderValue="1rem"
                onChange={(next) => onChange({ ...tokens, type: { ...tokens.type, scale: next } })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spacing</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueRows
                entries={tokens.spacing}
                placeholderKey="md"
                placeholderValue="1rem"
                onChange={(next) => onChange({ ...tokens, spacing: next })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Radius</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueRows
                entries={tokens.radius}
                placeholderKey="md"
                placeholderValue="0.5rem"
                onChange={(next) => onChange({ ...tokens, radius: next })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Motion</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueRows
                entries={tokens.motion}
                placeholderKey="fast"
                placeholderValue="150ms ease"
                onChange={(next) => onChange({ ...tokens, motion: next })}
              />
            </CardContent>
          </Card>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colors — hex Input + native color picker swatch
// ---------------------------------------------------------------------------

/** True when the value is a 6- or 8-digit hex the native picker can show. */
function isPickableHex(v: string): v is `#${string}` {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v);
}

function ColorRows({
  entries,
  onChange,
}: {
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('#000000');

  function rename(oldKey: string, nextKey: string) {
    if (oldKey === nextKey) return;
    if (!KEY_PATTERN.test(nextKey)) {
      toast.error('Token keys: lowercase letters, digits, hyphens only');
      return;
    }
    if (entries[nextKey] !== undefined) {
      toast.error(`Key "${nextKey}" already exists`);
      return;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      next[k === oldKey ? nextKey : k] = v;
    }
    onChange(next);
  }

  function updateValue(k: string, v: string) {
    onChange({ ...entries, [k]: v });
  }

  function removeKey(k: string) {
    const next = { ...entries };
    delete next[k];
    onChange(next);
  }

  function add() {
    const key = newKey.trim();
    const val = newValue.trim();
    if (!key || !val) return;
    if (!KEY_PATTERN.test(key)) {
      toast.error('Token keys: lowercase letters, digits, hyphens only');
      return;
    }
    if (entries[key] !== undefined) {
      toast.error(`Key "${key}" already exists`);
      return;
    }
    if (!COLOR_PATTERN.test(val)) {
      toast.error('Invalid color (hex, rgb(), hsl(), oklch(), or var())');
      return;
    }
    onChange({ ...entries, [key]: val });
    setNewKey('');
    setNewValue('#000000');
  }

  const sortedKeys = Object.keys(entries).sort();

  return (
    <div className="space-y-2">
      {sortedKeys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No colors yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {sortedKeys.map((k) => {
            const value = entries[k] ?? '';
            const err = COLOR_PATTERN.test(value)
              ? null
              : 'Invalid color (hex, rgb(), hsl(), oklch(), or var())';
            return (
              <li key={k} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <Input
                  defaultValue={k}
                  onBlur={(e) => rename(k, e.target.value.trim())}
                  className="font-mono text-xs sm:max-w-[10rem]"
                  aria-label={`${k} key`}
                />
                <div className="flex flex-1 items-center gap-1.5">
                  <ColorSwatchInput value={value} onChange={(v) => updateValue(k, v)} />
                  <Input
                    value={value}
                    onChange={(e) => updateValue(k, e.target.value)}
                    className="flex-1 font-mono text-xs"
                    aria-label={`${k} value`}
                    placeholder="#0f1140"
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeKey(k)}
                  aria-label={`Remove ${k}`}
                  className="shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {err ? <p className="basis-full text-xs text-destructive">{err}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-3 sm:flex-row sm:items-center">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="primary"
          className="font-mono text-xs sm:max-w-[10rem]"
          aria-label="New color key"
        />
        <div className="flex flex-1 items-center gap-1.5">
          <ColorSwatchInput value={newValue} onChange={setNewValue} />
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="#0f1140"
            className="flex-1 font-mono text-xs"
            aria-label="New color value"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={add}
          disabled={!newKey.trim() || !newValue.trim()}
          leadingIcon={<Plus className="h-4 w-4" />}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * Square swatch that doubles as a native color picker. Falls back to a
 * non-interactive swatch when the value isn't a hex the picker can read
 * (e.g. `rgba(...)`, `var(--x)`); clicking still does nothing in that case
 * but the text Input next door is editable.
 */
function ColorSwatchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pickable = isPickableHex(value);
  // The native picker only understands `#rrggbb`; strip alpha when present.
  const pickerValue = pickable ? value.slice(0, 7) : '#000000';
  return (
    <label
      className="relative inline-flex h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded border"
      style={{ background: value || '#000000' }}
      title={pickable ? 'Pick a color' : 'Edit hex on the right'}
    >
      <input
        type="color"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Color picker"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Font families — pick from the curated Google Fonts catalog
// ---------------------------------------------------------------------------

function FontFamilyRows({
  entries,
  onChange,
}: {
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  function rename(oldKey: string, nextKey: string) {
    if (oldKey === nextKey) return;
    if (!KEY_PATTERN.test(nextKey)) {
      toast.error('Token keys: lowercase letters, digits, hyphens only');
      return;
    }
    if (entries[nextKey] !== undefined) {
      toast.error(`Key "${nextKey}" already exists`);
      return;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      next[k === oldKey ? nextKey : k] = v;
    }
    onChange(next);
  }

  function updateValue(k: string, v: string) {
    onChange({ ...entries, [k]: v });
  }

  function removeKey(k: string) {
    const next = { ...entries };
    delete next[k];
    onChange(next);
  }

  function add() {
    const key = newKey.trim();
    const val = newValue.trim();
    if (!key || !val) return;
    if (!KEY_PATTERN.test(key)) {
      toast.error('Token keys: lowercase letters, digits, hyphens only');
      return;
    }
    if (entries[key] !== undefined) {
      toast.error(`Key "${key}" already exists`);
      return;
    }
    onChange({ ...entries, [key]: val });
    setNewKey('');
    setNewValue('');
  }

  const sortedKeys = Object.keys(entries).sort();

  return (
    <div className="space-y-2">
      {sortedKeys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No fonts yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {sortedKeys.map((k) => {
            const value = entries[k] ?? '';
            return (
              <li key={k} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <Input
                  defaultValue={k}
                  onBlur={(e) => rename(k, e.target.value.trim())}
                  className="font-mono text-xs sm:max-w-[10rem]"
                  aria-label={`${k} key`}
                />
                <div className="flex-1">
                  <FontPicker value={value} onChange={(v) => updateValue(k, v)} />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeKey(k)}
                  aria-label={`Remove ${k}`}
                  className="shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-3 sm:flex-row sm:items-center">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="display"
          className="font-mono text-xs sm:max-w-[10rem]"
          aria-label="New font key"
        />
        <div className="flex-1">
          <FontPicker value={newValue} onChange={setNewValue} placeholder="Choose a font…" />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={add}
          disabled={!newKey.trim() || !newValue.trim()}
          leadingIcon={<Plus className="h-4 w-4" />}
        >
          Add
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Fonts come from a curated Google Fonts list. Picked families are auto-loaded into every deck
        using this kit.
      </p>
    </div>
  );
}

function FontPicker({
  value,
  onChange,
  placeholder = 'Choose a font',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = lookupFontByValue(value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FONT_CATALOG;
    return FONT_CATALOG.filter((f) => f.family.toLowerCase().includes(q));
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-between font-normal"
        >
          <span
            className="truncate text-left"
            style={current ? { fontFamily: familyCssValue(current) } : undefined}
          >
            {current ? current.family : value || placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter fonts…"
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-72">
          <ul className="p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted-foreground">No matches.</li>
            ) : (
              filtered.map((f) => {
                const css = familyCssValue(f);
                const selected = current?.family === f.family;
                return (
                  <li key={f.family}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(css);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-muted ${
                        selected ? 'bg-muted' : ''
                      }`}
                    >
                      <span className="truncate" style={{ fontFamily: css }}>
                        {f.family}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">{f.fallback}</span>
                        {selected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function KeyValueRows({
  entries,
  placeholderKey,
  placeholderValue,
  validate,
  renderSwatch,
  onChange,
}: {
  entries: Record<string, string>;
  placeholderKey: string;
  placeholderValue: string;
  validate?: (v: string) => string | null;
  renderSwatch?: boolean;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  function commit(next: Record<string, string>) {
    onChange(next);
  }

  function updateValue(k: string, v: string) {
    commit({ ...entries, [k]: v });
  }

  function rename(oldKey: string, nextKey: string) {
    if (oldKey === nextKey) return;
    if (!KEY_PATTERN.test(nextKey)) {
      toast.error('Token keys: lowercase letters, digits, hyphens only');
      return;
    }
    if (entries[nextKey] !== undefined) {
      toast.error(`Key "${nextKey}" already exists`);
      return;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      next[k === oldKey ? nextKey : k] = v;
    }
    commit(next);
  }

  function removeKey(k: string) {
    const next = { ...entries };
    delete next[k];
    commit(next);
  }

  function add() {
    const key = newKey.trim();
    const val = newValue.trim();
    if (!key || !val) return;
    if (!KEY_PATTERN.test(key)) {
      toast.error('Token keys: lowercase letters, digits, hyphens only');
      return;
    }
    if (entries[key] !== undefined) {
      toast.error(`Key "${key}" already exists`);
      return;
    }
    if (validate) {
      const err = validate(val);
      if (err) {
        toast.error(err);
        return;
      }
    }
    commit({ ...entries, [key]: val });
    setNewKey('');
    setNewValue('');
  }

  const sortedKeys = Object.keys(entries).sort();

  return (
    <div className="space-y-2">
      {sortedKeys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No entries yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {sortedKeys.map((k) => {
            const value = entries[k] ?? '';
            const err = validate ? validate(value) : null;
            return (
              <li key={k} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <Input
                  defaultValue={k}
                  onBlur={(e) => rename(k, e.target.value.trim())}
                  className="font-mono text-xs sm:max-w-[10rem]"
                  aria-label={`${k} key`}
                />
                <div className="flex flex-1 items-center gap-1.5">
                  {renderSwatch ? (
                    <span
                      aria-hidden
                      className="h-7 w-7 shrink-0 rounded border"
                      style={{ background: value }}
                    />
                  ) : null}
                  <Input
                    value={value}
                    onChange={(e) => updateValue(k, e.target.value)}
                    className="flex-1 font-mono text-xs"
                    aria-label={`${k} value`}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeKey(k)}
                  aria-label={`Remove ${k}`}
                  className="shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {err ? <p className="basis-full text-xs text-destructive">{err}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-3 sm:flex-row sm:items-center">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={placeholderKey}
          className="font-mono text-xs sm:max-w-[10rem]"
          aria-label="New key"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholderValue}
          className="flex-1 font-mono text-xs"
          aria-label="New value"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={add}
          disabled={!newKey.trim() || !newValue.trim()}
          leadingIcon={<Plus className="h-4 w-4" />}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export function VoiceEditor({
  voice,
  onChange,
}: {
  voice: BrandVoice;
  onChange: (next: BrandVoice) => void;
}) {
  const fields: Array<{ key: keyof BrandVoice; label: string; placeholder: string }> = [
    { key: 'tone', label: 'Tone', placeholder: 'Confident, friendly, direct.' },
    {
      key: 'terminology',
      label: 'Terminology',
      placeholder: 'Preferred terms, capitalization, product names.',
    },
    { key: 'dos', label: 'Do', placeholder: 'Use active voice. Lead with outcomes.' },
    { key: 'donts', label: "Don't", placeholder: 'No jargon. No hedging.' },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {fields.map((f) => (
        <Card key={f.key}>
          <CardHeader>
            <CardTitle className="text-base">{f.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={6}
              value={voice[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => onChange({ ...voice, [f.key]: e.target.value })}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity assets
// ---------------------------------------------------------------------------

const IDENTITY_KINDS = [
  { value: 'LOGO_FULL_COLOR', label: 'Logo (full color)' },
  { value: 'LOGO_MONO', label: 'Logo (monochrome)' },
  { value: 'LOGO_LIGHT_BG', label: 'Logo (light bg)' },
  { value: 'LOGO_DARK_BG', label: 'Logo (dark bg)' },
  { value: 'FAVICON', label: 'Favicon' },
] as const;

type IdentityAsset = {
  id: string;
  kind: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

function IdentityTab({ kitId, versionId }: { kitId: string; versionId: string }) {
  const [assets, setAssets] = useState<IdentityAsset[] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/brand-kits/${kitId}/versions/${versionId}/identity`);
      if (!res.ok) {
        toast.error('Failed to load identity assets');
        return;
      }
      const body = await res.json();
      if (!cancelled) setAssets(body.assets ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [kitId, versionId, refreshTick]);

  async function onUpload(kind: string, file: File) {
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    const res = await fetch(`/api/brand-kits/${kitId}/versions/${versionId}/identity`, {
      method: 'POST',
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(body?.error?.message ?? `Upload failed (${res.status})`);
      return;
    }
    toast.success('Uploaded');
    setRefreshTick((t) => t + 1);
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/brand-kits/identity/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Delete failed');
      return;
    }
    setRefreshTick((t) => t + 1);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload identity asset</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IDENTITY_KINDS.map((k) => (
              <FileUploader
                key={k.value}
                label={k.label}
                accept="image/*"
                onPick={(file) => onUpload(k.value, file)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <AssetGrid assets={assets} onDelete={onDelete} />
    </div>
  );
}

function AssetGrid({
  assets,
  onDelete,
}: {
  assets: IdentityAsset[] | null;
  onDelete: (id: string) => void;
}) {
  if (assets === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (assets.length === 0)
    return <p className="text-sm text-muted-foreground">No identity assets uploaded.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-2 p-3">
            <div className="flex h-32 items-center justify-center overflow-hidden rounded border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.originalFilename}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="space-y-1">
              <p className="truncate text-xs font-medium">{a.originalFilename}</p>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {a.kind}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(a.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

type Reference = {
  id: string;
  kind: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  url: string;
};

function ReferencesTab({ kitId, versionId }: { kitId: string; versionId: string }) {
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/brand-kits/${kitId}/versions/${versionId}/references`);
      if (!res.ok) {
        toast.error('Failed to load references');
        return;
      }
      const body = await res.json();
      if (!cancelled) setRefs(body.references ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [kitId, versionId, tick]);

  async function onUpload(file: File) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const form = new FormData();
    form.set('kind', isPdf ? 'PDF' : 'IMAGE');
    form.set('file', file);
    const res = await fetch(`/api/brand-kits/${kitId}/versions/${versionId}/references`, {
      method: 'POST',
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(body?.error?.message ?? `Upload failed (${res.status})`);
      return;
    }
    toast.success('Uploaded');
    setTick((t) => t + 1);
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/brand-kits/references/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Delete failed');
      return;
    }
    setTick((t) => t + 1);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload reference</CardTitle>
        </CardHeader>
        <CardContent>
          <FileUploader label="PDF or image" accept="application/pdf,image/*" onPick={onUpload} />
        </CardContent>
      </Card>

      {refs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : refs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No references uploaded.</p>
      ) : (
        <ul className="space-y-2">
          {refs.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {r.originalFilename}
                </a>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {r.kind}
                  </Badge>
                  <span>{formatBytes(r.sizeBytes)}</span>
                  {r.pageCount ? <span>{r.pageCount} pages</span> : null}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileUploader({
  label,
  accept,
  onPick,
}: {
  label: string;
  accept: string;
  onPick: (file: File) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label
      className={
        'flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed bg-card px-3 py-4 text-center text-xs text-muted-foreground hover:bg-muted ' +
        (busy ? 'pointer-events-none opacity-60' : '')
      }
    >
      <Upload className="h-4 w-4" />
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            await onPick(file);
          } finally {
            // Reset input so re-picking the same file fires onChange again.
            e.target.value = '';
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function VersionsTab({ kitId, versions }: { kitId: string; versions: VersionSummary[] }) {
  if (versions.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No versions published yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {versions.map((v) => (
        <li key={v.id}>
          <Link
            href={`/brand-kits/${kitId}/versions/${v.id}`}
            className="flex flex-col gap-1 rounded border bg-card p-3 hover:border-primary sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-0.5">
              <p className="font-mono text-sm">{v.versionLabel}</p>
              {v.summary ? (
                <p className="line-clamp-1 text-xs text-muted-foreground">{v.summary}</p>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">
              {new Date(v.publishedAt).toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Publish dialog
// ---------------------------------------------------------------------------

function suggestNextLabel(existing: string[]): string {
  const semver = existing
    .map((l) => /^v?(\d+)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const next = semver.length > 0 ? Math.max(...semver) + 1 : 1;
  return `v${next}`;
}

function PublishVersionDialog({
  kitId,
  tokens,
  voice,
  existingLabels,
}: {
  kitId: string;
  tokens: BrandTokens;
  voice: BrandVoice;
  existingLabels: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(() => suggestNextLabel(existingLabels));
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setLabel(suggestNextLabel(existingLabels));
  }, [open, existingLabels]);

  async function onPublish() {
    setBusy(true);
    try {
      const res = await fetch(`/api/brand-kits/${kitId}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          versionLabel: label,
          tokens,
          voice,
          summary: summary || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error?.message ?? `Publish failed (${res.status})`);
        return;
      }
      toast.success(`Published ${label}`);
      setOpen(false);
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
        <Button size="sm">Publish version</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish version</DialogTitle>
          <DialogDescription>
            Snapshots the current tokens and voice into an immutable version. Existing decks keep
            their pinned version until you re-bind them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pv-label">Version label</Label>
            <Input
              id="pv-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="font-mono"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pv-summary">Summary (optional)</Label>
            <Textarea
              id="pv-summary"
              rows={3}
              value={summary}
              placeholder="What changed?"
              onChange={(e) => setSummary(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onPublish} loading={busy} disabled={!label.trim()}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
