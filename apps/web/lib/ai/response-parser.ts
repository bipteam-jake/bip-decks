// Parse and validate Claude's response per docs/bip-deck-platform-ai-editor.md §6.
//
// The system prompt instructs Claude to return strict JSON, but we have to
// assume any tier of malformed output. Two failure modes per §10:
//   - Invalid JSON: chat says "I had trouble understanding the model's response."
//   - JSON valid but fails schema rules: chat says what was wrong, no internals.
//
// This module is pure (no DB, no fs). The caller handles persistence.

import { z } from 'zod';

const EDITABLE_DIRS = ['slides/', 'styles/', 'scripts/'] as const;
const FORBIDDEN_FILES = new Set(['deck.json']);

const ChangeSchema = z.object({
  file: z.string().min(1),
  operation: z.enum(['replace', 'create']),
  content: z.string(),
});

const ResponseSchema = z.object({
  explanation: z.string().min(1, 'explanation is required'),
  changes: z.array(ChangeSchema).optional(),
});

export type AIEditResponse = z.infer<typeof ResponseSchema>;
export type AIEditChange = z.infer<typeof ChangeSchema>;

export type ParseFailure =
  /** Couldn't even JSON.parse the body. */
  | { kind: 'invalid_json'; message: string }
  /** Parsed but didn't match the schema. */
  | { kind: 'schema'; message: string; issues: unknown }
  /** Parsed and schema-valid but violated a structural rule (path, etc.). */
  | { kind: 'rule'; message: string };

export type ParseResult =
  | { ok: true; value: AIEditResponse }
  | { ok: false; failure: ParseFailure };

/**
 * Best-effort JSON extraction. Claude is told never to wrap output in code
 * fences, but in practice it sometimes does. We strip a leading/trailing
 * ```json fence if present; otherwise feed the raw string to JSON.parse.
 */
function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1]! : trimmed;
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function checkPath(file: string): string | null {
  if (file.startsWith('/')) return 'must be a relative path';
  if (file.includes('..')) return 'must not contain ".."';
  if (FORBIDDEN_FILES.has(file)) return 'deck.json is system-managed; not editable by AI';
  if (!EDITABLE_DIRS.some((dir) => file.startsWith(dir))) {
    return `must live under one of ${EDITABLE_DIRS.join(', ')}`;
  }
  return null;
}

/**
 * Apply structural rules from §6 that the Zod schema can't express on its own:
 * path constraints, deck.json ban, slide-file <section> requirement. The
 * existence checks for replace vs. create live in the service layer because
 * they need filesystem access.
 */
function checkRules(response: AIEditResponse): ParseFailure | null {
  if (!response.changes || response.changes.length === 0) return null;
  for (const change of response.changes) {
    const pathErr = checkPath(change.file);
    if (pathErr) {
      return { kind: 'rule', message: `change to "${change.file}": ${pathErr}` };
    }
    if (
      change.file.startsWith('slides/') &&
      !/\<section\b[^>]*class="[^"]*\bslide\b/.test(change.content)
    ) {
      return {
        kind: 'rule',
        message: `slide file "${change.file}" must contain a <section class="slide ..."> element`,
      };
    }
  }
  return null;
}

export function parseClaudeResponse(raw: string): ParseResult {
  const parsed = tryParseJson(raw);
  if (!parsed.ok) {
    return { ok: false, failure: { kind: 'invalid_json', message: parsed.message } };
  }
  const schema = ResponseSchema.safeParse(parsed.value);
  if (!schema.success) {
    return {
      ok: false,
      failure: {
        kind: 'schema',
        message: 'Response did not match the expected shape',
        issues: schema.error.flatten(),
      },
    };
  }
  const ruleErr = checkRules(schema.data);
  if (ruleErr) return { ok: false, failure: ruleErr };
  return { ok: true, value: schema.data };
}

/**
 * Map a parse failure to the user-facing chat message per §10. Stays light
 * on detail to avoid leaking internals.
 */
export function failureToUserMessage(failure: ParseFailure): string {
  switch (failure.kind) {
    case 'invalid_json':
      return "I had trouble understanding the model's response. Try rephrasing?";
    case 'schema':
      return "The model's response wasn't in the expected format. Try rephrasing?";
    case 'rule':
      return `I can't apply that change: ${failure.message}. Try rephrasing?`;
  }
}
