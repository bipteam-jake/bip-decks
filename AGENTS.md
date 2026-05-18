# AGENTS.md — bip-dashboards

This file is the source of truth for cross-cutting conventions. Both human
contributors and AI coding agents (Copilot, Claude, etc.) must follow these
rules. Keep it short and prescriptive.

---

## 1. Verification gate

Before finishing any change, all three of these must pass:

```bash
npx tsc --noEmit         # type errors
npm run lint:responsive  # mobile responsiveness gate (see §3)
```

(There is no ESLint config — `tsc` is the type gate.)

## 2. UI primitives & forbidden APIs

These rules already exist; do not regress them.

- **No native `<select>`, `<input type="date">`, `<input type="checkbox">`** in
  `src/app/**`. Use `Combobox`, `DatePicker`, `Checkbox` from
  `src/components/ui/*`. They emit hidden inputs via the `name` prop, so they
  drop into existing `FormData` server actions.
- **No `window.confirm` / `window.alert` / `confirm()` / `alert()`.** Use
  `ConfirmButton` from `@/components/ui/confirm-button` and `toast` from
  `@/components/ui/sonner`.
- **No custom `fixed inset-0` modals.** Use `ResponsiveDialog` from
  `@/components/ui/responsive-dialog` (Dialog on `md:+`, bottom Sheet on
  mobile) or `Dialog` / `Sheet` directly.
- **No raw `<table>` outside `src/components/data-table/`.** Use the shadcn
  `Table` from `@/components/ui/table` (auto-wrapped in `TableScroll`) or
  `DataTable` from `@/components/data-table/data-table`. If you must use a
  raw `<table>`, wrap it in `TableScroll` from
  `@/components/data-table/table-scroll`.

## 3. Mobile-first UI conventions

The app is **desktop-first in design** and **mobile-responsive in
implementation**. Every page must be usable on a 375px-wide phone.

### Required patterns

- **Default to one column.** Multi-column grids must start at
  `grid-cols-1` and add larger column counts at `sm:` (640px), `md:` (768px),
  `lg:` (1024px), or `xl:` (1280px). Examples:
  - ✅ `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`
  - ❌ `grid grid-cols-3 gap-3` (no responsive prefix)
  - ❌ `grid grid-cols-2` (acceptable only if every cell is < 160px on a
    375px viewport — usually not)
- **Use Tailwind for layout, never inline `style`.** Forbidden:
  `style={{ width|minWidth|maxWidth|height: ... }}` for layout in
  `src/app/**` and `src/components/**`. Allowed:
  - `src/components/charts/**` (height needs to be parameterised).
  - Dynamic data-driven fills (e.g. progress-bar `style={{ width: '${pct}%' }}`).
- **Fixed `min-w-[..rem|..px]` and `max-w-[..rem|..px]` need a responsive
  sibling.** Either change with breakpoint or use a different unit. Examples:
  - ✅ `min-w-0 sm:min-w-[12rem] md:min-w-[16rem]`
  - ✅ `max-w-[12rem] truncate sm:max-w-[18rem]`
  - ❌ `min-w-[16rem]` (forces 256px on a 375px phone)
- **Flex children that hold long text need `min-w-0`** so they can shrink
  and `truncate` works. Same for the parent of a sticky-flex sidebar layout.
- **Wide tables.** Two patterns:
  - **Admin / power-user tables** → use shadcn `Table` (auto-scrolls
    horizontally, fade hint included).
  - **User-facing tables** (portfolio, approvals, dashboards) → pass
    `mobileCard={(row) => …}` to `DataTable` so each row collapses into a
    stacked card below `sm:`.
- **Modals & confirmations** → `ResponsiveDialog`. Centered on desktop,
  bottom Sheet on phones.
- **Filter bars.** Use `FilterBar` + `FilterField` from
  `@/components/filters/filter-bar`. `FilterField` defaults to
  full-width on mobile and only enforces a `min-w` at `sm:+`. Do not pass
  `min-w-[..]` overrides without a responsive prefix.
- **Charts.** Always `<ChartCard>` from `@/components/charts/chart`.
  It auto-caps height at `60vh` on phones via `min(Hpx, 60vh)`.
- **Touch targets.** Buttons and tap targets should be ≥ 36px tall (`size="sm"`
  is fine; do not go smaller for tappable controls).
- **Avoid `w-screen` / `h-screen`** outside the root app shell
  (`src/app/(app)/layout.tsx`, `src/components/app-shell/**`).

### Breakpoint reference (Tailwind defaults — do NOT change)

| Prefix | min-width | Target            |
|--------|-----------|-------------------|
| (none) | 0         | Phone (≥ 375px)   |
| `sm:`  | 640px     | Large phone       |
| `md:`  | 768px     | Tablet            |
| `lg:`  | 1024px    | Desktop           |
| `xl:`  | 1280px    | Large desktop     |
| `2xl:` | 1536px    | Wide monitor      |

### Manual viewport sweep

Before merging UI changes, eyeball the affected page at:

- **375px** (iPhone SE)
- **768px** (iPad portrait)
- **1280px** (laptop)

Chrome DevTools device toolbar is fine. Look for:
- Horizontal scroll on the page itself (only tables should scroll).
- Text clipped or overflowing its container.
- Buttons or filter chips wrapping into unreadable shapes.
- Modals that don't fit on the screen.

## 4. Data, server actions, and Prisma

- After ANY `prisma/schema.prisma` change: kill the dev server,
  `npx prisma generate`, then restart. Otherwise runtime hits
  `Cannot read properties of undefined (reading 'count')` on new models even
  though `tsc` is clean.
- **Do not run `npm run build` while the dev server is running** — both write
  to `.next/` and corrupt each other. Fix: kill dev, `rm -rf .next`, restart.
- Server actions live next to the route under `actions.ts` (e.g.
  `src/app/(app)/timesheet/actions.ts`). Use `FormData` and the existing
  `Combobox`/`DatePicker` hidden-input pattern.

## 5. When in doubt

Read the closest neighbouring file. If the convention isn't obvious, prefer
the pattern used by the most recently-modified file in the same folder.
