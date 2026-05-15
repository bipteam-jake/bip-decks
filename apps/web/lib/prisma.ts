// Singleton Prisma client for the Next.js dev server. The HMR cycle would
// otherwise create a new client on every reload and exhaust the connection pool.
import { PrismaClient } from '@bip/db';

declare global {
  // eslint-disable-next-line no-var
  var __bipPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__bipPrisma ?? new PrismaClient({ log: ['error', 'warn'] });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__bipPrisma = prisma;
}
