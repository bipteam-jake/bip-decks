// GET  /api/decks/[id]/share-links  — list share links for a deck (team only)
// POST /api/decks/[id]/share-links  — issue a new REVIEWER link
//                                      body: { recipientEmail, message?,
//                                              expiresAt?: ISO|null,
//                                              downloadsDisabled? }
//
// Phase 1 emits one audience type (REVIEWER) with LIVE binding only —
// snapshot links are Phase 3 per docs/bip-deck-platform-architecture.md §8.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { issueShareLink, listShareLinksForDeck } from '@/lib/share-links/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    await requireTeamUser();
    const links = await listShareLinksForDeck(params.id);
    return NextResponse.json({ shareLinks: links });
  } catch (err) {
    return errorResponse(err);
  }
}

const issueSchema = z.object({
  recipientEmail: z.string().email(),
  message: z.string().max(2000).optional(),
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  downloadsDisabled: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    const parsed = issueSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten());
    const expiresAt =
      parsed.data.expiresAt === undefined
        ? undefined
        : parsed.data.expiresAt === null
          ? null
          : new Date(parsed.data.expiresAt);
    const result = await issueShareLink({
      deckId: params.id,
      recipientEmail: parsed.data.recipientEmail,
      message: parsed.data.message,
      expiresAt,
      downloadsDisabled: parsed.data.downloadsDisabled,
      createdBy: user,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
