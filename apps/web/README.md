# `@bip/web` — admin portal, API, deck runtime

The Next.js 14 (App Router, TypeScript strict) application. Hosts the admin
portal, all API routes, and (Phase 2+) the deck runtime at `/d/{slug}`.

For the system as a whole see [`docs/`](../../docs/). This README covers the
day-to-day developer workflow only — it's a condensed view of
[`docs/bip-deck-platform-deployment.md`](../../docs/bip-deck-platform-deployment.md) §3.

---

## Prerequisites

- Docker (Desktop on macOS, Engine on Linux)
- Node.js 20+ (for hybrid dev and editor tooling)
- Anthropic API key (Phase 1 doesn't call it yet, but `.env.local` validation will require it once we wire the env loader)
- Email-provider API key (Resend or Postmark)

## First-run setup

From the repo root:

```bash
cp .env.example .env.local
# Edit .env.local — add ANTHROPIC_API_KEY, EMAIL_API_KEY, generate SESSION_SECRET
#   openssl rand -hex 32

docker compose up -d postgres redis minio
npm install
npm run db:generate
npm run db:migrate:dev   # creates the initial Prisma migration
```

Then pick a dev mode below.

## Day-to-day: two patterns

### Hybrid (recommended)

Data services in containers, Next.js + worker on the host. Fastest iteration.

```bash
docker compose up -d postgres redis minio
# In .env.local, switch DATABASE_URL / REDIS_URL / S3_ENDPOINT / DECK_REPOS_PATH
# to the localhost variants (commented in .env.example).
npm run dev:web      # Next.js on http://localhost:3000
npm run dev:worker   # in another terminal — logs "worker idle" every 30s
```

### Containers all the way down

Closer to production; slower restarts.

```bash
docker compose up
# App on http://localhost:3000, worker logs in compose output.
```

Both setups read `.env.local`.

## Verifying the stack

```bash
curl -s http://localhost:3000/api/health
# Expected: {"ok":true,"db":true,"redis":true}
```

A 503 with one of the booleans `false` tells you which dependency is down.

```bash
npm run db:studio
# Opens Prisma Studio at http://localhost:5555 — confirm all tables exist.
```

MinIO console: <http://localhost:9001> (user `minioadmin` / pass `minioadmin`).

## Useful scripts

Run from the repo root unless noted.

| Command                  | What it does                                       |
| ------------------------ | -------------------------------------------------- |
| `npm run dev`            | Start every workspace's `dev` script               |
| `npm run dev:web`        | Just the Next.js app                               |
| `npm run dev:worker`     | Just the worker (placeholder in Phase 1)           |
| `npm run build`          | Production build of all workspaces                 |
| `npm run lint`           | ESLint across the monorepo                         |
| `npm run test`           | Unit tests (Vitest — wired in as features land)    |
| `npm run test:e2e`       | Playwright smoke tests (added in Phase 1)          |
| `npm run db:generate`    | Generate the Prisma client                         |
| `npm run db:migrate`     | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create + apply a new migration in dev              |
| `npm run db:reset`       | Drop, re-create, re-migrate, re-seed               |
| `npm run db:studio`      | Open Prisma Studio                                 |
| `npm run db:seed`        | Re-run seeds (added with the auth feature)         |

## Resetting state

Local dev should be cheap to nuke:

```bash
docker compose down -v
docker compose up -d postgres redis minio
npm run db:migrate
npm run db:seed     # once the seed script lands
```

To also wipe deck git repos:

```bash
rm -rf deck-repos/*
docker compose restart app
```

## Project layout (this app)

```
apps/web/
├── app/
│   ├── api/health/route.ts   # /api/health — Postgres + Redis ping
│   ├── globals.css           # Tailwind directives
│   ├── layout.tsx
│   └── page.tsx              # placeholder landing
├── lib/
│   ├── prisma.ts             # Prisma singleton (HMR-safe)
│   └── redis.ts              # ioredis singleton
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
└── tsconfig.json
```

API routes stay thin; business logic lives in `lib/` service modules per
`.github/copilot-instructions.md`.

## Phase 1 status

Currently scaffold only — no business logic yet. Next sessions, in order:

1. Auth (email + password, argon2, 90-day sessions).
2. Deck CRUD + git-repo initialization.
3. View-time bundling pipeline at `/d/{slug}`.
