// Admin shell layout. Server-side auth check + header chrome shared by every
// route under (admin). The (admin) route group keeps URLs clean — pages live
// at /decks, /decks/[id], etc., not /(admin)/decks.
//
// Auth: getSessionContext() validates the cookie. Middleware already redirects
// cookie-absent requests; this catches invalid/expired tokens too.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionContext } from '@/lib/auth/middleware';
import { LogoutButton } from './logout-button';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/decks" className="text-sm font-semibold tracking-tight">
              BIP Decks
            </Link>
            <nav className="text-sm">
              <Link href="/decks" className="text-neutral-700 hover:text-neutral-900">
                Decks
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <span>{ctx.user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
    </div>
  );
}
