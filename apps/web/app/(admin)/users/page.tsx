// Stub Users page. Phase 1 ships with a single TEAM kind and no in-app user
// management UI. See docs/bip-deck-platform-phasing.md.

import { Users } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Team members with access to the BIP Decks workspace."
      />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">User management coming soon</p>
            <p className="text-sm text-muted-foreground">
              Phase 1 ships with a single team. Per-user provisioning lands in a later phase.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
