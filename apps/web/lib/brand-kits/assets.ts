// Identity asset + reference material attachment helpers for brand-kit
// versions. Storage is S3 (MinIO locally); only metadata is in Postgres.
//
// Versions are immutable once published, but assets/references can be
// added/removed during the "draft" period after a version is created and
// before downstream decks pin to it. We don't enforce immutability at the DB
// layer — the admin UI is the gatekeeper.

import type { BrandKitIdentityAsset, BrandKitReference, Prisma } from '@bip/db';
import { BrandKitIdentityKind, BrandKitReferenceKind } from '@bip/db';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { deleteObject, putObject } from '@/lib/storage/s3';

const ASSET_PREFIX = 'brand-kits';
const MAX_IDENTITY_BYTES = 4 * 1024 * 1024; // 4 MB per logo
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024; // 50 MB per PDF

function identityKey(versionId: string, kind: BrandKitIdentityKind, ext: string): string {
  return `${ASSET_PREFIX}/${versionId}/identity/${kind.toLowerCase()}-${randomUUID()}.${ext}`;
}

function referenceKey(versionId: string, kind: BrandKitReferenceKind, ext: string): string {
  return `${ASSET_PREFIX}/${versionId}/references/${kind.toLowerCase()}-${randomUUID()}.${ext}`;
}

function extFromMime(mime: string): string {
  // Minimal mapping; the UI is responsible for rejecting types up-front.
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'application/pdf': 'pdf',
  };
  return m[mime] ?? 'bin';
}

async function ensureVersion(versionId: string): Promise<void> {
  const v = await prisma.brandKitVersion.findUnique({
    where: { id: versionId },
    select: { id: true },
  });
  if (!v) throw new NotFoundError('Brand-kit version not found', 'brand_kit_version_not_found');
}

// ---------------------------------------------------------------------------
// Identity assets
// ---------------------------------------------------------------------------

export interface UploadIdentityAssetInput {
  brandKitVersionId: string;
  kind: BrandKitIdentityKind;
  body: Uint8Array | Buffer;
  mimeType: string;
  originalFilename: string;
  width?: number;
  height?: number;
}

export async function uploadIdentityAsset(
  input: UploadIdentityAssetInput,
): Promise<BrandKitIdentityAsset> {
  if (input.body.byteLength > MAX_IDENTITY_BYTES) {
    throw new ValidationError(
      `Identity asset too large: ${input.body.byteLength} bytes (max ${MAX_IDENTITY_BYTES})`,
    );
  }
  await ensureVersion(input.brandKitVersionId);

  const key = identityKey(input.brandKitVersionId, input.kind, extFromMime(input.mimeType));
  await putObject({ key, body: input.body, contentType: input.mimeType });

  return prisma.brandKitIdentityAsset.create({
    data: {
      brandKitVersionId: input.brandKitVersionId,
      kind: input.kind,
      s3Key: key,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      originalFilename: input.originalFilename,
      width: input.width ?? null,
      height: input.height ?? null,
    } satisfies Prisma.BrandKitIdentityAssetUncheckedCreateInput,
  });
}

export async function listIdentityAssets(versionId: string): Promise<BrandKitIdentityAsset[]> {
  await ensureVersion(versionId);
  return prisma.brandKitIdentityAsset.findMany({
    where: { brandKitVersionId: versionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteIdentityAsset(id: string): Promise<void> {
  const asset = await prisma.brandKitIdentityAsset.findUnique({ where: { id } });
  if (!asset) throw new NotFoundError('Identity asset not found', 'identity_asset_not_found');
  await deleteObject(asset.s3Key);
  await prisma.brandKitIdentityAsset.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export interface UploadReferenceInput {
  brandKitVersionId: string;
  kind: BrandKitReferenceKind;
  body: Uint8Array | Buffer;
  mimeType: string;
  originalFilename: string;
  pageCount?: number;
}

export async function uploadReference(input: UploadReferenceInput): Promise<BrandKitReference> {
  if (input.body.byteLength > MAX_REFERENCE_BYTES) {
    throw new ValidationError(
      `Reference too large: ${input.body.byteLength} bytes (max ${MAX_REFERENCE_BYTES})`,
    );
  }
  await ensureVersion(input.brandKitVersionId);

  const key = referenceKey(input.brandKitVersionId, input.kind, extFromMime(input.mimeType));
  await putObject({ key, body: input.body, contentType: input.mimeType });

  return prisma.brandKitReference.create({
    data: {
      brandKitVersionId: input.brandKitVersionId,
      kind: input.kind,
      s3Key: key,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      originalFilename: input.originalFilename,
      pageCount: input.pageCount ?? null,
    } satisfies Prisma.BrandKitReferenceUncheckedCreateInput,
  });
}

export async function listReferences(versionId: string): Promise<BrandKitReference[]> {
  await ensureVersion(versionId);
  return prisma.brandKitReference.findMany({
    where: { brandKitVersionId: versionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteReference(id: string): Promise<void> {
  const ref = await prisma.brandKitReference.findUnique({ where: { id } });
  if (!ref) throw new NotFoundError('Reference not found', 'reference_not_found');
  await deleteObject(ref.s3Key);
  await prisma.brandKitReference.delete({ where: { id } });
}
