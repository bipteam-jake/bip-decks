// Stub Settings page. Phase 1 has no in-app settings surface; placeholder
// only. See docs/bip-deck-platform-phasing.md.

import { Cog } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Workspace preferences and integrations."
      />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Cog className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Settings coming soon</p>
            <p className="text-sm text-muted-foreground">
              Workspace-level configuration lands in a later phase.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
