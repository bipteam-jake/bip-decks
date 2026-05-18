// Root path is handled by middleware (cookie-absent → /login) and then by
// (admin)/layout.tsx for token validation. If a request still lands here
// (cookie present, valid session) bounce them into the admin shell.

import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/decks');
}
