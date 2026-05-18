// S3-compatible object storage wrapper. MinIO locally, R2 / BIP S3 in prod.
//
// All call sites go through this module — never instantiate the SDK directly.
// Phase 2.1 introduced this for brand-kit assets and references; Phase 2.2
// will use it for pattern thumbnails as well.

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

let cachedClient: S3Client | null = null;

function s3(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: optional('S3_REGION', 'us-east-1'),
    endpoint: optional('S3_ENDPOINT', 'http://localhost:9000'),
    // MinIO and most non-AWS S3 endpoints want path-style addressing.
    forcePathStyle: true,
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY'),
      secretAccessKey: required('S3_SECRET_KEY'),
    },
  });
  return cachedClient;
}

function bucket(): string {
  return optional('S3_BUCKET', 'bip-deck-assets');
}

export interface PutObjectInput {
  /** Full key including any prefix, e.g. `brand-kits/v123/logo-full-color.png`. */
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}

export async function putObject(input: PutObjectInput): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'NotFound'
    ) {
      return false;
    }
    throw err;
  }
}

/**
 * Stream the object body as a Uint8Array. Caller is responsible for
 * memory — only use for small objects (logos, thumbnails, PDFs in chunks).
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = res.Body;
  if (!body) throw new Error(`S3 object has no body: ${key}`);
  // SDK v3 returns a stream that exposes transformToByteArray() in Node.
  const transform = (body as unknown as { transformToByteArray?: () => Promise<Uint8Array> })
    .transformToByteArray;
  if (typeof transform !== 'function') {
    throw new Error('S3 GetObject body does not support transformToByteArray');
  }
  return transform.call(body);
}

/**
 * Time-limited presigned URL for downloading. Defaults to 1 hour. Used for
 * showing identity assets and reference PDFs in the admin UI.
 */
export async function presignDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

/** Visible-to-tests escape hatch — drop the cached client (e.g. after env change). */
export function _resetS3ClientForTesting(): void {
  cachedClient = null;
}
