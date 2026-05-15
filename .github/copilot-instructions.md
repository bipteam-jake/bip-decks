# GitHub Copilot Instructions — BIP Deck Platform

These instructions are read automatically by GitHub Copilot in this repository. They give Copilot persistent context so it can collaborate without re-explanation on every prompt.

## What this project is

The BIP Deck Platform is a single-tenant internal tool for BIP to author, review, and distribute bespoke web-based presentations (HTML/CSS/JS, not slide-builder output). It replaces the existing pitch-deck tool with AI-assisted authoring, structured review, versioned distribution, and audience analytics.

This is **not a SaaS product**. BIP is the only tenant, forever.

## Where authoritative information lives

Before answering any design question or generating non-trivial code, check the relevant doc:

- `docs/bip-deck-platform-architecture.md` — full system design, all features, tech stack
- `docs/bip-deck-platform-phasing.md` — what ships in which phase (Phase 1 is MVP)
- `docs/bip-deck-platform-data-model.md` — Phase 1 Postgres schema (Prisma models)
- `docs/bip-deck-platform-ai-editor.md` — design for the AI editor in Phase 1
- `docs/bip-deck-platform-deployment.md` — Docker Compose for local dev and production

If a question isn't answered in the docs, ask before assuming. Don't invent design decisions.

## Phase awareness

We are currently building **Phase 1**. Do not introduce Phase 2/3/4 features even if they seem easy. The phasing doc has explicit out-of-scope lists per phase — respect them.

Features explicitly out of scope for Phase 1:
- Brand kits, pattern library
- Element-level commenting (slide-level only in Phase 1)
- Outline-first generation flow
- Multi-model AI routing (Claude Sonnet only)
- Agentic AI editor depth (chat depth only)
- Job queue (synchronous execution only; the `Job` table exists but no BullMQ yet)
- File uploads in AI chat
- Three viewer link types (one magic-link share type only)
- Client portal
- Analytics dashboard
- Triage pipeline
- @mentions and inbox
- SSO, TOTP
- PDF export
- Watermarking, per-recipient codes
- Roll-forward of share links

## Tech stack

- **Frontend & API:** Next.js 14+ (App Router, TypeScript)
- **Database:** Postgres 16, Prisma 5+ ORM
- **Cache/queue:** Redis 7 + BullMQ (Phase 3 will activate the queue; Phase 1 ships Redis idle)
- **Object storage:** S3-compatible (MinIO for local dev, R2 or BIP-provided for prod)
- **Git:** `simple-git` library wrapping the `git` CLI
- **AI:** `@anthropic-ai/sdk` wrapped in an internal `packages/ai-gateway` abstraction
- **Auth:** custom email + password using `argon2`. No SSO in Phase 1.
- **Headless browser:** Playwright (Phase 3+ for PDF export and bundler tests)
- **Containers:** Docker Compose for both local dev and production

## Repo structure

Monorepo with npm workspaces:

```
apps/
  web/      — Next.js app (admin portal + API routes + deck runtime)
  worker/   — BullMQ worker (idle in Phase 1, structured for Phase 3)
packages/
  db/             — Prisma schema, migrations, generated client
  ai-gateway/     — AI provider abstraction (Anthropic only in Phase 1)
  shared/         — Shared TypeScript types and utilities
deck-repos/       — Each deck's git repo (gitignored, mounted volume)
docker/           — Dockerfiles + nginx config
```

## Coding conventions

- TypeScript strict mode everywhere. No `any` unless interfacing with an untyped library, and then it's localized.
- Database access goes through Prisma. No raw SQL except for the CHECK constraints in `bip-deck-platform-data-model.md` §4.3 and migration scripts.
- API routes are colocated in `apps/web/app/api/`. Business logic is in service modules in `apps/web/lib/`, imported by routes. Routes should be thin.
- Git operations go through a single `lib/git.ts` wrapper around `simple-git`. No raw shell-outs to git elsewhere.
- AI calls go through `packages/ai-gateway`. No direct SDK calls elsewhere.
- Errors are typed. Throw `AppError` subclasses with meaningful codes; the API layer maps them to HTTP responses.
- Logs are structured JSON via `pino`. Every request has a `request_id`; pass it through to AI calls and DB queries for traceability.

## Database conventions

See `bip-deck-platform-data-model.md` §1 for the full list. Quick summary:

- UUIDs for primary keys.
- `snake_case` in the database, `camelCase` in Prisma client (`@@map` and `@map` on every multi-word field).
- Every table has `created_at`; mutable tables have `updated_at`.
- Soft delete is only for `User` and `Deck`. Everything else cascades on hard delete of the parent.
- Indexes: every FK gets one; compound indexes per documented query pattern only.

## What to do when uncertain

1. **Check the docs first.** Most questions are answered there.
2. **If the docs are silent, ask.** Don't guess a design decision.
3. **If the docs disagree with code, the docs are usually right.** Update the code unless you can articulate why the doc should change instead.
4. **Don't expand scope.** A change that "would be cleaner if we also..." is usually a Phase 2+ feature. Note it as a TODO comment with a link to the relevant doc section, don't build it.

## Style of collaboration

- Be direct. If a request conflicts with the docs or seems out of phase, say so.
- Prefer small, complete changes over large sketches. A working endpoint with one happy path is better than five half-built ones.
- When suggesting a change to architecture or docs, propose it as a question first, not a fait accompli.
- Tests are not optional but they're sized to the phase: Phase 1 is "Playwright smoke tests cover the primary flows plus unit tests on service-layer business logic." Don't write exhaustive test suites yet.
