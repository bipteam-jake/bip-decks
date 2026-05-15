# BIP Deck Platform — Deployment Plan

**Version:** 0.1
**Status:** Living document, companion to architecture, phasing, data model, and AI editor docs.
**Authoritative on:** local dev setup and deployment shape for Phase 1.

---

## 0. About this document

How the platform runs — on your laptop while building, and on BIP infrastructure once it ships. The architectural decision is settled: **Docker Compose for both**, same stack in both places, differences live in environment variables. Production hosting is handed off to BIP's dev team; this doc gives them what they need to deploy and gives you what you need to develop.

---

## 1. Shape

One repository, one Docker Compose stack, two environments.

**Services in the stack:**

- `app` — Next.js (admin portal + client portal + API routes + deck runtime, all one app)
- `worker` — separate Node process running BullMQ workers. Phase 1 has no jobs to run, but the container ships from day one so adding Phase 3 work doesn't change the deployment shape.
- `postgres` — Postgres 16
- `redis` — Redis 7 (Phase 1 unused; ships ready for Phase 3 queue)
- `minio` — S3-compatible object storage for local dev; production uses Cloudflare R2 or BIP-provided S3-compatible storage instead

**Outside the stack:**

- Email provider (Resend or Postmark) — external SaaS, accessed via API key
- Anthropic API — external, accessed via API key
- DNS and TLS termination — BIP's responsibility in production; not needed in dev

---

## 2. Repository layout

Monorepo. One repository contains everything.

```
bip-deck-platform/
├── apps/
│   ├── web/                    # Next.js app (admin, client portal, API, deck runtime)
│   └── worker/                 # BullMQ worker process
├── packages/
│   ├── db/                     # Prisma schema, migrations, generated client
│   ├── ai-gateway/             # Internal AI provider abstraction
│   └── shared/                 # Shared TypeScript types and utilities
├── deck-repos/                 # Git repositories for each deck (gitignored; mounted volume)
├── docker/
│   ├── app.Dockerfile
│   ├── worker.Dockerfile
│   └── nginx.conf              # Production nginx config (for the dev team)
├── docker-compose.yml          # Local dev
├── docker-compose.prod.yml     # Production overlay (overrides for prod env)
├── .env.example
├── package.json
└── README.md
```

**Notes**
- `deck-repos/` is where every deck's git repository lives. Not committed to the platform repo — these are user data. Mounted as a volume in the container so the app can shell out to `git`.
- The monorepo uses npm workspaces. Yarn or pnpm work too; npm is the lowest-friction choice and Next.js plays well with it.
- The dev team gets `docker-compose.prod.yml` plus a deployment readme; they don't need to read the rest of the docs.

---

## 3. Local development

### Prerequisites

- Docker Desktop (Mac) or Docker Engine (Linux)
- Node.js 20+ (for running scripts outside containers if you want)
- An Anthropic API key
- An email provider API key (Resend or Postmark)

### First-run setup

```bash
git clone <repo>
cd bip-deck-platform
cp .env.example .env.local
# Edit .env.local to add API keys
docker compose up -d postgres redis minio
npm install
npm run db:migrate           # Runs Prisma migrations against the dockerized Postgres
npm run db:seed              # Creates a default admin user and a sample deck
docker compose up app worker # Or run app/worker outside Docker, your choice
```

After this, the app is at `http://localhost:3000`. The seed creates an admin login (credentials printed to console on seed run).

### Day-to-day

Two patterns work, pick what's faster for you:

**Containers all the way down.** `docker compose up` brings the whole stack. Code changes hot-reload because the source directories are bind-mounted into the containers. This matches production most closely but eats a bit more battery.

**Hybrid.** `docker compose up postgres redis minio` runs the data services in containers; `npm run dev` runs Next.js and the worker natively on your machine. Faster iteration, faster startup, no Docker layer rebuilds when you change dependencies. This is what I'd recommend day-to-day.

Both setups read from `.env.local`. The hybrid setup just uses `localhost:5432` instead of `postgres:5432` for the database URL — the `.env.example` shows both.

### Useful scripts

`package.json` ships with these:

- `npm run dev` — start app + worker locally with hot reload
- `npm run db:migrate` — run pending Prisma migrations
- `npm run db:reset` — drop and recreate the database, re-run migrations, re-seed
- `npm run db:studio` — open Prisma Studio for visual DB inspection
- `npm run lint` — ESLint across the monorepo
- `npm run test` — unit tests (Vitest)
- `npm run test:e2e` — Playwright smoke tests
- `npm run build` — production build of all apps

### Resetting state

Local dev should be cheap to reset. `docker compose down -v && docker compose up -d postgres redis minio && npm run db:migrate && npm run db:seed` wipes everything. The `-v` flag drops the volumes (database data, object storage); without it, restarts preserve state.

Deck git repos live in `./deck-repos/` (bind-mounted). To wipe them too, `rm -rf deck-repos/* && docker compose restart app`.

---

## 4. Environment variables

`.env.example` lists every variable the app reads, with comments. Sketch:

```bash
# Database
DATABASE_URL=postgresql://bip:dev@postgres:5432/bip_deck_platform
# (localhost:5432 for hybrid dev)

# Redis
REDIS_URL=redis://redis:6379

# Object storage
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=bip-deck-assets
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

# Deck repos
DECK_REPOS_PATH=/var/bip/deck-repos
# (./deck-repos for hybrid dev)

# Auth
SESSION_SECRET=<32-byte random hex>
# argon2id parameters use sensible defaults; override if needed

# Email
EMAIL_PROVIDER=resend  # or postmark
EMAIL_API_KEY=<your key>
EMAIL_FROM=decks@bip.com

# AI
ANTHROPIC_API_KEY=<your key>
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-6

# Application
APP_BASE_URL=http://localhost:3000
# Production: https://decks.bip.internal or whatever the dev team assigns

# Misc
LOG_LEVEL=info
NODE_ENV=development
```

