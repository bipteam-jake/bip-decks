# BIP Deck Platform — Architecture & Design

**Version:** 0.1 (planning)
**Status:** Living document. Updated as planning conversations continue.

---

## 0. About this document

Foundational architecture and design doc for the BIP deck platform — a standalone internal tool for authoring, reviewing, and distributing web-based presentations. It captures decisions made during planning and is intended as both a reference for the BIP team and the source-of-truth context for AI-assisted development (Copilot, Claude, etc.).

**Companion document:** `bip-deck-platform-phasing.md` is the authoritative source on what ships in which phase. This doc describes the system as designed in full; the phasing doc describes the build sequence.

Sections marked **[open]** are decisions deferred to later planning.

---

## 1. What this is

A single-tenant, BIP-internal tool for creating, collaborating on, and distributing web-based presentations. Decks are hand-authored HTML/CSS/JS — not slide-builder output, not PowerPoint, not PDF — because BIP's work involves bespoke, interactive, brand-specific presentations no off-the-shelf tool can produce.

The platform replaces the current workflow of editing HTML in VSCode and emailing decks around, and adds:

- AI-assisted authoring with multi-model routing
- Structured outline-first deck creation
- In-platform review and triage of feedback
- Versioned, access-controlled distribution to end audiences
- Analytics on how shared decks are consumed
- Brand kits for consistent on-brand output across portfolio companies

This is **not** a SaaS product and will never be sold externally. BIP is the only tenant, forever.

---

## 2. Audiences

Four tiers of users with distinct access levels and friction profiles.

### BIP team
Authenticated with email + password and optional TOTP. Microsoft SSO added in v1.5 as a second auth provider — the auth layer is abstracted from day one. Long-lived rolling sessions (90 days) so daily users rarely re-authenticate. Access to admin portal: full deck authoring, AI editor, triage, share-link management, analytics, brand kit management.

### Client stakeholders
Persistent accounts auto-provisioned on first invite. Authenticate via magic link emailed at invite; subsequent visits use long-lived cookies. Access to client portal listing all decks shared with them. Can view, comment, reply, see version history; cannot edit or manage links.

### External reviewers
Lightweight identities scoped to a single deck. Magic-link invite, no portal — they click the link, land in the deck, see only that deck. Can comment and reply. Typical use: a VC, board member, or one-off collaborator weighing in on one deck.

### Viewers
The end audience of a finalized deck. Read-only. No comments. Three link sub-types determine identification level (see §8).

---

## 3. Core concepts

### Deck
A versioned, branded, AI-editable web presentation. Stored on disk as a directory of HTML/CSS/JS/asset files; rendered to a single served HTML document at view time. Has a lifecycle, an optional brand kit binding, a feedback thread, zero or more outgoing share links.

### Brand kit
A reusable, versioned package of identity assets, design tokens, voice guidelines, pattern snippets, and reference materials. Bound to a deck to provide on-brand defaults. One BIP house kit, one kit per portfolio company; new kits created from brand guideline PDFs with AI-assisted extraction.

### Share link
A typed access grant pointing to a deck (live or snapshot) with audience-appropriate permissions. Carries expiry, revocation, optional access code, optional download disable, and an analytics scope.

### Version
A git commit on the deck's repository. Snapshots are git tags. Every AI edit, human edit, and accepted change is a commit. Final-stage decks auto-tag a snapshot. Returning a final deck to draft creates a working branch off the tagged snapshot.

### Comment
Feedback attached to a slide (slide-level) or to a specific element within a slide (element-level, Figma-style). Belongs to a deck, has an author (any tier except viewer), a status (`open → in_review → planned → done → dismissed`), threading, voting, and AI-assist via "Ask AI."

---

## 4. Deck lifecycle

Four informational states. **Transitions are not enforced** — the system never blocks a state change. Some operations guard against likely mistakes (issuing a viewer link on a deck with no slides surfaces a confirmation) but nothing is hard-prevented.

- **outline** — AI-assisted narrative planning. May have no slides yet. Output is a manifest plus stub slides.
- **draft** — slides being built. Mostly internal work, occasionally shared with select reviewers.
- **reviewing** — feedback collection. Internal and external collaborators may be invited. A persistent banner appears across admin views whenever external participants are present, so the team always knows when they're operating in a non-private space.
- **final** — locked snapshot. Auto-creates a git tag at transition. Viewer links typically issued from here. Returning to draft is explicit and creates a working branch off the tag.

---

## 5. System architecture

Three-tier separation: surfaces (frontends + deck runtime), services (API + AI gateway + worker), data (Postgres + git + object storage).

### Surfaces

