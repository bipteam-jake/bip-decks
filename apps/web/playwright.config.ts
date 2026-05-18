// Playwright config for Phase 1 smoke tests (DoD bullet in
// docs/bip-deck-platform-phasing.md §2). Tests live in apps/web/e2e/ and
// drive a dedicated Next.js dev server on port 3100 so they don't collide
// with the developer's local `npm run dev` (default 3000/3001).
//
// The dedicated server runs with ANTHROPIC_API_KEY=mock so the AI editor
// flow exercises the proposal -> accept pipeline without spending tokens
// or depending on Anthropic's API. See packages/ai-gateway/src/index.ts.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: require.resolve('./e2e/global-setup'),
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `next dev -p ${PORT}`,
        cwd: __dirname,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: 'mock',
          APP_BASE_URL: BASE_URL,
          EMAIL_PROVIDER: 'console',
          EMAIL_FROM: process.env.EMAIL_FROM ?? 'decks@bip.test',
          // DATABASE_URL, SESSION_SECRET, etc. come from .env.local via next dev.
        } as Record<string, string>,
      },
});
