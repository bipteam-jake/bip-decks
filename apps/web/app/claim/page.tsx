// /claim — share-link landing page.
//
// Visitors arrive here from `/d/{slug}?st={token}` (the deck route redirects
// when a token is on the URL but no recipient cookie exists). We resolve the
// token server-side so we can show the deck title + inviter context, then
// collect a display name on the client. The client POSTs to
// /api/share-links/claim which sets the per-deck recipient cookie and
// returns the deck URL to navigate to.

import { notFound } from 'next/navigation';

import { resolveActiveShareLink } from '@/lib/share-links/service';
import { ClaimForm } from './claim-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  searchParams: { token?: string };
};

export default async function ClaimPage({ searchParams }: Props) {
  const token = searchParams.token?.trim();
  if (!token) notFound();
  const resolved = await resolveActiveShareLink(token);
  if (!resolved) notFound();

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">You&rsquo;ve been invited to review</h1>
      <p className="mt-2 text-gray-700">
        <span className="font-medium">{resolved.deck.title}</span>
      </p>
      <p className="mt-4 text-sm text-gray-600">
        Tell us your name so the team knows who left each comment.
      </p>
      <ClaimForm token={token} />
    </main>
  );
}