**Admin portal** — BIP team only. The authoring experience: deck list, deck editor with AI chat panel and preview iframe, triage views, share-link management, analytics dashboard, brand kit manager.

**Client portal** — clients only. Stripped-down view: list of decks shared with the client, per-deck view, comment threads, version history.

**Deck runtime** — the served HTML decks themselves. Accessed via share-link URLs by any audience. The same runtime serves authenticated commenters (with embed comment overlay active) and unauthenticated viewers (read-only).

### Services

**API server** — HTTP service. Owns auth, all business logic, share-link resolution, deck bundling (with cache), CRUD on all entities. Single point of trust; no business logic in the frontends.

**AI gateway** — internal service abstracting LLM providers. One interface, multiple adapters (Anthropic for Claude, OpenAI for GPT and image generation, Google for Gemini). Routing rules per task type; tracks per-call cost and latency. The point of building this from day one: swapping models per task later is trivial.

**Background worker** — separate process consuming a job queue. Handles long-running tasks: per-slide and deck-level triage, agentic-mode AI edits, outline generation, slide drafting, PDF export, brand-guideline extraction. Jobs persist with status; the UI polls or streams to display progress.

### Data

**Postgres** — primary database. All business entities: users, decks, comments, share links, view events, brand kits, jobs, AI conversations.

**Git repositories** — one repo per deck. Contains all deck source files plus the manifest. Hosts version history, branches, tags. Accessed server-side via the `git` CLI through a thin Node wrapper.

**Object storage** — S3-compatible. Brand kit assets, deck images and videos, generated PDFs, uploaded reference materials, deck-bundle cache.

---

## 6. Tech stack

Chosen for developer-AI-assistant velocity, single-tenant simplicity, and a path to internal-network deployment.

- **Frontend & API** — Next.js (TypeScript, App Router). Admin and client portals as separate route groups in the same app. API routes for the backend.
- **Database** — Postgres 16. Prisma as ORM.
- **Cache & queue** — Redis. BullMQ for the background job queue.
- **Background worker** — separate Node process running BullMQ workers.
- **Object storage** — S3-compatible. Cloudflare R2 for low egress cost, MinIO if on-prem mandates self-hosted.
- **Git** — `git` CLI invoked from Node via `simple-git`.
- **Headless browser** — Playwright for PDF rendering and slide preview tooling.
- **AI SDKs** — `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`. Wrapped in a single internal `ai-gateway` package with a uniform call interface.
- **Auth** — custom email + password + TOTP using `argon2` and `otplib`. Magic links via signed JWTs in email links. Microsoft SSO via Azure AD OAuth deferred to v1.5.
- **Email** — Resend or Postmark for transactional email (magic links, notifications).
- **Local dev** — Docker Compose stack (Postgres, Redis, MinIO, Next.js app, worker).
- **Production** — Docker on BIP internal infrastructure; nginx in front for TLS and routing.

---

## 7. Deck structure on disk

A deck is a directory in its git repository:

```
deck-acme-series-a/
├── deck.json               # manifest: title, slide order, brand kit binding, theme overrides
├── slides/
│   ├── s1.html             # one file per slide
│   ├── s2.html
│   └── s7b.html
├── styles/
│   ├── global.css          # deck-wide styles
│   └── s7.css              # per-slide styles (optional)
├── scripts/
│   └── global.js           # deck-wide JS (NOTES, interactive elements, etc.)
└── assets/                 # images, video, fonts specific to this deck
    └── ...
```

### Manifest (`deck.json`)

```json
{
  "title": "Acme Series A pitch",
  "brand_kit": "acme-co@2.1.0",
  "theme_overrides": { "color.accent": "#8b5cf6" },
  "slides": [
    { "id": "s1", "title": "Cover", "notes": "..." },
    { "id": "s2", "title": "Problem", "notes": "..." }
  ]
}
```

The manifest is the source of truth for slide order, brand binding, and per-slide metadata. Slide files are referenced by `id` matching their filename.

### Bundling

View-time with a commit-hashed cache. On a request:

1. Resolve the share link to a deck and version (commit SHA).
2. Look up the cache for `(deck_id, commit_sha)`. If present, serve cached HTML.
3. Otherwise: check out the commit, read `deck.json` + slide files + styles + scripts + asset references, assemble a single HTML document, write to cache, serve.

Asset URLs in the bundled HTML point back to object storage with signed URLs.

The preview iframe in the editor skips the cache and always bundles fresh from the working branch.

---

## 8. Sharing & access control

### Link types

