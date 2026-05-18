import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight "who am I" endpoint. Returns 200 with user payload if logged in,
// 200 with `{ user: null }` if anonymous. Used by the frontend to decide
// whether to render the auth shell or the admin shell. Distinguished from a
// 401 because anonymity isn't an error here.
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ user: null });
    return NextResponse.json({
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        kind: ctx.user.kind,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
