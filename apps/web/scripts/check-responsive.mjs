#!/usr/bin/env node
// scripts/check-responsive.mjs
//
// Mobile-first responsiveness gate. Run via `npm run lint:responsive`.
// Greps src/app/** and src/components/** for forbidden patterns documented
// in AGENTS.md §3. Exits 1 when violations are found.
//
// This is intentionally a regex/heuristic gate (no AST) — it must stay fast
// and zero-dependency so it can run in CI without an install step. It will
// produce false positives occasionally; use `// responsive-allow` on the
// same line to silence a known-good case.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { relative } from "node:path";

const ROOT = process.cwd();
const ALLOW_TOKEN = "responsive-allow";

// Files to check.
const TARGET_GLOBS = [
  "app/**/*.ts",
  "app/**/*.tsx",
  "app/**/*.js",
  "app/**/*.jsx",
  "components/**/*.ts",
  "components/**/*.tsx",
  "components/**/*.js",
  "components/**/*.jsx",
];

// Files exempt from a specific rule (relative to repo root).
const EXEMPT = {
  inlineStyle: [
    /^components\/ui\/sidebar\.tsx$/, // sidebar internal sizing
  ],
  rawTable: [
    /^components\/ui\/table\.tsx$/,
  ],
  screenSize: [
    /^app\/\(admin\)\/layout\.tsx$/,
    /^components\/app-shell\//,
    /^components\/main-content-wrapper\.tsx$/,
    /^components\/particle-background\.tsx$/,
    /^components\/ui\/sheet\.tsx$/,
  ],
};

function isExempt(rule, file) {
  return (EXEMPT[rule] ?? []).some((re) => re.test(file));
}

