// Singleton Redis client. Lazy-connect so the dev server boots even if Redis
// isn't reachable at startup (the health route surfaces the real status).
import Redis from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var __bipRedis: Redis | undefined;
}

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis: Redis =
  globalThis.__bipRedis ??
  new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__bipRedis = redis;
}
