// Admin shell layout. Server-side auth check + sidebar/header chrome shared
// by every route under (admin). The (admin) route group keeps URLs clean —
// pages live at /decks, /decks/[id], etc., not /(admin)/decks.
//
// Auth: getSessionContext() validates the cookie. Middleware already redirects
// cookie-absent requests; this catches invalid/expired tokens too.

import { redirect } from 'next/navigation';

import { Header } from '@/components/app-shell/header';
import { MainContentWrapper } from '@/components/main-content-wrapper';
import { Sidebar } from '@/components/app-shell/sidebar';
import { getSessionContext } from '@/lib/auth/middleware';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <MainContentWrapper>{children}</MainContentWrapper>
      </div>
    </div>
  );
}
