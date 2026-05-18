import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { login } from '@/lib/auth/service';
import { setSessionCookie } from '@/lib/auth/cookies';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1024),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError('Invalid request body', parsed.error.flatten());
    }

    const userAgent = req.headers.get('user-agent');
    // Best-effort IP capture. Behind nginx in prod we'd parse X-Forwarded-For;
    // dev relies on the direct request.ip, which Next exposes via the header.
    const ipAddress =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      null;

    const result = await login({ ...parsed.data, userAgent, ipAddress });
    await setSessionCookie(result.session.rawToken);

    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        kind: result.user.kind,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
