// Phase 2 smoke tests — one happy-path per shipped Phase 2 feature.
//
// Phase 2 DoD (docs/bip-deck-platform-phasing.md §3): "All new features have
// Playwright coverage." The Phase 1 spec already exercises auth, deck CRUD,
// AI editor, share-links and slide-level comments. This file adds:
//
//   1. Brand kits     (§3 item 4) — create kit + publish a v1 version
//   2. Pattern library (§3 item 5) — save a parametrized pattern in a version
//   3. Element-anchored comments (§3 item 1) — pin coords round-trip
//   4. @mentions + inbox (§3 item 2) — mention self, inbox surfaces it
//   5. Outline-first    (§3 item 3) — brief → outline → approve → DRAFT deck
//
// Each test is API-driven through an authenticated browser context, mirroring
// the Phase 1 share-link pattern, to stay resilient to UI churn. We only drive
// the UI to log in (the login form is the most stable user-facing surface).
//
// AI gateway runs in mock mode (ANTHROPIC_API_KEY=mock, see playwright.config.ts).
// The outline mock returns a deterministic 5-slide draft so the approve step
// has a real outline to scaffold.

import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './global-setup';

async function loginAsAdmin(ctx: BrowserContext): Promise<APIRequestContext> {
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
  await page.close();
  return ctx.request;
}

