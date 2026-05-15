# BIP Deck Platform — Phasing Plan

**Version:** 0.1
**Status:** Living document, companion to `bip-deck-platform-architecture.md`.
**Authoritative on:** what ships in which phase, and in what order.

---

## 0. About this document

Companion to the architecture doc. The architecture doc describes the system as designed in full; this doc describes the build sequence — what gets cut where, what each phase needs to do, and what stays out even when tempting.

If the architecture doc says *what* and *why*, this doc says *when*.

---

## 1. Phasing philosophy

- **MVP means end-to-end usable for one real deck.** Not "everything we designed, scoped down." Not "just the foundation." The smallest cut that closes the author → review → finalize → distribute loop for one BIP project.
- **Internal authoring quality before external sharing depth.** The platform's differentiator is how decks get made, not how they get sent. Phase 2 invests in the part the existing tool can't do; Phase 3 catches up and surpasses on the parts the existing tool already handles.
- **Cuts are honored.** Every phase has explicit out-of-scope items. Things designed in the architecture doc but not in the current phase stay out, even when tempting.
- **Two tools coexist during the transition.** Until Phase 3 lands, BIP runs both the existing pitch-deck tool (for external review with triage) and the new platform (for internal authoring on new decks). Full cutover happens after Phase 3.
- **Each phase ends with a usable system.** No phase requires the next to be deployable or valuable.

---

## 2. Phase 1 — MVP loop

**Goal.** A BIP team member can create a new deck, edit it with AI assistance, send it to one reviewer for comments, iterate, and mark it final — entirely on the new platform.

**Rough size.** 4–6 weeks of focused work, assuming AI-assisted development.

### In scope

- Repository setup, Docker Compose dev environment
- Next.js app skeleton with admin route group only
- Postgres + Prisma schema for: users, decks, deck_versions (git refs), comments, share_links
- Team auth: email + password, argon2 hashing, 90-day rolling sessions in HTTP-only cookies. No TOTP yet.
- Deck CRUD: create from blank, name/rename, set lifecycle stage (purely informational), archive
- Decomposed deck on disk: directory + `deck.json` manifest + per-slide HTML + global styles/scripts + assets
- One git repository per deck, all changes auto-committed via `simple-git`
- View-time bundling pipeline with commit-hashed cache (Postgres-backed cache table to start)
- Deck runtime: serve bundled HTML at `/d/{deck_slug}` behind share-link auth
- AI editor: chat depth only, Claude Sonnet only, proposal-mode working branch, visual diff preview (rendered iframe side-by-side), accept/reject. No auto-accept toggle. No queue. No file uploads. No agentic mode.
- Slide-level comments: port the comment overlay from the existing tool; threaded replies, voting, status workflow (`open → in_review → planned → done → dismissed`)
- One sharing flow: magic-link invite that lets a recipient view the deck and comment. No portal for recipients yet; they land directly in the deck.
- Basic admin shell: deck list, deck editor (preview iframe + chat panel + comment feed), per-deck comment view

### Out of scope (explicitly)

- TOTP, SSO
- Outline-first generation flow
- Brand kits, pattern library
- Element-level commenting
- Three viewer link types, viewer analytics, client portal
- Triage, mini-triage, @mentions, reviewer roster
- Async job queue, agentic depth, multi-model routing
- File uploads in chat
- PDF export
- Roll-forward, snapshot tags
- All Phase 4 items

### Definition of done

- A team member can complete the full author-review-iterate-finalize loop on a fresh deck without falling back to other tools
- All deck changes commit cleanly to git; history is readable
- Magic-link recipient sees the deck and can leave comments
- Playwright smoke tests cover the primary flows
- Deployed locally via Docker Compose and to a staging instance on internal infrastructure

### Key risks

