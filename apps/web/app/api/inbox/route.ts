// Inbox listing. Returns @mention entries for the current team user,
// newest first. Optional ?unread=1 filter. See phasing.md §3 item 2.

import { NextResponse, type NextRequest } from 'next/server';

import { getSessionContext } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { listInbox, countUnreadInbox } from '@/lib/comments/mentions-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    const unread = req.nextUrl.searchParams.get('unread') === '1';
    const limit = Math.min(
      200,
      Number(req.nextUrl.searchParams.get('limit') ?? '100') || 100,
    );
    const [entries, unreadCount] = await Promise.all([
      listInbox({ userId: ctx.user.id, onlyUnread: unread, limit }),
      countUnreadInbox(ctx.user.id),
    ]);
    return NextResponse.json({ entries, unreadCount });
  } catch (err) {
    return errorResponse(err);
  }
}
