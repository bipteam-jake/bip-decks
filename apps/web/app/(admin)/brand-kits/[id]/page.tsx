// Brand-kit detail — server component. Loads the kit + all versions, hands
// off to the client component for tabbed editing. The "draft" the user edits
// is seeded from the latest version's tokens+voice (or empty if none).

import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { getBrandKitById, listBrandKitVersions } from '@/lib/brand-kits/service';
import { emptyTokens, emptyVoice, parseTokens, parseVoice } from '@/lib/brand-kits/tokens';
import { NotFoundError } from '@/lib/errors';
import Link from 'next/link';

import { KitDetailClient } from './kit-detail-client';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export default async function BrandKitDetailPage({ params }: Ctx) {
  const { id } = await params;
  let kit;
  try {
    kit = await getBrandKitById(id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const versions = await listBrandKitVersions(id);
  const latest = versions[0] ?? null;

  // Seed the editable draft from the latest published version (or empty).
  // parse* throws on invalid stored data — surface that as a hard error.
  const draftTokens = latest ? parseTokens(latest.tokens) : emptyTokens();
  const draftVoice = latest ? parseVoice(latest.voice) : emptyVoice();

  return (
    <div className="space-y-6">
      <PageHeader
        title={kit.name}
        description={<span className="font-mono text-xs text-muted-foreground">{kit.slug}</span>}
        actions={
          <div className="flex items-center gap-2">
            {kit.archivedAt ? (
              <Badge variant="secondary">Archived</Badge>
            ) : (
              <Badge variant="outline">
                {versions.length} {versions.length === 1 ? 'version' : 'versions'}
              </Badge>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/brand-kits">Back</Link>
            </Button>
          </div>
        }
      />

      <KitDetailClient
        kitId={kit.id}
        kitName={kit.name}
        archived={!!kit.archivedAt}
        latestVersion={
          latest
            ? {
                id: latest.id,
                versionLabel: latest.versionLabel,
                publishedAt: latest.publishedAt.toISOString(),
                summary: latest.summary,
              }
            : null
        }
        versions={versions.map((v) => ({
          id: v.id,
          versionLabel: v.versionLabel,
          publishedAt: v.publishedAt.toISOString(),
          summary: v.summary,
        }))}
        draftTokens={draftTokens}
        draftVoice={draftVoice}
      />
    </div>
  );
}
