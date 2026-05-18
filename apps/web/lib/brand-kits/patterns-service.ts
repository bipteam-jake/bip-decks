// Brand-kit pattern service. Patterns are reusable on-brand slide layouts
// scoped to a single BrandKitVersion. See:
//   - docs/bip-deck-platform-architecture.md §10 (brand kits + patterns)
//   - docs/bip-deck-platform-phasing.md (Phase 2.2)
//
// What this module owns:
//   - CRUD for BrandKitPattern (save, list, get, update metadata, approve,
//     delete).
//   - Slug uniqueness per (brandKitVersionId, slug).
//   - Parameter-schema validation via Zod.
//   - Template instantiation: substitute `{{name}}` placeholders with caller
//     values and return ready-to-write slide HTML/CSS.
//
// Out of scope for Phase 2.2:
//   - Thumbnails (Playwright in Phase 3+; thumbnailS3Key stays nullable).
//   - Versioning beyond the BrandKitVersion scope. To "edit" a published
//     pattern, save it again on a new kit version (or delete + re-create
//     in the same draft version).

import type { BrandKitPattern, Prisma, User } from '@bip/db';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { getBrandKitVersionById } from '@/lib/brand-kits/service';

const SLUG_MAX = 60;

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------

/** Parameter type catalog. Keep small; expand only with a real need. */
export const PATTERN_PARAM_TYPES = ['string', 'number', 'boolean', 'color', 'image-url'] as const;
export type PatternParamType = (typeof PATTERN_PARAM_TYPES)[number];

export const PatternParameterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_-]*$/,
      'Parameter name must start with a letter and contain only letters, digits, underscores, or hyphens',
    ),
  type: z.enum(PATTERN_PARAM_TYPES),
  label: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export type PatternParameter = z.infer<typeof PatternParameterSchema>;

export const PatternParametersSchema = z.array(PatternParameterSchema).max(40);

/** Validate raw JSON (from API or DB) into a typed parameter list. */
export function parsePatternParameters(raw: unknown): PatternParameter[] {
  return PatternParametersSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, SLUG_MAX) || 'pattern';
}

