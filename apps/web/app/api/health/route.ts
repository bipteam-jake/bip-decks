import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

// Used by the docker-compose healthcheck stanza on the `app` service.
// Returns 200 only when Postgres AND Redis are both reachable.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse> {
  const [db, redisOk] = await Promise.all([checkDb(), checkRedis()]);
  const ok = db && redisOk;
  return NextResponse.json({ ok, db, redis: redisOk }, { status: ok ? 200 : 503 });
}