| Type | Audience | Identification | Comments | Persistent identity |
|---|---|---|---|---|
| Collaborator | Client stakeholder | Email + magic link | Yes | Yes, portal access |
| Reviewer | External reviewer | Email + magic link | Yes | Per-link only |
| Public viewer | End audience | None | No | None |
| Email-gated viewer | End audience | Name + email on first open | No | Cookie-bound to email |
| Coded viewer | End audience | URL + access code | No | Cookie-bound to code |

### Version binding

- **Live binding** for collaborator and reviewer links. Always shows current state.
- **Snapshot binding** for viewer links. Pinned to a specific commit at link creation.

**Roll-forward** is supported on snapshot links: the link owner can repoint a viewer link to a newer commit. Requires confirmation modal naming old and new versions. Logs a `link_rolled_forward` event so analytics show when content changed for that audience.

### Per-link controls

- Expiry (default 30 days, configurable)
- Revoke (one-click, immediate)
- Disable downloads (blocks print-to-PDF, right-click save, removes export buttons)
- Watermark with viewer email
- Per-recipient codes for coded viewer links

---

## 9. AI editor

The platform's centerpiece. Three depth tiers in one UI, automatic routing with manual override.

### Three depths

- **Quick** — single-turn edit. Haiku-class model. No tool use. Sub-second. *"Tighten this bullet."*
- **Chat** — multi-turn edit. Sonnet-class model. Light tool use (read other slides for context). Iterates until you accept. *"No, the subtitle. Now match slide 3."*
- **Agentic** — planning + multi-step execution. Opus-class for planning, Sonnet for execution. Full tool access: read any file, write to working branch, ask clarifying questions. *"Rework the financials section to lead with revenue."*

The system auto-selects depth based on request shape. A small indicator shows which depth is active and why; a dropdown allows manual override.

### Proposal mode

The agent never writes directly to the deck's main branch. All edits land on a working branch. The UI shows the proposed change as a rendered preview (visual diff) with a code-diff toggle. The user accepts (fast-forward main) or rejects (discard branch). Multi-step plans surface as a reviewable batch.

An **auto-accept toggle** (per session) bypasses the review step for fast iteration. The toggle is visibly persistent so the user always knows whether they're auto-accepting.

### Queue

Every AI request becomes a job with status (`queued / running / awaiting review / done / failed`), a human-readable label, cancelability, and a persistent log. The user can fire multiple jobs and keep working; results land back in the chat as they complete. Jobs survive page reloads.

### File uploads

Chat accepts:
- Images (vision context)
- PDFs and docs (parsed to text)
- Pasted long text (treated as attachments)
- Direct brand-asset uploads (routed to brand kit rather than deck)

### Model routing

The AI gateway routes by task type with sensible defaults. All routing is configurable.

| Task | Default model |
|---|---|
| Quick edits | Claude Haiku |
| Chat refinement | Claude Sonnet |
| Agentic planning | Claude Opus |
| Triage per-slide | Claude Haiku |
| Triage rollup | Claude Sonnet |
| Outline generation | Claude Sonnet |
| Image generation | OpenAI gpt-image-1 |
| Vision analysis of references | Claude Sonnet |
| Cheap classification (tags, hints) | Gemini Flash |

### Value-add features

- **Visual diff by default** — proposed edits show as rendered side-by-side previews. Code diff is the power-user toggle.
- **Explain this change** — hover any diff to see model reasoning.
- **Try variations** — request multiple approaches, see them rendered side-by-side, pick one. Composes with multi-model routing (Claude vs GPT vs Gemini variations).
- **Continuous mini-triage** — Haiku-class background pass on new comments produces "since you last looked" summaries at the top of the deck view.

---

## 10. Brand kits

A first-class subsystem. Each kit is a versioned package containing:

- **Identity** — logos and marks in all variants (full color, mono, light bg, dark bg, favicon)
- **Design tokens** — colors, type scale, spacing, radius, motion, as named tokens (`brand.color.primary`, `brand.type.display.size`). AI generates with token names, not hex codes.
- **Voice** — short structured prose injected into AI system prompts during editing. Tone, terminology, dos and don'ts.
- **Pattern library** — saved HTML/CSS snippets approved as on-brand. Acts as a quality floor: the AI starts from these for new slides rather than inventing layouts. Built organically via "save as pattern" on great slides.
- **Reference materials** — uploaded source materials (brand PDFs, marketing screenshots, photography references). Used by humans (browse) and AI (vision-read during edits).

### Inheritance

Decks bind to a specific kit version (`acme-co@2.1.0`). Deck-level `theme.json` can override individual tokens. The bundler resolves inheritance at render time.

### Workflows

