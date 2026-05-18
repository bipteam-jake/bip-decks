// POST /api/ai/jobs/[id]/reject — discard the working branch, per
// ai-editor.md §7. Idempotent: rejecting an already-resolved job returns
// the existing row.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { rejectProposal } from '@/lib/ai/proposal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireTeamUser();
    const job = await rejectProposal({ jobId: id });
    return NextResponse.json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
