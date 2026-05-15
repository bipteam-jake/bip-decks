# BIP Deck Platform — AI Editor Design (Phase 1)

**Version:** 0.1
**Status:** Living document, companion to architecture, phasing, and data model docs.
**Authoritative on:** how the chat-depth AI editor works in Phase 1.

---

## 0. About this document

This is the design for the AI editor in Phase 1 only. Phase 1 ships *chat depth* (one model, no queue, no agentic mode, no file uploads). The data model is already designed for the bigger system (the `Job` table, `AIConversation`, `AIMessage`) so what we build here slots into that schema cleanly.

This is the most bespoke piece of Phase 1. The other foundation pieces (auth, git, bundling) have well-trodden patterns; the AI editor is the platform's reason to exist and needs to be designed before code is written.

---

## 1. Goals and non-goals

**Goals (Phase 1).**

- A BIP team member can ask Claude to make a change to a deck in natural language.
- The change is rendered as a visual diff (before / after slide previews) for review.
- Accepting commits the change to the deck's main git branch; rejecting discards it.
- Conversation state persists across page reloads.
- The pattern composes into Phase 3's agentic mode without major rework.

**Non-goals (Phase 1).**

- Multiple model providers (Phase 3)
- Agentic depth — multi-step planning (Phase 3)
- File uploads in chat (Phase 3)
- The "Try variations" feature (Phase 3)
- Auto-accept toggle (Phase 2 polish)
- Streaming responses (Phase 2 polish)
- "Explain this change" hover affordance (Phase 2 polish)
- Multi-slide edits in one turn — restricted to single-slide or styles-only edits (Phase 3 relaxes)

---

## 2. The user-facing loop

One turn, in plain language:

1. User is in the deck editor. The left side shows a slide preview iframe. The right side shows the chat panel with conversation history.
2. User types a request: *"Make the hero bullet on slide 4 tighter — drop the second clause."*
3. The chat shows the user's message immediately. Below it, a "thinking..." indicator.
4. After a few seconds, the chat shows Claude's explanation: *"Tightened the bullet — removed 'and unlock new revenue' as the second clause."*
5. Below the explanation, a proposal card appears: a side-by-side preview of slide 4 before and after.
6. User clicks **Accept** → preview iframe on the left refreshes to the new version, proposal card collapses, conversation moves on. **Reject** → proposal card disappears, conversation stays.
7. User can keep chatting. Each new message starts a new turn. Pending proposals must be resolved (accepted or rejected) before the next turn.

---

## 3. Architecture

Phase 1 is intentionally simple. No queue, no worker process, no streaming. The full turn happens inside one API request from the Next.js server to Claude and back.

The flow is six steps:

1. **User sends message.** Saved to `AIMessage`. Deck context assembled.
2. **API calls Claude Sonnet.** System prompt + conversation history + deck context + new user message. Synchronous, single-shot call.
3. **Response parsed and persisted.** Saved to `AIMessage`. If changes are present, a `Job` row is created.
4. **Git work.** API creates a working branch named `ai-{job_id}`, writes the proposed file changes, commits. `Job` status → `AWAITING_REVIEW`. The bundle cache is primed for the new commit.
5. **UI renders visual diff preview.** Two iframes side-by-side: one bundled from `Deck.headCommitSha`, one bundled from the working branch tip. Code-diff toggle available. Accept and Reject buttons.
6. **Accept** → API fast-forwards `main` to the working branch, updates `Deck.headCommitSha`, deletes the working branch, invalidates the cache. `Job` → `DONE`. **Reject** → API deletes the working branch only. `Job` → `CANCELED`.

The git working branch is the single source of truth for the proposed change. The DB stores pointers and metadata, not duplicates of the content.

---

## 4. Context construction

What does Claude see on each turn? The application assembles a fresh context window from current deck state every turn — the deck may have changed since the last turn (the user might have accepted a previous proposal between turns).

**Context sent per turn:**

