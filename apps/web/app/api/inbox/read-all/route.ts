// Mark every unread mention for the current user as read. Used by the
// "Mark all read" affordance on the inbox page.

import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { markAllInboxRead } from '@/lib/comments/mentions-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    const count = await markAllInboxRead(ctx.user.id);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    return errorResponse(err);
  }
}