- **New kit from PDF** — upload brand guidelines, AI proposes initial tokens and voice rules from the PDF, human reviews and confirms. Saves an hour of manual setup per kit.
- **Save as pattern** — promote a great slide layout to the pattern library; parameterize the variable parts.
- **Kit version upgrade** — bumping a deck to a newer kit version is an explicit action with a preview of what would change.
- **Brand fit score** — periodic AI check flagging slides that have drifted from the kit.

---

## 11. Triage & feedback

Carries forward the two-phase map/reduce pipeline from the current system, with changes.

### Pipeline

- **Per-slide map** (Haiku, parallel, concurrency 4) — clusters comments into themes, proposes concrete changes with type (copy/design/data/structure/add_slide/remove_slide/other) and effort (small/medium/large) tags, surfaces conflicts.
- **Deck rollup** (Sonnet) — executive summary, ranked backlog (impact × consensus), per-commenter summary.

### Changes from the existing system

- **Copilot prompts removed.** With the in-platform AI editor, the rollup no longer emits standalone editing instructions. Instead it produces structured edit proposals that can be sent directly to the AI editor as agentic-mode tasks: one click, "send to editor."
- **Element-level comments supported.** Triage receives both slide-level and element-level comments. Element-level comments carry a slide id plus an element reference (CSS selector or anchor coordinates). The triage prompts are extended to handle this granularity.
- **Conflict surfacing as a first-class output.** When two reviewers contradict each other, the conflict appears in its own UI section rather than buried in the backlog. Forces a decision.
- **Continuous mini-triage** — cheap Haiku pass producing "since you last looked" summaries on every deck view, throttled.

### Comment status workflow

`open → in_review → planned → done → dismissed`. Statuses set by BIP team in admin portal. Each comment supports admin-only notes and @-mentions of team members (mentions create an inbox entry on the mentioned person's dashboard).

### Reviewer roster

Sidebar on each deck showing who's invited, when they last engaged, comment count, and state (`not opened` / `viewed no comment` / `commented N times`). Useful for nudging quiet reviewers.

---

## 12. Analytics

### Event model

A single `view_events` table with rows for every meaningful interaction:

- `link_opened`
- `slide_viewed` (with `slide_id`, timestamp)
- `slide_dwell` (periodic, with `slide_id`, `duration_ms`)
- `navigated_back`
- `reached_end`
- `download_attempted`
- `comment_left` (cross-references comment id)
- `link_rolled_forward` (admin event, surfaces on viewer timeline)

Every event carries `link_id`, `viewer_session_id`, `timestamp`, event-specific metadata. Viewer session is anonymous UUID for public links, email-keyed for email-gated and coded links.

### Dashboard (v1)

Per deck:
- Total views, unique viewers, average session time
- Per-slide dwell heatmap
- Completion rate
- Last 10 view events with viewer identity where known

Per link:
- Same scoped to one link
- Roll-forward markers on the timeline
- Comparison view across linked recipients (e.g. "VC A vs VC B engagement")

The schema is designed to be richer than the dashboard. New charts and views can be added later without backfilling.

---

## 13. Open questions

Deferred to later planning conversations:

- **Element-level commenting mechanics.** Figma-style pin-on-canvas is the target UX. Hit testing on slide elements, anchor coordinates in scaled iframe, persistence across slide edits, UI for placing and resolving pins. Needs UX prototyping plus technical design.
- **Outline-first generation flow.** Conversational structure for the outline stage, deliverable shape (manifest + slide stubs), handoff to draft stage. Important — this is a core differentiator of the platform.
- **Notification system.** Email digests for clients on new comments, in-app notifications for team members on @-mentions and assignments. Scope, channels, throttling rules.
- **PDF export visual fidelity.** Headless Chromium at 1280×720 works for most cases but interactive elements and animations need a fallback rendering strategy.
- **Data model.** Concrete Postgres schema for the entities in this doc. Next planning conversation.

---

## Appendix A: Glossary

| Term | Meaning |
|---|---|
| Deck | One presentation. Directory of files on disk, bundled to HTML at view time. |
| Slide | One section of a deck. `<section class="slide sN">` in the bundled output. |
| Brand kit | Reusable, versioned package of design tokens, identity, voice, patterns. |
| Share link | Typed access grant pointing to a deck. Five sub-types in §8. |
| Snapshot | A git tag on a deck repo. Auto-created when a deck enters `final`. |
| Roll-forward | Repointing a snapshot share link to a newer commit. |
| Working branch | A git branch the AI agent writes proposed edits to. Merged to main on accept. |
| Proposal mode | AI editor mode where edits go to working branch for human review before merging. |
| Continuous mini-triage | Cheap, frequent AI summarization of new comments. Different from the heavy explicit triage. |
| Pattern | A saved HTML/CSS snippet in a brand kit's pattern library. |
