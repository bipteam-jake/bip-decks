# First prompt

Use this prompt the first time you open the repo in VS Code with GitHub Copilot Chat. Paste it into the Copilot Chat panel (not inline suggestions). It assumes Copilot has already read `.github/copilot-instructions.md` automatically.

The goal of this first session is **not** to write business logic. It's to stand up the foundation — repo structure, Docker Compose, Next.js skeleton, Prisma client, a "hello" route — and verify everything boots cleanly. Once that works, subsequent prompts build features on top.

---

## The prompt

```
I'm starting Phase 1 of the BIP Deck Platform. The docs in /docs are the
authoritative design, and .github/copilot-instructions.md has persistent
context. Read those before responding.

For this first session, scaffold the foundation only. Do not implement business
logic yet. Specifically:

1. Create the monorepo structure per the deployment doc (§2): apps/web,
   apps/worker, packages/db, packages/ai-gateway, packages/shared. Use npm
   workspaces. Root package.json with workspace globs.

2. Initialize apps/web as a Next.js 14 App Router project, TypeScript strict.
   Tailwind for styling. No UI library yet — we'll choose one when we need it.

3. Initialize apps/worker as a minimal Node TypeScript project with a single
   entry file that logs "worker idle" every 30 seconds. It's a placeholder
   for Phase 3.

4. Set up packages/db with a Prisma schema matching docs/bip-deck-platform-
   data-model.md §3. Include all ten models, all enums, all indexes, all
   @@map and @map directives. Skip the raw SQL CHECK constraints from §4.3
   for now — those land in a follow-up migration step.

5. Set up packages/ai-gateway as an empty package exporting a single
   placeholder function `callClaude(messages)` that throws "not implemented."
   Real implementation comes in the next session.

6. Write docker/app.Dockerfile and docker/worker.Dockerfile as multi-stage
   builds with `dev` and `prod` targets per the deployment doc §6.

7. Write docker-compose.yml exactly as sketched in the deployment doc §6.

8. Write .env.example with all variables listed in the deployment doc §4.

9. Write a /api/health route in apps/web that returns 200 with `{ ok: true,
   db: true, redis: true }` if it can connect to Postgres and Redis. Use
   this for the Docker Compose healthcheck.

10. Write a README section in apps/web explaining the dev workflow per the
    deployment doc §3.

When everything is in place, give me the exact commands to run to bring it up
locally, plus how to verify each piece is working (curl /api/health, prisma
studio opens, etc.).

Ask me before:
- Adding any dependency not implied by the docs
- Making architectural choices not specified in the docs
- Including any Phase 2+ feature

When you're done with each numbered step, show me what you did and pause for
me to confirm before moving to the next. We're not in a rush; correctness and
faithfulness to the docs matter more than speed.
```

---

## What to do after Copilot finishes

1. **Verify the stack boots.** `docker compose up -d postgres redis minio`, then `npm install`, then `npm run db:migrate`, then `docker compose up app`. Hit `/api/health` and confirm it returns 200.

2. **Inspect the Prisma schema.** Open it side by side with `docs/bip-deck-platform-data-model.md`. Look for missing fields, wrong types, missing indexes. Copilot makes small mistakes here; the doc is authoritative.

3. **Run `npx prisma studio`** and confirm all ten tables are present.

4. **Apply the raw SQL CHECK constraints** from data-model.md §4.3 as a follow-up migration. Ask Copilot to do this as your second prompt.

5. **Commit.** This is the "foundation works" milestone. Tag it `phase-1-scaffold` if you like.

## What comes next

Once the foundation is up and the Prisma schema matches the doc, the natural next prompts in order:

- "Implement the auth system per the architecture doc §6 and data model §3.1/3.2. Email + password, argon2, 90-day rolling sessions in HTTP-only cookies. Include a signup endpoint, login endpoint, logout endpoint, session middleware, and a seed script that creates an admin user. Tests for the happy path and the obvious failure modes."

- "Implement deck CRUD per the architecture doc §3 and §7. Create-from-blank, rename, list, get, archive, soft-delete. Each create initializes a git repo in deck-repos/ with a starter deck.json and one empty slide. No UI yet — just the API and the service module."

- "Implement the view-time bundling pipeline per the architecture doc §7. Read manifest + slide files + styles + scripts, assemble into a single HTML document, cache by commit SHA. Serve at /d/{slug}. Skip share-link auth for now — we'll add that next."

Each prompt should be one focused piece. Resist the urge to bundle. Small, complete steps with Copilot keep the codebase faithful to the docs.
