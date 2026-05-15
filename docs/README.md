# Planning Documentation

These five docs are the authoritative design for the BIP Deck Platform. Each says at the top what it is authoritative on. When they conflict, the more specific doc wins (e.g. the data model doc trumps the architecture doc on schema details).

## Read order

1. **[Architecture](bip-deck-platform-architecture.md)** — the system as designed in full. What it is, who it's for, all the features, the tech stack. Start here.

2. **[Phasing](bip-deck-platform-phasing.md)** — what ships in which phase. Phase 1 is the MVP; everything else is later. If you're tempted to build a feature, check this first.

3. **[Data model](bip-deck-platform-data-model.md)** — Phase 1 Postgres schema as Prisma models. Concrete enough to scaffold from directly.

4. **[AI editor](bip-deck-platform-ai-editor.md)** — design for the chat-depth AI editor in Phase 1. The most novel piece of the platform; read carefully before touching anything in `apps/web/app/api/decks/[id]/messages` or `packages/ai-gateway`.

5. **[Deployment](bip-deck-platform-deployment.md)** — Docker Compose for local dev and production. Read this before running anything.

## How to start building

See **[first-prompt.md](first-prompt.md)** for the prompt to give GitHub Copilot at the start of your first build session.

## Maintenance

When a design decision changes during the build, update the relevant doc in the same PR as the code change. Drift between docs and code is the project's biggest failure risk.
