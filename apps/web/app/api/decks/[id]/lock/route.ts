// Edit-lock endpoints for the deck editor, per ai-editor.md §9.
//
// Routes:
//   GET    -> current lock state for this user (read-only)
//   POST   -> heartbeat (acquire or refresh). 409 deck_locked if another
//             user holds a fresh lock; UI shows take-over affordance.
//   PUT    -> take over (force-acquire).
//   DELETE -> release (no-op if not the owner).

import { NextResponse, type NextRequest } from 'next/server';

import { requireTeamUser } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/api/responses';
import {
  acquireOrRefreshLock,
  getLockState,
  releaseLock,
  takeOverLock,
} from '@/lib/ai/lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    const state = await getLockState(params.id, user.id);
    return NextResponse.json({ lock: state });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    await acquireOrRefreshLock(params.id, user.id);
    const state = await getLockState(params.id, user.id);
    return NextResponse.json({ lock: state });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    await takeOverLock(params.id, user.id);
    const state = await getLockState(params.id, user.id);
    return NextResponse.json({ lock: state });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const user = await requireTeamUser();
    await releaseLock(params.id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
