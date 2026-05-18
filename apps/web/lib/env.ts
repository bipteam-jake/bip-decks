// Fail-fast environment loader. Per deployment doc §4: "The app refuses to
// start if a required env var is missing, with a clear error naming what's
// missing." Import this from anywhere that needs a guaranteed-present secret.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example. Copy .env.example -> .env.local and fill in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

// Lazy getters so importing this module doesn't crash at build time when env
// vars aren't present (e.g. `next build` without secrets). Each getter throws
// only when actually called.
export const env = {
  get sessionSecret(): string {
    return required('SESSION_SECRET');
  },
  get appBaseUrl(): string {
    return optional('APP_BASE_URL', 'http://localhost:3000');
  },
  get nodeEnv(): string {
    return optional('NODE_ENV', 'development');
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
  get deckReposPath(): string {
    // Per deployment doc §4 — absolute path to the directory holding one git
    // repo per deck. Bind-mounted in Docker; on host it lives at ./deck-repos.
    return optional('DECK_REPOS_PATH', `${process.cwd()}/deck-repos`);
  },
};
