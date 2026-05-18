// Login page. Public route — middleware does not gate `/login`.
//
// Server component shell + client-side form (form posts via fetch so we can
// render inline errors without a full page reload). On success the browser
// has a session cookie and we hard-navigate to `next` (or /decks).

import Image from 'next/image';
import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/middleware';
import { ParticleBackground } from '@/components/particle-background';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Already signed in? Skip the form.
  const ctx = await getSessionContext();
  if (ctx) redirect(safeNext(next));

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden px-4 py-12">
      <ParticleBackground intensity="full" />
      <Card className="relative z-10 w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image
            src="/logo-mark.png"
            alt="BIP"
            width={48}
            height={48}
            className="bd-ops-logo mx-auto mb-2"
            priority
          />
          <CardTitle className="bd-ops-text text-lg">BIP Decks</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNext(next)} />
        </CardContent>
      </Card>
    </main>
  );
}

// Don't honor arbitrary URLs in ?next= — only same-origin paths starting with /
// and not //. Keeps an open-redirect out of the auth flow.
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/decks';
  return next;
}
