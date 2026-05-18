// Playwright global setup. Ensures the seeded admin user exists by running
// the repo's seed script with deterministic credentials. Idempotent — the
// seed script skips creation when the user is already present.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const ADMIN_EMAIL = 'admin@bip.local';
export const ADMIN_PASSWORD = 'change-me-immediately';
export const ADMIN_NAME = 'Admin';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** Minimal KEY=VALUE loader for repo-root .env.local. Not a real dotenv —
 * just enough so DATABASE_URL / SESSION_SECRET reach the seed + next dev. */
function loadEnvFile(filePath: string): Record<string, string> {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const rootEnv = loadEnvFile(path.join(repoRoot, '.env.local'));
for (const [k, v] of Object.entries(rootEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

export default async function globalSetup(): Promise<void> {
  execSync('npm run db:seed --silent', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ADMIN_NAME,
    },
  });
}
