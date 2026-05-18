// POST /api/brand-kits/[id]/versions/[versionId]/identity — upload a logo/favicon.
// GET  /api/brand-kits/[id]/versions/[versionId]/identity — list assets w/ presigned urls.
//
// Multipart form fields: kind, file. Width/height inferred client-side if
// provided as form fields (we don't decode images server-side here).

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { BrandKitIdentityKind } from '@bip/db';
import { listIdentityAssets, uploadIdentityAsset } from '@/lib/brand-kits/assets';
import { presignDownloadUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

const VALID_KINDS = new Set<string>(Object.values(BrandKitIdentityKind));

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { versionId } = await params;
    await requireTeamUser();

    const form = await req.formData().catch(() => null);
    if (!form) throw new ValidationError('Expected multipart form-data');

    const kindRaw = form.get('kind');
    const file = form.get('file');
    if (typeof kindRaw !== 'string' || !VALID_KINDS.has(kindRaw)) {
      throw new ValidationError('Invalid or missing kind');
    }
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError('Missing file');
    }
    const widthRaw = form.get('width');
    const heightRaw = form.get('height');
    const width = typeof widthRaw === 'string' && widthRaw ? Number(widthRaw) : undefined;
    const height = typeof heightRaw === 'string' && heightRaw ? Number(heightRaw) : undefined;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await uploadIdentityAsset({
      brandKitVersionId: versionId,
      kind: kindRaw as BrandKitIdentityKind,
      body: bytes,
      mimeType: file.type || 'application/octet-stream',
      originalFilename: file.name,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
    });
    const url = await presignDownloadUrl(asset.s3Key);
    return NextResponse.json({ asset: { ...asset, url } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { versionId } = await params;
    await requireTeamUser();
    const assets = await listIdentityAssets(versionId);
    const withUrls = await Promise.all(
      assets.map(async (a) => ({ ...a, url: await presignDownloadUrl(a.s3Key) })),
    );
    return NextResponse.json({ assets: withUrls });
  } catch (err) {
    return errorResponse(err);
  }
}
