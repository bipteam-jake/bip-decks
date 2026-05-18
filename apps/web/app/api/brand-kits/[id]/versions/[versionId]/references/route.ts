// POST /api/brand-kits/[id]/versions/[versionId]/references — upload PDF/image.
// GET  /api/brand-kits/[id]/versions/[versionId]/references — list w/ presigned urls.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { BrandKitReferenceKind } from '@bip/db';
import { listReferences, uploadReference } from '@/lib/brand-kits/assets';
import { presignDownloadUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

const VALID_KINDS = new Set<string>(Object.values(BrandKitReferenceKind));

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
    const pageRaw = form.get('pageCount');
    const pageCount = typeof pageRaw === 'string' && pageRaw ? Number(pageRaw) : undefined;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ref = await uploadReference({
      brandKitVersionId: versionId,
      kind: kindRaw as BrandKitReferenceKind,
      body: bytes,
      mimeType: file.type || 'application/octet-stream',
      originalFilename: file.name,
      pageCount: Number.isFinite(pageCount) ? pageCount : undefined,
    });
    const url = await presignDownloadUrl(ref.s3Key);
    return NextResponse.json({ reference: { ...ref, url } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const { versionId } = await params;
    await requireTeamUser();
    const refs = await listReferences(versionId);
    const withUrls = await Promise.all(
      refs.map(async (r) => ({ ...r, url: await presignDownloadUrl(r.s3Key) })),
    );
    return NextResponse.json({ references: withUrls });
  } catch (err) {
    return errorResponse(err);
  }
}
