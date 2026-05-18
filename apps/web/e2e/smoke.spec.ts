// Phase 1 smoke test — covers the primary flows from
// docs/bip-deck-platform-phasing.md §2 (Definition of done):
//   1. Team member logs in
//   2. Creates a deck
//   3. Chats with the AI editor and accepts a proposal
//   4. Issues a share link
//   5. Reviewer claims the link and leaves a comment
//   6. Team member sees the comment
//
// One end-to-end test walks the whole chain. The AI call is mocked via the
// ai-gateway's ANTHROPIC_API_KEY=mock branch so the proposal/accept loop is
// deterministic and token-free. See playwright.config.ts.
import { test, expect } from '@playwright/test';

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './global-setup';

test('Phase 1 primary flows: author, share, comment, observe', async ({ browser }) => {
  const teamCtx = await browser.newContext();
  const team = await teamCtx.newPage();

  // ── 1. Login ──────────────────────────────────────────────────────────────
  await team.goto('/login');
  await team.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await team.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([
    team.waitForURL((url) => !url.pathname.startsWith('/login')),
    team.getByRole('button', { name: /sign in/i }).click(),
  ]);

  // ── 2. Create deck ────────────────────────────────────────────────────────
  await team.goto('/decks');
  const title = `Smoke ${Date.now()}`;
  await team.getByPlaceholder('Deck title').fill(title);
  await team.getByRole('button', { name: 'Create deck' }).click();
  await team.waitForURL(/\/decks\/[0-9a-f-]{36}$/);
  const deckId = team.url().split('/').pop()!;

  // ── 3. AI editor: chat + accept proposal ──────────────────────────────────
  const composer = team.getByPlaceholder(/Ask Claude to change a slide/i);
  await expect(composer).toBeEnabled();
  await composer.fill('Add a hello title to slide 1');
  await team.getByRole('button', { name: 'Send' }).click();
  // The proposal is returned synchronously (Phase 1 has no job queue).
  const acceptBtn = team.getByRole('button', { name: 'Accept' });
  await expect(acceptBtn).toBeVisible({ timeout: 20_000 });
  await acceptBtn.click();
  await expect(team.getByText(/Accepted/i).first()).toBeVisible({ timeout: 15_000 });

  // ── 4. Issue share link ───────────────────────────────────────────────────
  // The admin share-link UI is out of scope for this smoke; drive the API
  // directly inside the authenticated context so cookies travel along.
  const shareRes = await teamCtx.request.post(`/api/decks/${deckId}/share-links`, {
    data: { recipientEmail: 'reviewer@bip.test' },
  });
  expect(shareRes.ok()).toBeTruthy();
  const shareBody = (await shareRes.json()) as { url: string };
  // Strip origin so we hit the same web-server Playwright is driving.
  const sharePath = new URL(shareBody.url).pathname + new URL(shareBody.url).search;

  // ── 5. Reviewer claims + comments (fresh context, no team cookies) ────────
  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  await reviewer.goto(sharePath);
  await reviewer.waitForURL(/\/claim/);
  await reviewer.locator('input[type="text"]').fill('Test Reviewer');
  await Promise.all([
    reviewer.waitForURL(/\/d\//),
    reviewer.getByRole('button', { name: /open deck/i }).click(),
  ]);

  // The deck runtime renders an empty comments overlay until the toggle is
  // opened. Click "Comments", then post into the textarea.
  await reviewer.getByRole('button', { name: 'Comments' }).first().click();
  const composerInput = reviewer.getByPlaceholder('Add a comment…');
  await expect(composerInput).toBeVisible();
  await composerInput.fill('Looks great from the reviewer!');
  await reviewer.getByRole('button', { name: 'Post' }).click();

  // ── 6. Team member sees the comment ───────────────────────────────────────
  // Poll the team's comments API until the reviewer's post lands. The list
  // endpoint returns a tree of { comment, replies, votes } nodes per
  // lib/comments/service.ts; we only need the top-level row.
  await expect
    .poll(
      async () => {
        const res = await teamCtx.request.get(`/api/decks/${deckId}/comments?slideId=s1`);
        if (!res.ok()) return [];
        const body = (await res.json()) as {
          comments: Array<{ comment: { body: string; authorDisplayName: string | null } }>;
        };
        return body.comments.map((n) => ({
          body: n.comment.body,
          authorDisplayName: n.comment.authorDisplayName,
        }));
      },
      { timeout: 15_000, intervals: [500, 1000, 1500] },
    )
    .toEqual(
      expect.arrayContaining([
        { body: 'Looks great from the reviewer!', authorDisplayName: 'Test Reviewer' },
      ]),
    );
});
