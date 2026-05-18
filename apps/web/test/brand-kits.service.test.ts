// Brand-kit service tests. Real Postgres; no S3 (assets covered separately).
// Mirrors the test isolation pattern from decks.service.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import {
  archiveBrandKit,
  createBrandKit,
  emptyDraft,
  getBrandKitById,
  getBrandKitVersionById,
  listBrandKits,
  listBrandKitVersions,
  publishBrandKitVersion,
  renameBrandKit,
  unarchiveBrandKit,
} from '@/lib/brand-kits/service';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { User } from '@bip/db';

const TEST_TAG = '+brandkitvitest@bip.test';
const TEST_SLUG_PREFIX = 'vt-bk-';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}

function uniqueName(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'creator'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `BK Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
});

afterEach(async () => {
  await prisma.brandKit.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('createBrandKit', () => {
  it('creates a kit with a derived slug', async () => {
    const u = await makeUser();
    const name = uniqueName('Acme');
    const kit = await createBrandKit({ name }, u);
    expect(kit.name).toBe(name);
    expect(kit.slug).toMatch(/^vt-bk-acme/);
    expect(kit.archivedAt).toBeNull();
  });

  it('rejects an empty name', async () => {
    const u = await makeUser();
    await expect(createBrandKit({ name: '   ' }, u)).rejects.toBeInstanceOf(ValidationError);
  });

  it('produces unique slugs on collision', async () => {
    const u = await makeUser();
    const name = uniqueName('Twin');
    const a = await createBrandKit({ name }, u);
    const b = await createBrandKit({ name }, u);
    expect(a.slug).not.toBe(b.slug);
  });

  it('rejects an explicit slug already taken', async () => {
    const u = await makeUser();
    const slug = uniqueName('taken');
    await createBrandKit({ name: 'one', slug }, u);
    await expect(createBrandKit({ name: 'two', slug }, u)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('rename / archive / unarchive', () => {
  it('renames a kit', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('rename') }, u);
    const updated = await renameBrandKit(kit.id, 'New Name');
    expect(updated.name).toBe('New Name');
    // slug is stable on rename
    expect(updated.slug).toBe(kit.slug);
  });

  it('archives and unarchives', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('archive') }, u);
    const archived = await archiveBrandKit(kit.id);
    expect(archived.archivedAt).not.toBeNull();
    const live = await unarchiveBrandKit(kit.id);
    expect(live.archivedAt).toBeNull();
  });

  it('hides archived kits from default list', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('hide') }, u);
    await archiveBrandKit(kit.id);
    const list = await listBrandKits();
    expect(list.find((k) => k.id === kit.id)).toBeUndefined();
    const listAll = await listBrandKits({ includeArchived: true });
    expect(listAll.find((k) => k.id === kit.id)).toBeDefined();
  });

  it('throws NotFoundError on missing kit', async () => {
    await expect(getBrandKitById('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('publishBrandKitVersion', () => {
  it('publishes v1 with empty draft', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('pub') }, u);
    const draft = emptyDraft();
    const v = await publishBrandKitVersion({ brandKitId: kit.id, versionLabel: 'v1', ...draft }, u);
    expect(v.versionLabel).toBe('v1');
    expect(v.brandKitId).toBe(kit.id);
    expect(v.publishedById).toBe(u.id);
  });

  it('rejects an invalid token payload', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('bad') }, u);
    await expect(
      publishBrandKitVersion(
        {
          brandKitId: kit.id,
          versionLabel: 'v1',
          tokens: { colors: { primary: 'not-a-color' } },
          voice: {},
        },
        u,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects duplicate version label on same kit', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('dup') }, u);
    const draft = emptyDraft();
    await publishBrandKitVersion({ brandKitId: kit.id, versionLabel: 'v1', ...draft }, u);
    await expect(
      publishBrandKitVersion({ brandKitId: kit.id, versionLabel: 'v1', ...draft }, u),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists versions newest-first', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('list') }, u);
    const draft = emptyDraft();
    await publishBrandKitVersion({ brandKitId: kit.id, versionLabel: 'v1', ...draft }, u);
    await publishBrandKitVersion({ brandKitId: kit.id, versionLabel: 'v2', ...draft }, u);
    const versions = await listBrandKitVersions(kit.id);
    expect(versions.map((v) => v.versionLabel)).toEqual(['v2', 'v1']);
  });

  it('round-trips a version through getBrandKitVersionById', async () => {
    const u = await makeUser();
    const kit = await createBrandKit({ name: uniqueName('round') }, u);
    const draft = emptyDraft();
    const v = await publishBrandKitVersion(
      { brandKitId: kit.id, versionLabel: 'v1', ...draft, summary: 'first cut' },
      u,
    );
    const fetched = await getBrandKitVersionById(v.id);
    expect(fetched.summary).toBe('first cut');
  });
});