async function createDeck(api: APIRequestContext, title: string): Promise<string> {
  const res = await api.post('/api/decks', { data: { title } });
  expect(res.status(), `create deck: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { deck: { id: string } };
  return body.deck.id;
}

test.describe('Phase 2 smoke', () => {
  test('brand kits: create kit and publish a v1 version', async ({ browser }) => {
    const ctx = await browser.newContext();
    const api = await loginAsAdmin(ctx);

    const kitName = `Smoke Kit ${Date.now()}`;
    const createRes = await api.post('/api/brand-kits', { data: { name: kitName } });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const { kit } = (await createRes.json()) as { kit: { id: string; name: string } };
    expect(kit.name).toBe(kitName);

    const publishRes = await api.post(`/api/brand-kits/${kit.id}/versions`, {
      data: {
        versionLabel: 'v1',
        tokens: {
          colors: { primary: '#0033aa', accent: '#ff6600' },
          type: {
            fontFamilies: { display: 'Barlow', body: 'Inter' },
            scale: { md: '1rem', lg: '1.5rem' },
          },
          spacing: { sm: '4px', md: '8px' },
          radius: { md: '6px' },
          motion: { fast: '120ms' },
        },
        voice: { tone: 'Confident', terminology: '', dos: '', donts: '' },
        summary: 'initial publish',
      },
    });
    expect(publishRes.status(), await publishRes.text()).toBe(201);
    const { version } = (await publishRes.json()) as {
      version: { id: string; versionLabel: string };
    };
    expect(version.versionLabel).toBe('v1');

    const listRes = await api.get('/api/brand-kits');
    expect(listRes.ok()).toBeTruthy();
    const listBody = (await listRes.json()) as { kits: Array<{ id: string }> };
    expect(listBody.kits.map((k) => k.id)).toContain(kit.id);

    await ctx.close();
  });

  test('pattern library: save a parametrized pattern in a brand-kit version', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const api = await loginAsAdmin(ctx);

    const kit = (
      await (
        await api.post('/api/brand-kits', { data: { name: `Pattern Kit ${Date.now()}` } })
      ).json()
    ).kit as { id: string };
    const version = (
      await (
        await api.post(`/api/brand-kits/${kit.id}/versions`, {
          data: {
            versionLabel: 'v1',
            tokens: {
              colors: { primary: '#000000' },
              type: { fontFamilies: { display: 'Barlow' }, scale: { md: '1rem' } },
              spacing: {},
              radius: {},
              motion: {},
            },
            voice: { tone: '', terminology: '', dos: '', donts: '' },
          },
        })
      ).json()
    ).version as { id: string };

    const saveRes = await api.post(
      `/api/brand-kits/${kit.id}/versions/${version.id}/patterns`,
      {
        data: {
          name: 'Hero Cover',
          category: 'cover',
          htmlTemplate: '<section class="hero"><h1>{{ title }}</h1></section>',
          cssTemplate: '.hero { background: var(--brand-color-primary); }',
          parameters: [
            { name: 'title', type: 'string', label: 'Title', required: true },
          ],
          approved: true,
        },
      },
    );
    expect(saveRes.status(), await saveRes.text()).toBe(201);
    const { pattern } = (await saveRes.json()) as {
      pattern: { id: string; name: string; approved: boolean };
    };
    expect(pattern.name).toBe('Hero Cover');

    const listRes = await api.get(
      `/api/brand-kits/${kit.id}/versions/${version.id}/patterns?approvedOnly=1`,
    );
    expect(listRes.ok()).toBeTruthy();
    const listBody = (await listRes.json()) as { patterns: Array<{ id: string }> };
    expect(listBody.patterns.map((p) => p.id)).toContain(pattern.id);

    await ctx.close();
  });

  test('element-anchored comment: pin coords round-trip', async ({ browser }) => {
    const ctx = await browser.newContext();
    const api = await loginAsAdmin(ctx);
    const deckId = await createDeck(api, `Pin Deck ${Date.now()}`);

    const postRes = await api.post(`/api/decks/${deckId}/comments`, {
      data: {
        slideId: 's1',
        body: 'Pin this title please',
        elementAnchor: {
          x: 0.42,
          y: 0.18,
          selector: 'h1.hero',
          elementText: 'Welcome to the deck',
        },
      },
    });
    expect(postRes.status(), await postRes.text()).toBe(201);

    const listRes = await api.get(`/api/decks/${deckId}/comments?slideId=s1`);
    expect(listRes.ok()).toBeTruthy();
    const body = (await listRes.json()) as {
      comments: Array<{
        comment: {
          body: string;
          elementAnchor: { x: number; y: number; selector?: string } | null;
        };
      }>;
    };
    const pinned = body.comments.find((n) => n.comment.body === 'Pin this title please');
    expect(pinned, 'pinned comment present in list').toBeTruthy();
    expect(pinned!.comment.elementAnchor).toMatchObject({
      x: 0.42,
      y: 0.18,
      selector: 'h1.hero',
    });

    await ctx.close();
  });

  test('@mentions + inbox: mentioning a teammate surfaces an inbox entry', async ({
    browser,
  }) => {
    // Author needs to be different from the mentioned user — self-mentions
    // are explicitly excluded from the inbox sync (see
    // lib/comments/mentions-service.ts `syncCommentMentions`).
    const authorCtx = await browser.newContext();
    const authorApi = await loginAsAdmin(authorCtx);

    const teammateEmail = `mentionee-${Date.now()}@bip.test`;
    const teammatePassword = 'change-me-immediately';
    const signupRes = await authorApi.post('/api/auth/signup', {
      data: { email: teammateEmail, name: 'Mention Target', password: teammatePassword },
    });
    expect(signupRes.status(), await signupRes.text()).toBe(201);

    const deckId = await createDeck(authorApi, `Mention Deck ${Date.now()}`);
    const postRes = await authorApi.post(`/api/decks/${deckId}/comments`, {
      data: {
        slideId: 's1',
        body: `heads up @${teammateEmail} — please review`,
      },
    });
    expect(postRes.status(), await postRes.text()).toBe(201);
    const created = (await postRes.json()) as { comment: { id: string } };

    // Sign in as the mentioned teammate in a fresh context and check inbox.
    const teammateCtx = await browser.newContext();
    const teammatePage = await teammateCtx.newPage();
    await teammatePage.goto('/login');
    await teammatePage.locator('input[type="email"]').fill(teammateEmail);
    await teammatePage.locator('input[type="password"]').fill(teammatePassword);
    await Promise.all([
      teammatePage.waitForURL((url) => !url.pathname.startsWith('/login')),
      teammatePage.getByRole('button', { name: /sign in/i }).click(),
    ]);
    await teammatePage.close();
    const teammateApi = teammateCtx.request;

    await expect
      .poll(
        async () => {
          const res = await teammateApi.get('/api/inbox?unread=1');
          if (!res.ok()) return [];
          const body = (await res.json()) as {
            entries: Array<{ comment: { id: string; body: string } }>;
          };
          return body.entries.map((e) => e.comment.id);
        },
        { timeout: 10_000, intervals: [250, 500, 1000] },
      )
      .toEqual(expect.arrayContaining([created.comment.id]));

    await authorCtx.close();
    await teammateCtx.close();
  });

  test('outline-first: brief → outline → approve scaffolds DRAFT deck', async ({ browser }) => {
    const ctx = await browser.newContext();
    const api = await loginAsAdmin(ctx);
    const deckId = await createDeck(api, `Outline Deck ${Date.now()}`);

    const startRes = await api.post(`/api/decks/${deckId}/outline-conversations`, {
      data: {
        brief: {
          title: 'Series A pitch',
          audience: 'Series A leads at climate-focused funds',
          goal: 'Secure a follow-on meeting within two weeks',
          talkingPoints: 'Problem; our wedge; early traction; ask; team.',
          tone: 'Confident, data-led',
          targetSlideCount: 5,
        },
      },
    });
    expect(startRes.status(), await startRes.text()).toBe(201);
    const started = (await startRes.json()) as {
      conversation: { id: string; approvedAt: string | null };
    };
    expect(started.conversation.approvedAt).toBeNull();

    const approveRes = await api.post(
      `/api/outline-conversations/${started.conversation.id}/approve`,
    );
    expect(approveRes.status(), await approveRes.text()).toBe(200);
    const approved = (await approveRes.json()) as {
      deck: { id: string; lifecycleStage: string; headCommitSha: string | null };
      slideCount: number;
    };
    expect(approved.deck.lifecycleStage).toBe('DRAFT');
    expect(approved.deck.headCommitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(approved.slideCount).toBeGreaterThanOrEqual(1);

    await ctx.close();
  });
});
