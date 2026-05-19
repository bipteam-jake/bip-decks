// Mentionable team users — used by the comment composer's @autocomplete.
// Returns id, email, name. Team-only; recipients can mention by typing the
// email but they don't get a directory.

import { NextResponse, type NextRequest } from 'next/server';

import { getSessionContext } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { listMentionableUsers } from '@/lib/comments/mentions-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    const query = req.nextUrl.searchParams.get('q') ?? undefined;
    const users = await listMentionableUsers({ query, limit: 20 });
    return NextResponse.json({ users });
  } catch (err) {
    return errorResponse(err);
  }
}
