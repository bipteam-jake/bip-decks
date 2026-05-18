// POST /api/ai/jobs/[id]/accept — fast-forward main onto the working
// branch and update the deck head, per ai-editor.md §7.

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import { acceptProposal } from '@/lib/ai/proposal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await requireTeamUser();
    const result = await acceptProposal({ jobId: id, user });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
