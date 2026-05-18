import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createUser } from '@/lib/auth/service';
import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Phase 1: signup is invite-only — only an authenticated TEAM user may
    // create new accounts. There is no public registration endpoint.
    await requireTeamUser();

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten());
    }

    const user = await createUser(parsed.data);
    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name, kind: user.kind } },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