async function generateUniqueSlug(name: string, brandKitVersionId: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  for (let i = 2; i <= 1000; i++) {
    const existing = await prisma.brandKitPattern.findUnique({
      where: { brandKitVersionId_slug: { brandKitVersionId, slug: candidate } },
      select: { id: true },
    });
    if (!existing) return candidate;
    const suffix = `-${i}`;
    candidate = `${base.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
  }
  throw new ConflictError('Could not generate unique pattern slug', 'pattern_slug_exhausted');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface SavePatternInput {
  brandKitVersionId: string;
  name: string;
  description?: string;
  /** Optional explicit slug; otherwise derived from name. */
  slug?: string;
  category?: string;
  tags?: string[];
  htmlTemplate: string;
  cssTemplate?: string;
  parameters: unknown; // validated by Zod
  approved?: boolean;
}

export interface ListPatternsOptions {
  brandKitVersionId: string;
  approvedOnly?: boolean;
  category?: string;
  limit?: number;
  offset?: number;
}

export async function savePattern(
  input: SavePatternInput,
  creator: User,
): Promise<BrandKitPattern> {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Name is required');
  if (name.length > 120) throw new ValidationError('Name too long (max 120)');

  const html = input.htmlTemplate.trim();
  if (html.length < 10) throw new ValidationError('htmlTemplate is too short to be meaningful');
  if (html.length > 64_000) throw new ValidationError('htmlTemplate too large (max 64KB)');
  const css = input.cssTemplate?.trim() || null;
  if (css && css.length > 64_000) {
    throw new ValidationError('cssTemplate too large (max 64KB)');
  }

  let parameters: PatternParameter[];
  try {
    parameters = parsePatternParameters(input.parameters);
  } catch (err) {
    throw new ValidationError('Invalid parameters', err);
  }
  // Reject duplicate parameter names early — Zod array doesn't enforce this.
  const dupe = findDuplicate(parameters.map((p) => p.name));
  if (dupe) throw new ValidationError(`Duplicate parameter name: ${dupe}`);

  // Confirm parent version exists; surfaces NotFoundError naturally.
  await getBrandKitVersionById(input.brandKitVersionId);

  const slug = input.slug?.trim()
    ? slugify(input.slug.trim())
    : await generateUniqueSlug(name, input.brandKitVersionId);
  if (input.slug) {
    const taken = await prisma.brandKitPattern.findUnique({
      where: { brandKitVersionId_slug: { brandKitVersionId: input.brandKitVersionId, slug } },
      select: { id: true },
    });
    if (taken) throw new ConflictError('Slug already in use for this version', 'pattern_slug_taken');
  }

  return prisma.brandKitPattern.create({
    data: {
      brandKitVersionId: input.brandKitVersionId,
      slug,
      name,
      description: input.description?.trim() || null,
      category: (input.category?.trim() || 'general').toLowerCase().slice(0, 60),
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20),
      htmlTemplate: html,
      cssTemplate: css,
      parameters: parameters as unknown as Prisma.InputJsonValue,
      approved: input.approved ?? false,
      createdById: creator.id,
    },
  });
}

export async function listPatterns(opts: ListPatternsOptions): Promise<BrandKitPattern[]> {
  await getBrandKitVersionById(opts.brandKitVersionId);
  const where: Prisma.BrandKitPatternWhereInput = {
    brandKitVersionId: opts.brandKitVersionId,
  };
  if (opts.approvedOnly) where.approved = true;
  if (opts.category) where.category = opts.category.toLowerCase();
  return prisma.brandKitPattern.findMany({
    where,
    orderBy: [{ approved: 'desc' }, { createdAt: 'desc' }],
    take: opts.limit ?? 100,
    skip: opts.offset ?? 0,
  });
}

export async function getPatternById(id: string): Promise<BrandKitPattern> {
  const pattern = await prisma.brandKitPattern.findUnique({ where: { id } });
  if (!pattern) throw new NotFoundError('Pattern not found', 'pattern_not_found');
  return pattern;
}

export interface UpdatePatternInput {
  name?: string;
  description?: string | null;
  category?: string;
  tags?: string[];
  approved?: boolean;
}

/**
 * Update mutable metadata only. To change html/css/parameters, delete the
 * pattern and save a new one (patterns are intentionally immutable so the
 * AI's pattern context stays stable for the lifetime of a kit version).
 */
export async function updatePattern(
  id: string,
  input: UpdatePatternInput,
): Promise<BrandKitPattern> {
  await getPatternById(id);
  const data: Prisma.BrandKitPatternUpdateInput = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new ValidationError('Name cannot be empty');
    if (trimmed.length > 120) throw new ValidationError('Name too long (max 120)');
    data.name = trimmed;
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.category !== undefined) {
    data.category = (input.category.trim() || 'general').toLowerCase().slice(0, 60);
  }
  if (input.tags !== undefined) {
    data.tags = input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20);
  }
  if (input.approved !== undefined) data.approved = input.approved;
  return prisma.brandKitPattern.update({ where: { id }, data });
}

export async function deletePattern(id: string): Promise<void> {
  await getPatternById(id);
  await prisma.brandKitPattern.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

export interface InstantiatePatternInput {
  pattern: Pick<BrandKitPattern, 'htmlTemplate' | 'cssTemplate' | 'parameters'>;
  /** Caller-supplied values keyed by parameter name. */
  values: Record<string, string | number | boolean>;
  /** Slide id substituted for `{{slide-id}}` / `{{slideId}}` if present. */
  slideId?: string;
}

export interface InstantiatedPattern {
  html: string;
  css: string | null;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;

/**
 * Substitute `{{name}}` placeholders in the pattern's html/css using
 * `values`. Falls back to parameter defaults; throws ValidationError on a
 * missing required parameter. Unknown placeholders are passed through (so
 * patterns can use `{{slide-id}}` even though it isn't a declared param).
 */
export function instantiatePattern(input: InstantiatePatternInput): InstantiatedPattern {
  let parameters: PatternParameter[];
  try {
    parameters = parsePatternParameters(input.pattern.parameters);
  } catch (err) {
    throw new ValidationError('Pattern has invalid stored parameters', err);
  }
  const paramsByName = new Map(parameters.map((p) => [p.name, p]));

  // Pre-flight: every required parameter has either a value or a default.
  for (const p of parameters) {
    if (!p.required) continue;
    if (input.values[p.name] !== undefined) continue;
    if (p.default !== undefined) continue;
    throw new ValidationError(`Missing required parameter "${p.name}"`);
  }

  const resolve = (key: string): string => {
    // Special-case slide id placeholders.
    if ((key === 'slide-id' || key === 'slideId') && input.slideId) return input.slideId;
    const provided = input.values[key];
    if (provided !== undefined) return String(provided);
    const param = paramsByName.get(key);
    if (param?.default !== undefined) return String(param.default);
    // Unknown placeholders: emit empty string so we don't leak `{{...}}`
    // into rendered slides. Authors can opt out by escaping their HTML.
    return '';
  };

  const html = input.pattern.htmlTemplate.replace(PLACEHOLDER_RE, (_, key: string) =>
    resolve(key),
  );
  const css =
    input.pattern.cssTemplate?.replace(PLACEHOLDER_RE, (_, key: string) => resolve(key)) ?? null;

  return { html, css };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return null;
}
