// Read-only view of a published brand-kit version. Renders tokens + voice
// + the resolved CSS that the bundler injects. Lists identity assets and
// references but doesn't allow mutation — that lives on the kit detail page
// (which targets the LATEST version).

import { notFound } from 'next/navigation';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getBrandKitById, getBrandKitVersionById } from '@/lib/brand-kits/service';
import { listIdentityAssets, listReferences } from '@/lib/brand-kits/assets';
import { parseTokens, parseVoice, resolveTokensToCss } from '@/lib/brand-kits/tokens';
import { presignDownloadUrl } from '@/lib/storage/s3';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

export default async function BrandKitVersionPage({ params }: Ctx) {
  const { id, versionId } = await params;
  let kit;
  let version;
  try {
    kit = await getBrandKitById(id);
    version = await getBrandKitVersionById(versionId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (version.brandKitId !== kit.id) notFound();

  const tokens = parseTokens(version.tokens);
  const voice = parseVoice(version.voice);
  const css = resolveTokensToCss(tokens);

  const [identity, refs] = await Promise.all([
    listIdentityAssets(version.id),
    listReferences(version.id),
  ]);
  const identityWithUrls = await Promise.all(
    identity.map(async (a) => ({ ...a, url: await presignDownloadUrl(a.s3Key) })),
  );
  const refsWithUrls = await Promise.all(
    refs.map(async (r) => ({ ...r, url: await presignDownloadUrl(r.s3Key) })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {kit.name}
            <Badge variant="outline" className="font-mono">
              {version.versionLabel}
            </Badge>
          </span>
        }
        description={
          <span className="text-xs text-muted-foreground">
            Published {new Date(version.publishedAt).toLocaleString()}
            {version.summary ? ` — ${version.summary}` : ''}
          </span>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/brand-kits/${kit.id}`}>Back to kit</Link>
          </Button>
        }
      />

      <Tabs defaultValue="tokens" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="css">Resolved CSS</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ReadOnlyMap title="Colors" entries={tokens.colors} swatches />
            <ReadOnlyMap title="Type — families" entries={tokens.type.fontFamilies} />
            <ReadOnlyMap title="Type — scale" entries={tokens.type.scale} />
            <ReadOnlyMap title="Spacing" entries={tokens.spacing} />
            <ReadOnlyMap title="Radius" entries={tokens.radius} />
            <ReadOnlyMap title="Motion" entries={tokens.motion} />
          </div>
        </TabsContent>

        <TabsContent value="voice">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(
              [
                ['Tone', voice.tone],
                ['Terminology', voice.terminology],
                ['Do', voice.dos],
                ["Don't", voice.donts],
              ] as const
            ).map(([title, body]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {body || <span className="italic">Not specified.</span>}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="identity">
          {identityWithUrls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No identity assets.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {identityWithUrls.map((a) => (
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
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{a.originalFilename}</p>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {a.kind}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="references">
          {refsWithUrls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No references.</p>
          ) : (
            <ul className="space-y-2">
              {refsWithUrls.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1 rounded border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {r.originalFilename}
                  </a>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {r.kind}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="css">
          <Card>
            <CardContent className="p-3">
              <pre className="overflow-x-auto whitespace-pre rounded bg-muted p-3 font-mono text-xs">
                {css}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReadOnlyMap({
  title,
  entries,
  swatches,
}: {
  title: string;
  entries: Record<string, string | number>;
  swatches?: boolean;
}) {
  const keys = Object.keys(entries).sort();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No entries.</p>
        ) : (
          <ul className="space-y-1.5">
            {keys.map((k) => {
              const value = String(entries[k]);
              return (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono">{k}</span>
                  {swatches ? (
                    <span
                      aria-hidden
                      className="h-5 w-5 shrink-0 rounded border"
                      style={{ background: value }}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-muted-foreground">
                    {value}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
