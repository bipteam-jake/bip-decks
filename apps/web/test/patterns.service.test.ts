// Brand-kit pattern service tests. Real Postgres; no S3.
// Mirrors the test isolation pattern from brand-kits.service.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import {
  createBrandKit,
  emptyDraft,
  publishBrandKitVersion,
} from '@/lib/brand-kits/service';
import {
  deletePattern,
  getPatternById,
  instantiatePattern,
  listPatterns,
  savePattern,
  updatePattern,
} from '@/lib/brand-kits/patterns-service';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { BrandKitVersion, User } from '@bip/db';

const TEST_TAG = '+patternvitest@bip.test';
const TEST_SLUG_PREFIX = 'vt-pat-';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}

function uniqueName(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'creator'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `Pattern Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}

async function makeVersion(user: User): Promise<{ version: BrandKitVersion; user: User }> {
  const kit = await createBrandKit({ name: uniqueName('kit') }, user);
  const draft = emptyDraft();
  const version = await publishBrandKitVersion(
    { brandKitId: kit.id, versionLabel: 'v1', ...draft },
    user,
  );
  return { version, user };
}

const SAMPLE_HTML = `<section class="slide" data-slide-id="{{slide-id}}">
  <h1>{{title}}</h1>
  <p>{{subtitle}}</p>
</section>`;

const SAMPLE_PARAMS = [
  { name: 'title', type: 'string', required: true },
  { name: 'subtitle', type: 'string', required: false, default: 'Tagline' },
];

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

describe('savePattern', () => {
  it('saves a pattern with a derived slug', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    const p = await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Cover With Image',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
      },
      u,
    );
    expect(p.slug).toBe('cover-with-image');
    expect(p.category).toBe('general');
    expect(p.approved).toBe(false);
  });

  it('rejects an empty name', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    await expect(
      savePattern(
        {
          brandKitVersionId: version.id,
          name: '   ',
          htmlTemplate: SAMPLE_HTML,
          parameters: SAMPLE_PARAMS,
        },
        u,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed parameters', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    await expect(
      savePattern(
        {
          brandKitVersionId: version.id,
          name: 'Bad',
          htmlTemplate: SAMPLE_HTML,
          parameters: [{ name: 'x', type: 'not-a-type' }],
        },
        u,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects duplicate parameter names', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    await expect(
      savePattern(
        {
          brandKitVersionId: version.id,
          name: 'Dupes',
          htmlTemplate: SAMPLE_HTML,
          parameters: [
            { name: 'title', type: 'string' },
            { name: 'title', type: 'string' },
          ],
        },
        u,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('produces unique slugs on collision', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    const a = await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Twin Pattern',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
      },
      u,
    );
    const b = await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Twin Pattern',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
      },
      u,
    );
    expect(a.slug).not.toBe(b.slug);
  });

  it('rejects explicit slug already taken in same version', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Original',
        slug: 'taken-slug',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
      },
      u,
    );
    await expect(
      savePattern(
        {
          brandKitVersionId: version.id,
          name: 'Other',
          slug: 'taken-slug',
          htmlTemplate: SAMPLE_HTML,
          parameters: SAMPLE_PARAMS,
        },
        u,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError for unknown version', async () => {
    const u = await makeUser();
    await expect(
      savePattern(
        {
          brandKitVersionId: '00000000-0000-0000-0000-000000000000',
          name: 'Orphan',
          htmlTemplate: SAMPLE_HTML,
          parameters: SAMPLE_PARAMS,
        },
        u,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listPatterns / updatePattern / deletePattern', () => {
  it('filters by approvedOnly', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    const draft = await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Draft One',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
      },
      u,
    );
    await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Approved One',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
        approved: true,
      },
      u,
    );
    const all = await listPatterns({ brandKitVersionId: version.id });
    expect(all).toHaveLength(2);
    const approved = await listPatterns({ brandKitVersionId: version.id, approvedOnly: true });
    expect(approved).toHaveLength(1);
    expect(approved[0]!.id).not.toBe(draft.id);
  });

  it('toggles approved and deletes', async () => {
    const u = await makeUser();
    const { version } = await makeVersion(u);
    const p = await savePattern(
      {
        brandKitVersionId: version.id,
        name: 'Toggle',
        htmlTemplate: SAMPLE_HTML,
        parameters: SAMPLE_PARAMS,
      },
      u,
    );
    const updated = await updatePattern(p.id, { approved: true });
    expect(updated.approved).toBe(true);
    await deletePattern(p.id);
    await expect(getPatternById(p.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('instantiatePattern', () => {
  it('substitutes placeholders and uses defaults', () => {
    const result = instantiatePattern({
      pattern: {
        htmlTemplate: SAMPLE_HTML,
        cssTemplate: '.slide[data-slide-id="{{slide-id}}"] h1 { color: red; }',
        parameters: SAMPLE_PARAMS,
      },
      values: { title: 'Hello' },
      slideId: 's1',
    });
    expect(result.html).toContain('data-slide-id="s1"');
    expect(result.html).toContain('<h1>Hello</h1>');
    expect(result.html).toContain('<p>Tagline</p>'); // default applied
    expect(result.css).toContain('data-slide-id="s1"');
  });

  it('throws when a required parameter is missing and has no default', () => {
    expect(() =>
      instantiatePattern({
        pattern: {
          htmlTemplate: SAMPLE_HTML,
          cssTemplate: null,
          parameters: SAMPLE_PARAMS,
        },
        values: {},
      }),
    ).toThrow(ValidationError);
  });
});
