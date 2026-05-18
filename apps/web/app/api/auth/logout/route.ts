import { NextResponse } from 'next/server';
import { logout } from '@/lib/auth/service';
import { clearSessionCookie, readSessionCookie } from '@/lib/auth/cookies';
import { errorResponse } from '@/lib/api/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    const raw = await readSessionCookie();
    await logout(raw);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
