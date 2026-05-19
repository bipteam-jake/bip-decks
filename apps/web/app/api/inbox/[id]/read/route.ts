// Mark a single inbox entry as read. POST is idempotent — re-reading a
// read entry is a no-op (returns 200, ok: true).

import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { markInboxRead } from '@/lib/comments/mentions-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    const { id } = await params;
    const updated = await markInboxRead({ mentionId: id, userId: ctx.user.id });
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return errorResponse(err);
  }
}
