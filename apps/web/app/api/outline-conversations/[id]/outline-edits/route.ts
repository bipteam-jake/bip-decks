// POST /api/outline-conversations/[id]/outline-edits — user-authored
// outline revision (the "toggle edit" affordance on the outline preview
// pane). Body: { outline: OutlineDraft }. Phase 2.5 augment; see
// apps/web/lib/outline/service.ts `editOutline`.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { ValidationError } from '@/lib/errors';
import { editOutline } from '@/lib/outline/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slideSchema = z.object({
  // Server reassigns sN ids, but allow any string for client convenience.
  id: z.string().optional(),
  title: z.string(),
  notes: z.string(),
  layoutHint: z.string().nullish(),
  dataPoints: z.array(z.string()).optional(),
});

const bodySchema = z.object({
  outline: z.object({
    slides: z.array(slideSchema).min(1).max(50),
  }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();
    const raw = await req.json().catch(() => undefined);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Invalid outline payload', parsed.error.flatten());
    }
    // The schema's slide.id is optional; coerce to the OutlineSlide shape
    // (sanitizeOutline will overwrite ids regardless).
    const slides = parsed.data.outline.slides.map((s, i) => ({
      id: s.id ?? `s${i + 1}`,
      title: s.title,
      notes: s.notes,
      layoutHint: s.layoutHint ?? null,
      dataPoints: s.dataPoints,
    }));
    const result = await editOutline({
      conversationId: id,
      user,
      outline: { slides },
    });
    return NextResponse.json(
      { conversation: result.conversation, messages: result.messages },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
