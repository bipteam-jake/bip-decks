// Brand-kit service layer. CRUD over BrandKit and BrandKitVersion, plus
// publish-a-new-version. Identity assets and references are managed in
// ./assets.ts so this module stays focused on the data spine.
//
// Phase 2.1a: schema + storage + service. Admin UI in 2.1c, bundler in 2.1b.

import type { BrandKit, BrandKitVersion, Prisma, User } from '@bip/db';

import { prisma } from '@/lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  type BrandTokens,
  type BrandVoice,
  emptyTokens,
  emptyVoice,
  parseTokens,
  parseVoice,
} from '@/lib/brand-kits/tokens';

const SLUG_MAX = 60;

function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, SLUG_MAX) || 'brand-kit';
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let i = 2; i <= 1000; i++) {
    const existing = await prisma.brandKit.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    const suffix = `-${i}`;
    candidate = `${base.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
  }
  throw new ConflictError('Could not generate unique brand-kit slug', 'slug_exhausted');
}

// ---------------------------------------------------------------------------
// BrandKit CRUD
// ---------------------------------------------------------------------------

export interface CreateBrandKitInput {
  name: string;
  description?: string;
  /** Optional explicit slug; otherwise derived from name. */
  slug?: string;
}

export interface ListBrandKitsOptions {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export async function createBrandKit(input: CreateBrandKitInput, creator: User): Promise<BrandKit> {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Name is required');

  const slug = input.slug?.trim() ? slugify(input.slug.trim()) : await generateUniqueSlug(name);
  if (input.slug) {
    const taken = await prisma.brandKit.findUnique({ where: { slug }, select: { id: true } });
    if (taken) throw new ConflictError('Slug already in use', 'slug_taken');
  }

  return prisma.brandKit.create({
    data: {
      slug,
      name,
      description: input.description?.trim() || null,
      createdById: creator.id,
    },
  });
}

export async function listBrandKits(opts: ListBrandKitsOptions = {}): Promise<BrandKit[]> {
  const where: Prisma.BrandKitWhereInput = {};
  if (!opts.includeArchived) where.archivedAt = null;
  return prisma.brandKit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  });
}

export async function getBrandKitById(id: string): Promise<BrandKit> {
  const kit = await prisma.brandKit.findUnique({ where: { id } });
  if (!kit) throw new NotFoundError('Brand kit not found', 'brand_kit_not_found');
  return kit;
}

export async function getBrandKitBySlug(slug: string): Promise<BrandKit> {
  const kit = await prisma.brandKit.findUnique({ where: { slug } });
  if (!kit) throw new NotFoundError('Brand kit not found', 'brand_kit_not_found');
  return kit;
}

export async function renameBrandKit(id: string, name: string): Promise<BrandKit> {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError('Name is required');
  await getBrandKitById(id);
  return prisma.brandKit.update({ where: { id }, data: { name: trimmed } });
}

export async function archiveBrandKit(id: string): Promise<BrandKit> {
  const kit = await getBrandKitById(id);
  if (kit.archivedAt) return kit;
  return prisma.brandKit.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function unarchiveBrandKit(id: string): Promise<BrandKit> {
  const kit = await getBrandKitById(id);
  if (!kit.archivedAt) return kit;
  return prisma.brandKit.update({ where: { id }, data: { archivedAt: null } });
}

// ---------------------------------------------------------------------------
// BrandKitVersion publishing
// ---------------------------------------------------------------------------

export interface PublishVersionInput {
  brandKitId: string;
  versionLabel: string;
  /** Validated by Zod via parseTokens before persistence. */
  tokens: unknown;
  voice: unknown;
  summary?: string;
}

/**
 * Validate tokens + voice, then insert a new immutable version. Throws
 * ValidationError on schema mismatch or empty label, ConflictError on
 * duplicate `(brandKitId, versionLabel)`, NotFoundError if the kit is gone.
 */
export async function publishBrandKitVersion(
  input: PublishVersionInput,
  publisher: User,
): Promise<BrandKitVersion> {
  const label = input.versionLabel.trim();
  if (!label) throw new ValidationError('Version label is required');
  if (label.length > 40) throw new ValidationError('Version label too long (max 40)');

  await getBrandKitById(input.brandKitId); // existence check

  let tokens: BrandTokens;
  let voice: BrandVoice;
  try {
    tokens = parseTokens(input.tokens);
  } catch (err) {
    throw new ValidationError('Invalid tokens', err);
  }
  try {
    voice = parseVoice(input.voice);
  } catch (err) {
    throw new ValidationError('Invalid voice', err);
  }

  const existing = await prisma.brandKitVersion.findUnique({
    where: { brandKitId_versionLabel: { brandKitId: input.brandKitId, versionLabel: label } },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      `Version "${label}" already exists for this kit`,
      'version_label_taken',
    );
  }

  return prisma.brandKitVersion.create({
    data: {
      brandKitId: input.brandKitId,
      versionLabel: label,
      tokens: tokens as unknown as Prisma.InputJsonValue,
      voice: voice as unknown as Prisma.InputJsonValue,
      summary: input.summary?.trim() || null,
      publishedById: publisher.id,
    },
  });
}

export async function listBrandKitVersions(brandKitId: string): Promise<BrandKitVersion[]> {
  await getBrandKitById(brandKitId);
  return prisma.brandKitVersion.findMany({
    where: { brandKitId },
    orderBy: { publishedAt: 'desc' },
  });
}

export async function getBrandKitVersionById(id: string): Promise<BrandKitVersion> {
  const version = await prisma.brandKitVersion.findUnique({ where: { id } });
  if (!version)
    throw new NotFoundError('Brand-kit version not found', 'brand_kit_version_not_found');
  return version;
}

/**
 * Convenience: build a stub "draft" view that callers can use to seed an
 * editor before publishing the first version. Not persisted.
 */
export function emptyDraft(): { tokens: BrandTokens; voice: BrandVoice } {
  return { tokens: emptyTokens(), voice: emptyVoice() };
}
