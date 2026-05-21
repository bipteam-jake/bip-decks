// POST /api/brand-kits/extract — multipart PDF upload, SSE stream out.
//
// Accepts `multipart/form-data` with one `file` field (a PDF). Streams
// `ExtractBrandKitProgress` events from the ai-gateway as Server-Sent
// Events. The wizard at /brand-kits/new-from-pdf consumes the stream and,
// on the final `done` event, advances to the review step where the user can
// edit before creating the kit + publishing v1.
//
// The route does NOT mutate the database. Persistence happens in the
// separate create-kit + publish-version flow once the user accepts the
// extraction.

import { type NextRequest } from 'next/server';

import { extractBrandKitFromPdf, type ExtractBrandKitProgress } from '@bip/ai-gateway';
import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PDF_BYTES = 32 * 1024 * 1024; // Anthropic's per-request limit.

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await requireTeamUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('`file` is required');
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      throw new ValidationError('File must be a PDF');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new ValidationError(
        `PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const requestId = req.headers.get('x-request-id') ?? undefined;
    // TODO Chunk 3: route this through `callModel('BRAND_KIT_EXTRACT', ...)`
    // once the gateway has a multimodal/PDF surface. Today the generator
    // calls the Anthropic SDK directly because callModel is text-only.
    // See docs/bip-deck-platform-ai-editor.md §brand-kit extraction.
    const iterator = extractBrandKitFromPdf(
      { pdf: bytes, filename: file.name },
      { requestId },
    );
    return streamSse(iterator);
  } catch (err) {
    return errorResponse(err);
  }
}

function streamSse(iterator: AsyncGenerator<ExtractBrandKitProgress>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // SSE comment to flush headers quickly through any intermediate buffers.
      controller.enqueue(encoder.encode(': stream-open\n\n'));
      try {
        for await (const event of iterator) {
          controller.enqueue(
            encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ kind: 'error', message: (err as Error).message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

// Stop Next.js from caching errorResponse JSON shape for future-proofing.
export const fetchCache = 'force-no-store';
