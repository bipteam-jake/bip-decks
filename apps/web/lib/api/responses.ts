// Maps thrown AppErrors (and unknown errors) to NextResponse JSON.
import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(err.toJSON(), { status: err.status });
  }
  // Unknown — log and return a generic 500. Avoid leaking internals.
  // eslint-disable-next-line no-console
  console.error('Unhandled error in API route:', err);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Internal server error' } },
    { status: 500 },
  );
}