function listFiles() {
  // Use git ls-files so .gitignore is respected and the script stays fast.
  const out = execSync(`git ls-files ${TARGET_GLOBS.map((g) => `'${g}'`).join(" ")}`, {
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

const RULES = [
  {
    name: "grid-cols-without-responsive",
    description:
      "grid-cols-{2..9} without a responsive prefix on the same className. " +
      "Default to grid-cols-1 and add sm:/md:/lg: variants.",
    test(line) {
      // Match a className-ish chunk that contains `grid-cols-N` (N>=2) without
      // any sm:/md:/lg:/xl:/2xl: prefix on the entire line. Allow `grid-cols-1`.
      const m = line.match(/(?<![a-z:-])grid-cols-([2-9])\b/);
      if (!m) return false;
      // If the line also has a responsive prefix grid-cols, treat as OK.
      // Look for `(sm|md|lg|xl|2xl):grid-cols-`.
      if (/\b(sm|md|lg|xl|2xl):grid-cols-/.test(line)) return false;
      return true;
    },
  },
  {
    name: "min-w-fixed-without-responsive",
    description:
      "Fixed min-w-[NNNrem|NNNpx] needs a responsive prefix or sibling " +
      "(e.g. `min-w-0 sm:min-w-[12rem]`).",
    test(line) {
      const m = line.match(/(?<![a-z:-])min-w-\[(\d+(?:\.\d+)?)(rem|px)\]/);
      if (!m) return false;
      // Already has a sm:/md:/lg: prefix on the matched class? Then OK.
      // Find the matched chunk's start and check for `(sm|md|lg|xl|2xl):` immediately
      // before it.
      const idx = line.indexOf(m[0]);
      const before = line.slice(Math.max(0, idx - 6), idx);
      if (/(sm|md|lg|xl|2xl):$/.test(before)) return false;
      // If the same line also has a responsive min-w sibling, treat as OK.
      if (/\b(sm|md|lg|xl|2xl):min-w-\[/.test(line)) return false;
      // tiny fixed values (≤ 8rem / 128px) are usually icons / badges — allow.
      const val = parseFloat(m[1]);
      const px = m[2] === "rem" ? val * 16 : val;
      if (px <= 128) return false;
      return true;
    },
  },
  {
    name: "max-w-fixed-without-responsive",
    description:
      "Fixed max-w-[NNNrem|NNNpx] (>10rem) needs a responsive sibling.",
    test(line) {
      const m = line.match(/(?<![a-z:-])max-w-\[(\d+(?:\.\d+)?)(rem|px)\]/);
      if (!m) return false;
      const idx = line.indexOf(m[0]);
      const before = line.slice(Math.max(0, idx - 6), idx);
      if (/(sm|md|lg|xl|2xl):$/.test(before)) return false;
      if (/\b(sm|md|lg|xl|2xl):max-w-\[/.test(line)) return false;
      const val = parseFloat(m[1]);
      const px = m[2] === "rem" ? val * 16 : val;
      if (px <= 160) return false;
      return true;
    },
  },
  {
    name: "inline-layout-style",
    description:
      "Inline `style={{ width|minWidth|maxWidth|height: ... }}` is forbidden " +
      "for layout. Use Tailwind classes instead.",
    test(line, file) {
      if (isExempt("inlineStyle", file)) return false;
      // Match style={{ ... }} containing a layout key. Be permissive about
      // whitespace inside the braces.
      const styleMatch = line.match(/style=\{\{([^}]*)\}\}/);
      if (!styleMatch) return false;
      const body = styleMatch[1];
      if (!/(\b(width|minWidth|maxWidth|height)\s*:)/.test(body)) return false;
      // Allow when the value itself is a dynamic % string (progress bars).
      if (/(width|height)\s*:\s*`?\$?\{?[^}]*%/.test(body)) return false;
      return true;
    },
  },
  {
    name: "raw-table-outside-primitives",
    description:
      "Raw `<table` outside the data-table primitives. Use the shadcn `Table` " +
      "or wrap in `TableScroll`.",
    test(line, file) {
      if (isExempt("rawTable", file)) return false;
      if (!/<table[\s>]/.test(line)) return false;
      // Heuristic: if the file imports TableScroll, assume it's wrapped.
      // (Per-line check can't see siblings; the import import is enough.)
      return true; // we'll filter file-level below
    },
    // file-level post-filter: returning true skips the rule for the whole file.
    fileFilter(content) {
      return /from\s+["']@\/components\/data-table\/table-scroll["']/.test(content);
    },
  },
  {
    name: "screen-sized-element-outside-shell",
    description:
      "`w-screen` / `h-screen` outside layout/shell files. Use parent-relative " +
      "sizing instead.",
    test(line, file) {
      if (isExempt("screenSize", file)) return false;
      return /(?<![a-z:-])(w-screen|h-screen)(?![a-z-])/.test(line);
    },
  },
];

function checkFile(file) {
  const abs = `${ROOT}/${file}`;
  const content = readFileSync(abs, "utf8");
  const lines = content.split("\n");
  const violations = [];

  // Pre-compute file-level filters. A `fileFilter` returning `true` means
  // the rule SHOULD be skipped for this file (e.g. raw <table> rule is
  // skipped when the file imports TableScroll because the table is wrapped).
  const fileSkip = new Set();
  for (const rule of RULES) {
    if (rule.fileFilter && rule.fileFilter(content)) {
      fileSkip.add(rule.name);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_TOKEN)) continue;
    for (const rule of RULES) {
      if (fileSkip.has(rule.name)) continue;
      try {
        if (rule.test(line, file)) {
          violations.push({ rule: rule.name, line: i + 1, text: line.trim() });
        }
      } catch (err) {
        // never let a bad regex crash the gate
        console.warn(`rule ${rule.name} threw on ${file}:${i + 1}`, err.message);
      }
    }
  }
  return violations;
}

function main() {
  const files = listFiles();
  const all = [];
  for (const f of files) {
    const rel = relative(ROOT, `${ROOT}/${f}`);
    const v = checkFile(f);
    for (const x of v) all.push({ file: rel, ...x });
  }

  if (all.length === 0) {
    console.log(`✓ check-responsive: ${files.length} files, 0 violations`);
    return;
  }

  // Group by rule for readability.
  const byRule = new Map();
  for (const v of all) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }
  for (const [rule, items] of byRule) {
    const desc = RULES.find((r) => r.name === rule)?.description ?? "";
    console.log(`\n✗ ${rule}  (${items.length})`);
    console.log(`  ${desc}`);
    for (const v of items.slice(0, 50)) {
      console.log(`    ${v.file}:${v.line}  ${v.text.slice(0, 140)}`);
    }
    if (items.length > 50) console.log(`    … and ${items.length - 50} more`);
  }
  console.log(
    `\nFix the violations above, or add \`// ${ALLOW_TOKEN}\` on the same line ` +
      `if intentional. See AGENTS.md §3.`,
  );
  process.exit(1);
}

main();