**Conventions**
- Every secret is in `.env.local` (gitignored). The repo only commits `.env.example`.
- No defaults in code for secrets. The app refuses to start if a required env var is missing, with a clear error naming what's missing.
- Production secrets are managed by BIP infrastructure (likely Docker secrets, or env vars set on the host). The dev team handles this; the app doesn't care where the values come from.

---

## 5. Production deployment

The dev team is handling the actual hosting. This section is what they need to know.

### What we hand over

- `docker-compose.prod.yml` — production stack definition
- `docker/app.Dockerfile` and `docker/worker.Dockerfile` — multi-stage builds producing slim production images
- A deployment README (`docs/deployment.md`, written when we ship) covering the items below

### What the production stack looks like

Same five services as dev, with these differences:

- **`postgres`** — they may swap our Postgres container for a managed Postgres instance on BIP infrastructure. The app only needs `DATABASE_URL`; how it's provided is up to them.
- **`redis`** — same. Either our container or BIP-managed.
- **`minio` swapped for real S3-compatible storage** — Cloudflare R2 is the cheap default (no egress fees, good for a deck distribution platform); BIP-internal S3 is fine too. The app talks to anything S3-compatible via env vars.
- **`app` and `worker`** — same images as dev. No code-level prod/dev split; behavior differs only via `NODE_ENV` and config.
- **`nginx`** — added in production, fronts the `app` service, terminates TLS, handles HTTPS redirects. We ship a sample `nginx.conf`; the dev team adapts it to BIP cert workflow.

### Build and release

- Tag a commit (e.g. `v0.1.0`) → CI builds production images and pushes to BIP's internal Docker registry (or wherever they prefer)
- Dev team pulls images on the production host and runs `docker compose -f docker-compose.prod.yml up -d`
- Database migrations run automatically on app container startup if a flag is set (`AUTO_MIGRATE=true`), or manually with `docker compose exec app npm run db:migrate` if they prefer the controlled version

### What needs to be in place before first deploy

- Postgres instance with backups configured (daily snapshots minimum, retention per BIP policy)
- S3-compatible bucket created with appropriate access policies
- DNS record pointing at the production host
- TLS certificate (BIP internal CA or Let's Encrypt — dev team's call)
- Internal-network firewall rules: app exposed only on the internal network, not public internet
- Secrets provisioned and accessible to the running containers

### Monitoring

- App logs go to stdout as structured JSON. Dev team pipes them wherever BIP centralizes logs (likely an ELK stack or similar).
- Sentry (or equivalent) wired in for error reporting. Free tier is plenty for a single-tenant internal tool.
- Healthcheck endpoint at `/api/health` returns 200 if the app can talk to Postgres and Redis. Compose healthcheck stanza uses it.

---

## 6. Docker Compose — local dev

Sketch of `docker-compose.yml` for reference. Final file will be in the repo; this is the shape.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: bip
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: bip_deck_platform
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bip"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio-data:/data
    ports:
      - "9000:9000"
      - "9001:9001"

  app:
    build:
      context: .
      dockerfile: docker/app.Dockerfile
      target: dev
    env_file: .env.local
    volumes:
      - .:/app
      - /app/node_modules
      - ./deck-repos:/var/bip/deck-repos
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
      minio:
        condition: service_started

  worker:
    build:
      context: .
      dockerfile: docker/worker.Dockerfile
      target: dev
    env_file: .env.local
    volumes:
      - .:/app
      - /app/node_modules
      - ./deck-repos:/var/bip/deck-repos
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

volumes:
  postgres-data:
  redis-data:
  minio-data:
```

The `target: dev` in the build stanzas points at a development stage of the Dockerfile that uses `npm run dev` and bind-mounts source. Production uses `target: prod` which copies a built artifact and runs `node` directly.

---

## 7. Migrating between environments

Going from local to staging to prod is just `docker compose up` with a different compose file and different env vars. No code changes. This is the entire point of running Docker in dev — what works on your laptop works on the server.

Three things that *do* differ between environments:

- **Migrations**: dev runs them with `npm run db:reset` freely; prod runs them deliberately, on releases, with backups in hand.
- **Seed data**: dev seeds a sample deck and admin user; prod seeds nothing (or only a single admin if BIP wants a bootstrap account).
- **Logs and errors**: dev to stdout; prod to centralized logging and Sentry.

---

## 8. Notes for future phases

What changes in deployment as we move through phases:

- **Phase 2** adds nothing new to deployment. New features run inside the same containers.
- **Phase 3** activates the worker container (it's been idle until now) and starts using Redis as a real queue. No new services.
- **Phase 4** may add SSO config — environment variables only, no new services. SMTP/email gets more traffic from the notification system; same provider, just more volume.

The deployment shape is good through Phase 4 without architectural changes. If load eventually justifies horizontal scaling (very unlikely for an internal tool), the path is: split `app` into multiple replicas behind nginx, move Postgres and Redis to managed services. Years away if ever.

---

## 9. Open items

- **Email provider choice.** Resend and Postmark are both fine. Resend is newer with better DX; Postmark has a longer track record. Pick when we set up email — the code calls a thin abstraction either way.
- **Sentry vs. alternative.** Sentry is the obvious pick. If BIP has a different error-reporting stack already, we use that.
- **Docker registry.** CI pushes images somewhere. Dev team's call — GitHub Container Registry, Docker Hub private repo, or BIP-internal registry all work.
- **Backup strategy details.** "Postgres has backups" is the requirement; how (pgBackRest? managed snapshots? custom cron?) is the dev team's choice based on BIP's standard ops patterns.
