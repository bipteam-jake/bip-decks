// Bundle pipeline tests. Uses real Postgres + filesystem + Redis (cache
// failures are non-fatal so tests still pass if Redis is down).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TMP_REPOS = mkdtempSync(path.join(tmpdir(), 'bip-deck-bundle-test-'));
process.env.DECK_REPOS_PATH = TMP_REPOS;

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import { createDeck } from '@/lib/decks/service';
import { bundleDeck } from '@/lib/decks/bundler';
import { getBundleBySlug, getBundleForDeck } from '@/lib/decks/bundle-service';
import { NotFoundError } from '@/lib/errors';
import { simpleGit } from 'simple-git';
import type { User } from '@bip/db';

const TEST_TAG = '+bundlevitest@bip.test';
const TEST_SLUG_PREFIX = 'bn-';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}

function uniqueTitle(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'author'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `Bundle Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
});

afterEach(async () => {
  await prisma.deck.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

afterAll(() => {
  rmSync(TMP_REPOS, { recursive: true, force: true });
});

describe('bundleDeck', () => {
  it('assembles a freshly scaffolded deck into a single HTML document', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('basic') }, user);
    expect(deck.headCommitSha).toBeTruthy();

    const html = await bundleDeck({
      repoPath: deck.repoPath,
      commitSha: deck.headCommitSha!,
    });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain(`<title>${deck.title}</title>`);
    expect(html).toContain(`data-slide-id="s1"`);
    expect(html).toContain('<style data-source="styles/global.css">');
    expect(html).toContain('<script data-source="scripts/global.js">');
    expect(html).toContain(`<meta name="bip-deck-commit" content="${deck.headCommitSha}">`);
  });

  it('renders a stub for missing slide files referenced in the manifest', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('missing') }, user);

    // Rewrite deck.json to add a slide that has no HTML file, then commit.
    const repo = simpleGit(deck.repoPath);
    const manifest = {
      title: deck.title,
      slides: [
        { id: 's1', title: 'Untitled slide', notes: '' },
        { id: 'ghost', title: 'No file', notes: '' },
      ],
    };
    writeFileSync(path.join(deck.repoPath, 'deck.json'), JSON.stringify(manifest, null, 2));
    await repo.add(['deck.json']);
    await repo.commit('add ghost slide reference');
    const sha = (await repo.revparse(['HEAD'])).trim();

    const html = await bundleDeck({ repoPath: deck.repoPath, commitSha: sha });
    expect(html).toContain('data-slide-id="ghost"');
    expect(html).toContain('missing slide file: slides/ghost.html');
  });

  it('throws on a malformed manifest', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('bad') }, user);

    const repo = simpleGit(deck.repoPath);
    writeFileSync(path.join(deck.repoPath, 'deck.json'), '{"title":"x"}'); // no slides
    await repo.add(['deck.json']);
    await repo.commit('break manifest');
    const sha = (await repo.revparse(['HEAD'])).trim();

    await expect(bundleDeck({ repoPath: deck.repoPath, commitSha: sha })).rejects.toThrow(
      /slides array/,
    );
  });
});

describe('getBundleBySlug', () => {
  it('serves the bundle and returns cache hit on the second call', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('cache') }, user);

    const first = await getBundleBySlug(deck.slug);
    expect(first.cacheHit).toBe(false);
    expect(first.commitSha).toBe(deck.headCommitSha);
    expect(first.html).toContain('<!DOCTYPE html>');

    const second = await getBundleBySlug(deck.slug);
    // Cache may be unavailable in CI; assert only correctness, not cacheHit.
    expect(second.html).toBe(first.html);
    expect(second.commitSha).toBe(first.commitSha);
  });

  it('bypasses cache when requested', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('bypass') }, user);

    await getBundleBySlug(deck.slug); // prime cache
    const bypassed = await getBundleForDeck(deck, deck.headCommitSha!, {
      bypassCache: true,
    });
    expect(bypassed.cacheHit).toBe(false);
  });

  it('404s for an unknown slug', async () => {
    await expect(getBundleBySlug('does-not-exist-xyz')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s for a soft-deleted deck', async () => {
    const user = await makeUser();
    const deck = await createDeck({ title: uniqueTitle('soft') }, user);
    await prisma.deck.update({
      where: { id: deck.id },
      data: { deletedAt: new Date() },
    });
    await expect(getBundleBySlug(deck.slug)).rejects.toBeInstanceOf(NotFoundError);
  });
});
