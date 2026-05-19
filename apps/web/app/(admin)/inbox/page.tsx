// Inbox — @mentions surfaced to the current user. Server fetches the
// entries; the client wrapper handles read/mark-all-read actions. Phasing
// §3 item 2.

import { notFound } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/middleware';
import { listInbox } from '@/lib/comments/mentions-service';
import { PageHeader } from '@/components/ui/page-header';
import { InboxList } from './inbox-list';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const ctx = await getSessionContext();
  if (!ctx) notFound();

  const entries = await listInbox({ userId: ctx.user.id, limit: 100 });
  // Serialize Date → ISO so the client component receives plain JSON.
  const serialized = entries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    readAt: e.readAt?.toISOString() ?? null,
    comment: { ...e.comment, createdAt: e.comment.createdAt.toISOString() },
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inbox"
        description="Comments and admin notes where someone @mentioned you."
      />
      <InboxList initialEntries={serialized} />
    </div>
  );
}
