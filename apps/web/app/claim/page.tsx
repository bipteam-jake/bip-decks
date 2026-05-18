// /claim — share-link landing page.
//
// Visitors arrive here from `/d/{slug}?st={token}` (the deck route redirects
// when a token is on the URL but no recipient cookie exists). We resolve the
// token server-side so we can show the deck title + inviter context, then
// collect a display name on the client. The client POSTs to
// /api/share-links/claim which sets the per-deck recipient cookie and
// returns the deck URL to navigate to.

import Image from 'next/image';
import { notFound } from 'next/navigation';

import { resolveActiveShareLink } from '@/lib/share-links/service';
import { ParticleBackground } from '@/components/particle-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClaimForm } from './claim-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ClaimPage({ searchParams }: Props) {
  const { token: rawToken } = await searchParams;
  const token = rawToken?.trim();
  if (!token) notFound();
  const resolved = await resolveActiveShareLink(token);
  if (!resolved) notFound();

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden px-4 py-12">
      <ParticleBackground intensity="full" />
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Image
            src="/logo-mark.png"
            alt="BIP"
            width={48}
            height={48}
            className="bd-ops-logo mx-auto mb-2"
            priority
          />
          <CardTitle className="text-lg">You&rsquo;ve been invited to review</CardTitle>
          <p className="text-sm font-medium">{resolved.deck.title}</p>
          <p className="text-sm text-muted-foreground">
            Tell us your name so the team knows who left each comment.
          </p>
        </CardHeader>
        <CardContent>
          <ClaimForm token={token} />
        </CardContent>
      </Card>
    </main>
  );
}
