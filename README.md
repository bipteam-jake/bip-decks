# BIP Deck Platform

A standalone internal tool for authoring, reviewing, and distributing bespoke web-based presentations at BIP. Replaces the existing VSCode-and-email workflow with an AI-assisted authoring environment, structured review, versioned distribution, and audience analytics.

**Status:** Phase 1 planning complete. Ready to build.

This repo currently contains design documentation only. Code is added as Phase 1 is built.

---

## Documentation

Read these in order if you're new. Each doc says what it's authoritative on.

1. **[Architecture](docs/bip-deck-platform-architecture.md)** — what the system is, audiences, core concepts, tech stack, full feature set.
2. **[Phasing](docs/bip-deck-platform-phasing.md)** — what ships in which phase. Phase 1 is the MVP loop.
3. **[Data model](docs/bip-deck-platform-data-model.md)** — Phase 1 Postgres schema as Prisma models.
4. **[AI editor](docs/bip-deck-platform-ai-editor.md)** — design for the chat-depth AI editor in Phase 1. The most novel piece.
5. **[Deployment](docs/bip-deck-platform-deployment.md)** — Docker Compose for local dev and production.

---

## Getting started

This project is built collaboratively with GitHub Copilot in VS Code. The first prompt to give Copilot when you open the repo is in **[`docs/first-prompt.md`](docs/first-prompt.md)**.

Persistent Copilot context lives in **[`.github/copilot-instructions.md`](.github/copilot-instructions.md)** — Copilot reads this automatically.

---

## Conventions

- **Decisions live in docs, not in code comments.** If a design decision feels worth explaining, the explanation belongs in the relevant doc, not the file.
- **Phase 1 only.** Don't build Phase 2/3/4 features early, even if they seem easy. The phasing doc is authoritative.
- **The docs are living.** When a decision changes during build, update the doc in the same PR as the code. Drift between docs and code is the failure mode.