- **AI editor scope creep.** Temptation to add the queue or agentic mode mid-phase will be strong. Resist; both depend on infrastructure that earns its place in Phase 3.
- **Git operations edge cases.** Concurrent edits to the same deck, working branch cleanup, recovery from failed commits. Add a soft "editing lock" on a deck's working branch so only one editor session is active at a time.
- **Bundler complexity.** View-time bundling with cache has more details than it looks — asset URL rewriting, signed URL TTLs, cache key collisions. Build the uncached version first; add the cache layer only when serving is working end-to-end.

---

## 3. Phase 2 — Distinctive authoring

**Goal.** Internal authoring on the new platform genuinely surpasses any other tool BIP could use. Brand-aligned output by default, structured deck creation, granular feedback.

**Rough size.** 6–8 weeks.

### In scope (suggested order of build)

1. **Element-level commenting.** Figma-style pin-on-canvas. Hit testing on slide elements in the scaled preview iframe, anchor coordinates persisted with each comment, overlay rendering of pins. Comment schema extended with optional `slide_id + element_anchor`.
2. **@mentions and inbox.** Mention any team member in a comment or admin note. Mentions create inbox entries on that person's admin home. Light in-app surface; no email yet (that comes in Phase 4 as part of notifications).
3. **Outline-first generation flow.** Start a new deck from a structured brief. Multi-turn conversation that produces an approved outline (titles + narrative notes per slide), then generates slide stubs into the deck. Runs synchronously with streamed response, no queue yet.
4. **Brand kits.** The full subsystem per architecture doc §10. Kits CRUD, identity assets, design tokens, voice, references, PDF extraction (synchronous, with progress indicator), version pinning per deck, theme override resolution in the bundler.
5. **Pattern library.** Save-as-pattern from any slide, parameterized snippets, pattern picker available in AI editor for new slide creation.

### Out of scope (explicitly)

- Triage, mini-triage, conflict surfacing
- Three viewer link types beyond what Phase 1 has
- Client portal
- Multi-model gateway expansion (still Claude-only)
- Queue, agentic depth
- Analytics dashboard
- Roll-forward, snapshot tags
- All Phase 4 items

### Definition of done

- Authoring a brand-aligned deck for a portfolio company is meaningfully faster than with the existing tool
- Outline-to-deck flow produces usable first drafts
- Element-level comments work reliably and persist through slide edits
- All new features have Playwright coverage

### Key risks

- **Brand kit scope.** Easy to keep adding token types and identity asset slots. Lock the v1 token schema early; extensions land in v1.1 of the kit format, not v1.0.
- **Synchronous long-running operations.** Outline generation and PDF extraction will block requests for 20–60s. Stream responses to the client, show progress in the UI, and accept this is interim — Phase 3's queue makes both async cleanly.
- **Element comment hit testing.** Slide content is rendered in an iframe with CSS transform: scale. Coordinate math needs care; reuse hit-test patterns from existing tooling rather than inventing.

---

## 4. Phase 3 — Sharing and depth

**Goal.** Surpass the existing tool on every dimension. Full cutover after this phase.

**Rough size.** 6–8 weeks.

### In scope (suggested order of build)

1. **Job queue infrastructure.** BullMQ + Redis, separate worker process, job status persistence, UI surface for in-flight jobs (the queue panel from the architecture doc).
2. **Agentic depth.** Now feasible with the queue. Multi-step planning, reviewable plan batches, Opus-class planning + Sonnet execution.
3. **Multi-model AI gateway.** Expand the gateway abstraction (already in place from Phase 1) to route per task type. Add OpenAI and Google adapters. Per-call cost and latency tracking.
4. **File uploads in chat.** Images, PDFs, docs, pasted long text. Vision context wiring for Claude. Routing rules for brand-asset uploads vs deck-context uploads.
5. **Triage pipeline.** Port and adapt the existing tool's two-phase map/reduce (per-slide Haiku map → Sonnet rollup). Output is structured edit proposals that can be sent to the AI editor as agentic-mode tasks ("send to editor"). Conflict surfacing UI as a first-class section.
6. **Continuous mini-triage.** Cheap Haiku pass on new comments, surfaced as "since you last looked" summaries on deck view, throttled.
7. **Three viewer link types.** Public, email-gated, coded. Snapshot binding with git tags. Roll-forward flow with confirmation modal naming old and new versions.
8. **Client portal.** Separate route group, magic-link auth, decks-shared-with-me list, per-deck view with comments and version history.
9. **Analytics.** `view_events` table, event capture from deck runtime, basic per-deck and per-link dashboards (total views, unique viewers, average time, slide dwell heatmap, completion rate).

