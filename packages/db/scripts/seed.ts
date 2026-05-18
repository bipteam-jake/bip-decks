// Seed script. Idempotent: re-running upserts the admin user without changing
// the password if one already exists.
//
// Usage:
//   ADMIN_EMAIL=jake@bip.team ADMIN_PASSWORD=correct-horse-battery-staple \
//     ADMIN_NAME="Jake Dahms" npm run db:seed
//
// Defaults are dev-only and printed at the top so it's obvious when they're in
// use. Production seeding must always pass explicit values.

import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Argon2id is the library default for @node-rs/argon2; the `algorithm` field
// is a const enum we can't reference under isolatedModules.
const HASH_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@bip.local').toLowerCase().trim();
  const name = process.env.ADMIN_NAME ?? 'Admin';
  const password = process.env.ADMIN_PASSWORD ?? 'change-me-immediately';

  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }

  const usingDefaults =
    !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_NAME;
  if (usingDefaults) {
    console.warn(
      '[seed] WARNING: using default admin credentials. Override with ' +
        'ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME for anything beyond local dev.',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] Admin user already exists: ${email} (id=${existing.id})`);
    return;
  }

  const passwordHash = await hash(password, HASH_OPTS);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, kind: 'TEAM' },
  });
  console.log(`[seed] Created admin user: ${user.email} (id=${user.id})`);
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
