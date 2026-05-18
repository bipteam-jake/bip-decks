// Login page. Public route — middleware does not gate `/login`.
//
// Server component shell + client-side form (form posts via fetch so we can
// render inline errors without a full page reload). On success the browser
// has a session cookie and we hard-navigate to `next` (or /decks).

import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/middleware';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  // Already signed in? Skip the form.
  const ctx = await getSessionContext();
  if (ctx) redirect(safeNext(searchParams.next));

  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-neutral-600">BIP Deck Platform</p>
      <div className="mt-6">
        <LoginForm next={safeNext(searchParams.next)} />
      </div>
    </main>
  );
}

// Don't honor arbitrary URLs in ?next= — only same-origin paths starting with /
// and not //. Keeps an open-redirect out of the auth flow.
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/decks';
  return next;
}