### Out of scope (explicitly)

- All Phase 4 items

### Definition of done

- Triage outputs match or exceed quality of the existing tool's triage
- All three viewer link types work; expiry and revocation tested
- Client portal usable end-to-end by a real client
- Analytics dashboard reads cleanly with real data
- The existing tool can be deprecated and decks moved entirely to the new platform

### Key risks

- **Triage prompt regressions.** The existing prompts work; port them carefully and resist rewrites without comparison against the old outputs.
- **Analytics event volume.** Design the table for query patterns from the start; consider time-based partitioning if event volume grows.
- **Client portal scope.** Easy to make this a second full product. Stay strict: list, view, comment, history. Nothing more in v1.

---

## 5. Phase 4 — Polish and reach

**Goal.** Production-quality across all the secondary features. Can be built piecemeal over time once Phase 3 is in production.

**Rough size.** 3–4 weeks total work, can be spread over months.

### In scope

- Microsoft SSO via Azure AD OAuth (additive to email + password, not replacing)
- TOTP 2FA for team auth
- Watermarking on snapshot viewer links — viewer email overlaid faintly on each slide
- Per-recipient codes for coded viewer links
- Brand fit score (periodic AI check flagging drifted slides)
- Notification system: email digests for clients on new comments, in-app + email for team @mentions
- Reviewer roster sidebar with engagement state (`not opened` / `viewed no comment` / `commented N times`)
- Roll-forward UI polish (better diff preview, "preview as recipient" view)
- PDF export fidelity improvements (interactive elements fallback rendering, font embedding)

### Out of scope

- Anything not listed. Future enhancements live in a Phase 5+ backlog (see §7).

---

## 6. Cross-cutting concerns

Apply across all phases.

### Testing

- Playwright smoke tests for primary flows in each phase
- Unit tests for service-layer business logic
- Manual end-to-end against a real deck before phase sign-off

### Deployment

- **Local dev:** Docker Compose with hot reload (Postgres, Redis, MinIO, Next.js app, worker)
- **Staging:** single VM on BIP internal infrastructure, same compose stack
- **Production:** same as staging initially; revisit when load justifies horizontal scale
- Database backups configured before Phase 1 wraps; AI gateway logs retained

### Observability

- Structured JSON logs from day one with request IDs
- AI call logs capture model, token counts, cost, latency
- Job status visible in admin UI from Phase 3 onward
- Sentry or equivalent for error reporting

### Security

- TLS everywhere
- Secrets in environment variables only, never in code or git
- Rate limits on all public endpoints (carry forward limits from the existing tool: 30 comments/min, 60 votes/min, 10 ask-AI/min per IP)
- Argon2 for password hashing, OTPLib for TOTP
- HTTP-only, secure, SameSite cookies for sessions
- CSP permissive per-deck (hand-authored decks need inline styles/scripts) but strict on admin and portal routes

---

## 7. After Phase 4

Items not yet designed that may become a Phase 5+ backlog:

- Realtime presence (multiple BIP editors on the same deck without conflicts)
- Sockets-based comment notifications (replacing polling)
- Mobile-optimized deck runtime
- Internal deck templates marketplace
- AI-assisted analytics insights ("this slide loses 40% of viewers")
- Public showcase mode for non-confidential decks
- Deck-to-deck content reuse (lift slide 7 from last quarter's deck)
- Read-only client portal logins on social SSO (Google, LinkedIn) for friction reduction

These get prioritized on demand, not committed to up front.
