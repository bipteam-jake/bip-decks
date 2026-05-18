// POST /api/share-links/claim
//
// Visitor lands on /d/{slug}?st={token}; the claim page collects a display
// name and POSTs here. We create (or reuse) a ShareLinkRecipient and set
// the per-deck recipient cookie so subsequent requests resolve to that
// identity without the token.
//
// Body: { token, displayName, clientId?, email? }
// Returns: { redirectTo: string } — the deck URL without `?st`.

import { NextResponse, type NextRequest } from 'next/server';

import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { claimShareLink } from '@/lib/share-links/service';
import { setRecipientCookie } from '@/lib/share-links/cookies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Invalid request body');
    }
    const { recipient, deck } = await claimShareLink(body);
    setRecipientCookie({ deckId: deck.id, recipientId: recipient.id });
    return NextResponse.json({
      redirectTo: `/d/${encodeURIComponent(deck.slug)}`,
      recipient: {
        id: recipient.id,
        displayName: recipient.displayName,
        clientId: recipient.clientId,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
