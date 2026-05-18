// Brand-kit list — server component.

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { listBrandKits, listBrandKitVersions } from '@/lib/brand-kits/service';

import { CreateBrandKitDialog } from './create-brand-kit-dialog';

export const dynamic = 'force-dynamic';

export default async function BrandKitsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const includeArchived = sp.archived === '1';
  const kits = await listBrandKits({ includeArchived });

  const rows = await Promise.all(
    kits.map(async (k) => {
      const versions = await listBrandKitVersions(k.id);
      const latest = versions[0] ?? null;
      return { kit: k, latest, versionCount: versions.length };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand kits"
        description={`${kits.length} ${kits.length === 1 ? 'kit' : 'kits'}${
          includeArchived ? ' (including archived)' : ''
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={includeArchived ? '/brand-kits' : '/brand-kits?archived=1'}>
                {includeArchived ? 'Hide archived' : 'Show archived'}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/brand-kits/new-from-pdf">From PDF…</Link>
            </Button>
            <CreateBrandKitDialog />
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">No brand kits yet</p>
            <p className="text-sm text-muted-foreground">
              Click &ldquo;New brand kit&rdquo; to create your first one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ kit, latest, versionCount }) => (
            <Link key={kit.id} href={`/brand-kits/${kit.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary">
                <CardHeader className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="truncate text-base">{kit.name}</CardTitle>
                    {kit.archivedAt ? (
                      <Badge variant="secondary" className="shrink-0">
                        Archived
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{kit.slug}</p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {kit.description ? (
                    <p className="line-clamp-2 text-muted-foreground">{kit.description}</p>
                  ) : (
                    <p className="italic text-muted-foreground">No description</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {versionCount} {versionCount === 1 ? 'version' : 'versions'}
                    </span>
                    {latest ? (
                      <span>
                        Latest: <span className="font-mono">{latest.versionLabel}</span>
                      </span>
                    ) : (
                      <span className="italic">No versions yet</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