- **System prompt** (see §6) — role, conventions, output format. Static across turns.
- **Conversation history** — prior `AIMessage` rows in this conversation, in order, as Claude messages. User and assistant only; system prompt isn't part of this.
- **Deck state in current user message** — wrapped in `<deck_state>` tags, prepended to the user's actual request. Contains:
  - The deck manifest (slide IDs, titles, order)
  - The current slide HTML (the one the user is "on" — i.e., visible in the preview iframe)
  - The full `styles/global.css`
  - The full `scripts/global.js` if non-trivial
  - A list of other slide IDs available for reference

The current slide is included verbatim because that's almost always what the edit targets. Other slides are *not* included — if the user references one (*"match slide 3"*), the AI is expected to ask in its explanation for the user to clarify or paste the relevant slide. Phase 3 tools will fix this; Phase 1 lives with the limitation.

**What's not in context:**

- Other slides' HTML
- Brand kit (doesn't exist in Phase 1)
- Comments on the deck (separate flow)
- Asset binary content (only paths/names)

---

## 5. The system prompt

Drafted out. Lives in code as a constant, edited via PR.

```
You are a senior pitch-deck editor working on bespoke HTML/CSS/JS presentations
for the BIP team. Decks are decomposed into a manifest (deck.json), per-slide
HTML files in slides/, and shared styles and scripts.

You receive a user request along with the current state of the deck, focused on
the slide the user is editing. Your job is to propose precise, on-brand edits
in response.

OUTPUT FORMAT (strict JSON, no prose outside the JSON):

{
  "explanation": "string, 1-3 sentences describing what you did or why you can't",
  "changes": [
    {
      "file": "relative path within deck (e.g. slides/s4.html, styles/global.css)",
      "operation": "replace" | "create",
      "content": "string, full new content of the file"
    }
  ]
}

- If you propose no changes (e.g. answering a question, declining, asking for
  clarification), omit the "changes" field. Keep "explanation" short.
- If you propose changes, include the FULL new file content, not a diff.
- Only edit slide files and shared styles. Do not edit the manifest or assets.
- Do not change classes or IDs other code depends on without checking.
- Keep HTML minimal and semantic; reuse existing classes from global styles when
  possible.
- If you need information you don't have (e.g. the content of another slide),
  say so in "explanation" and propose no changes.
- Never produce malformed JSON. Never wrap the JSON in markdown code fences.

CONVENTIONS:
- Slide files contain a single <section class="slide sN"> with their content.
- Global styles use CSS custom properties on :root for the brand palette.
- Per-slide CSS prefixes class names with the slide id (e.g. .s4__card).
```

The prompt is short on purpose. The schema does the heavy lifting; behavioral nuance lives in the prompt only when the schema can't enforce it.

---

## 6. Response format

The application expects strict JSON matching this TypeScript shape:

```typescript
type AIEditResponse = {
  explanation: string;
  changes?: Array<{
    file: string;
    operation: "replace" | "create";
    content: string;
  }>;
};
```

**Validation rules (application-side, before writing anything):**

- `explanation` is required and non-empty.
- If `changes` is present, every entry must have a `file` path that:
  - Is relative (no leading `/`)
  - Is within the deck directory (no `..`)
  - Is in an editable subdirectory (`slides/`, `styles/`, `scripts/`)
  - Does not target `deck.json` (manifest is system-managed)
- For `operation: "replace"`, the file must already exist.
- For `operation: "create"`, the file must not already exist.
- `content` for slide files must contain a `<section class="slide ...">` element.

If validation fails, the application returns an error in chat (*"Claude proposed a change to a file path I can't write to. Try rephrasing?"*), marks the `Job` `FAILED`, and stops.

---

## 7. Proposal mechanics

The application turns a validated `AIEditResponse` with `changes` into a git commit on a working branch.

**Branch naming.** `ai-{job_id}`. UUID, no collisions, easy to find and clean up.

**Steps inside the API request:**

1. Acquire the deck's edit lock (§10). If not available, return an error.
2. `git checkout -b ai-{job_id} {deck.head_commit_sha}` in the deck's repo.
3. For each change in the response:
   - Replace or create the file as specified.
4. `git add -A && git commit -m "[ai] {short summary from explanation}"`. The commit message starts with `[ai]` so history is greppable.
5. `Job.workingBranch = "ai-{job_id}"`, `Job.status = AWAITING_REVIEW`, save.
6. Prime the bundle cache for the working branch commit (so the diff preview is fast).
7. Return the job to the client.

**Accept (separate API call when user clicks Accept):**

1. Re-acquire the lock briefly.
2. Verify `Deck.headCommitSha` hasn't moved since the working branch was created. If it has — which shouldn't happen with the lock, but defense in depth — abort and surface a conflict error.
3. `git checkout main && git merge --ff-only ai-{job_id}`.
4. Update `Deck.headCommitSha`.
5. `git branch -d ai-{job_id}`.
6. Invalidate any cache entries keyed by the old head SHA.
7. `Job.status = DONE`, save.

**Reject:**

1. `git branch -D ai-{job_id}` (force-delete; branch may be ahead of main).
2. `Job.status = CANCELED`, save.

**Iterating on the same proposal.** Phase 1 keeps it simple: if the user sends a new message while a proposal is pending, the pending proposal is auto-rejected (working branch deleted, `Job` `CANCELED` with a `superseded_by` marker on the related message). The new message starts a fresh turn. The UI warns before doing this so the user can confirm or step back. Phase 2 may add an explicit "iterate" button that keeps the branch alive and builds on it.

---

## 8. Visual diff preview UI

The proposal card sits in the chat panel below Claude's explanation message.

**Layout:**
- Two iframes side-by-side, each ~360px wide in the proposal card. Above each: a label ("Before" / "After") with the commit SHA short-hash.
- Below the iframes: tabs for "Visual" (default) and "Code." Code tab shows a unified diff of the changed files using `diff2html` or similar.
- Footer: **Accept** button (primary), **Reject** button (secondary), explanation re-shown in muted text.

**Iframe sourcing.** Both iframes call the deck-runtime endpoint with explicit commit SHAs in the URL — the application allows `?at_commit={sha}` as a query parameter on the runtime route, bypassing the share-link resolver for internal preview use. Bundles are cached per commit-SHA so subsequent renders are instant.

**What if the proposal touches multiple files?** Show the impacted slide(s) in the iframes. For style-only changes, show the slide the user is currently viewing in the editor.

**What if the proposal is style changes that affect every slide?** Phase 1 limits proposals to single-slide HTML or shared styles. For shared styles, the UI shows a banner *"This change affects every slide"* and shows the current slide as the preview.

---

## 9. Editing lock

To prevent two team members from generating proposals against the same deck simultaneously (which would create branch conflicts and confusing UX), Phase 1 implements a soft lock.

**Schema addition to Deck** (to be added in §3.3 of the data model doc as a follow-up):

```prisma
editingUserId       String?  @map("editing_user_id") @db.Uuid
editingHeartbeatAt  DateTime? @map("editing_heartbeat_at")
```

**Behavior.**
- When a user opens the deck editor, the client sends a heartbeat every 30 seconds. The heartbeat sets `editing_user_id` to the current user and updates `editing_heartbeat_at`.
- A lock is considered held if `editing_heartbeat_at > now() - 2 minutes` and `editing_user_id` is set.
- When another user opens the editor while a lock is held by someone else, the UI shows: *"Alice is editing this deck (last activity 45 seconds ago). View only, or take over?"* "Take over" overwrites the lock fields.
- When the user closes or navigates away, the client sends a release call that nulls the fields.
- Stale locks (no heartbeat for 2 minutes) are ignored on lock check.

This is intentionally soft: it doesn't prevent concurrent reads or comments, only protects the AI-edit working-branch flow.

---

## 10. Error handling

| Failure mode | Behavior |
|---|---|
| Claude returns invalid JSON | `Job` → `FAILED`, message in chat: *"I had trouble understanding the model's response. Try rephrasing?"* |
| JSON valid but fails validation rules (§6) | `Job` → `FAILED`, message in chat naming the issue without exposing internals |
| Git operation fails (commit, branch creation) | `Job` → `FAILED`, error logged with full context, generic message in chat |
| Claude API call times out (60s) | `Job` → `FAILED`, message: *"Took too long. Try again or simplify the request."* |
| Validation passes but proposed HTML is malformed | Phase 1: not caught automatically. User sees broken preview and rejects. Phase 2: add a Playwright check post-bundle. |
| Lock held by another user | Reject the message immediately with a clear UI affordance to take over |

Failed jobs stay in the DB and surface in the conversation history as muted entries with a "retry" affordance.

---

## 11. UI layout (editor view)

For reference; the data model and API don't depend on these specifics.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Acme Series A pitch                            [Stage: draft ▾] [⋯] │
├────────────────────────────┬─────────────────────────────────────────┤
│                            │  Conversation                           │
│                            │ ┌─────────────────────────────────────┐ │
│                            │ │ User: tighten the hero bullet       │ │
│   Slide preview iframe     │ │                                     │ │
│   (current head, scaled)   │ │ Claude: Tightened — removed second  │ │
│                            │ │ clause.                             │ │
│                            │ │                                     │ │
│   Slide thumbnails strip   │ │ [PROPOSAL CARD]                     │ │
│   below or on side         │ │  Before │ After  (iframes)          │ │
│                            │ │  Visual │ Code                       │ │
│                            │ │  [Accept] [Reject]                  │ │
│                            │ └─────────────────────────────────────┘ │
│                            │  Depth: Chat ▾                          │
│                            │  ┌─────────────────────────────────┐   │
│                            │  │ Type a request...               │   │
│                            │  └─────────────────────────────────┘   │
└────────────────────────────┴─────────────────────────────────────────┘
```

The depth selector shows "Chat" with a small dropdown caret. In Phase 1 the dropdown is disabled with text *"Quick and Agentic coming soon"*. This is muscle-memory groundwork for Phase 3.

---

## 12. Cost and latency notes

A typical chat-depth turn:
- ~3–10K input tokens (deck context + history)
- ~200–800 output tokens (explanation + small HTML/CSS change)
- ~3–8 seconds end-to-end on Sonnet
- Cost: roughly $0.02–0.06 per turn at current Sonnet pricing

For a real deck-authoring session, expect 20–100 turns. Daily cost per active editor is in the low single dollars. Log every call's `model`, `tokens_in`, `tokens_out`, and `cost_cents` on `AIMessage` so we can see actuals from day one.

---

## 13. Phase 2 and 3 evolution

What this design preserves so future phases extend cleanly:

- **Job table already exists** — Phase 3's BullMQ queue swaps in by changing how jobs run, not the schema.
- **Single editor depth → multiple depths** — the depth selector UI is built; Phase 3 enables Quick and Agentic. Routing logic lives in the API.
- **Single-model → multi-model** — `AIMessage.model` is recorded per call. The AI gateway abstraction (a thin wrapper around Claude in Phase 1) exposes a single internal interface that Phase 3 implements for OpenAI and Google.
- **No tools → tools** — Phase 3 agentic mode introduces tools (`read_slide`, `read_styles`, `read_brand_kit`, etc.). The conversation history schema (`content` as JSON) already supports structured tool calls.
- **Single-slide constraint → multi-slide** — Phase 3 agentic mode produces multi-slide changes; the proposal card already supports rendering multiple before/after iframes.
- **Validation rules in §6** — extended in Phase 2 to allow brand kit references and pattern picks.

Nothing in Phase 1 dead-ends. Every constraint is a deliberate cut, not an architectural lock-in.
