// Vitest setup: load env vars from the repo root .env.local before any test
// imports modules that read process.env (notably the SESSION_SECRET getter).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotenv(file: string): void {
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return; // file missing — fall back to existing env
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotenv(resolve(__dirname, '../../../.env.local'));

// Tests must have a session secret to validate tokens deterministically.
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET =
    'test-only-session-secret-do-not-use-in-production-aaaaaaaaaaaaaaaaaaaaa';
}
