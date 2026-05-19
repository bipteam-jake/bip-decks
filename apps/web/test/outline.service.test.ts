// Outline service tests (Phase 2.5). Real Postgres + real git repos in a
// tmp dir; ANTHROPIC_API_KEY is forced to 'mock' so the gateway returns the
// deterministic 5-slide outline.

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TMP_REPOS = mkdtempSync(path.join(tmpdir(), 'bip-outline-test-'));
process.env.DECK_REPOS_PATH = TMP_REPOS;
process.env.ANTHROPIC_API_KEY = 'mock';

import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/auth/service';
import { createDeck } from '@/lib/decks/service';
import {
  approveOutline,
  buildOutlineFiles,
  createOutlineConversation,
  editOutline,
  findLatestOutline,
  getOutlineConversation,
  postOutlineMessage,
} from '@/lib/outline/service';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { Deck, User } from '@bip/db';
import type { OutlineBrief } from '@bip/ai-gateway';

const TEST_TAG = '+outlinevitest@bip.test';
const TEST_SLUG_PREFIX = 'ovt-';

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${TEST_TAG}`;
}
function uniqueTitle(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function makeUser(label = 'author'): Promise<User> {
  return createUser({
    email: uniqueEmail(label),
    name: `Outline Test ${label}`,
    password: 'correct-horse-battery-staple-42',
  });
}

async function makeDeck(creator: User): Promise<Deck> {
  return createDeck({ title: uniqueTitle('deck') }, creator);
}

function brief(overrides: Partial<OutlineBrief> = {}): OutlineBrief {
  return {
    title: 'Outline Test Deck',
    audience: 'CTO of a mid-market retail client',
    goal: 'Get approval to begin a 6-week discovery engagement',
    talkingPoints: 'Why now, our approach, expected outcomes, next steps.',
    ...overrides,
  };
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
});

afterEach(async () => {
  await prisma.aIMessage.deleteMany({
    where: { conversation: { deck: { slug: { startsWith: TEST_SLUG_PREFIX } } } },
  });
  await prisma.aIConversation.deleteMany({
    where: { deck: { slug: { startsWith: TEST_SLUG_PREFIX } } },
  });
  await prisma.deck.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_TAG } } });
});

afterAll(() => {
  rmSync(TMP_REPOS, { recursive: true, force: true });
});

describe('createOutlineConversation', () => {
  it('persists the brief as the first user message and runs the first AI turn', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const result = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });

    expect(result.conversation.kind).toBe('OUTLINE');
    expect(result.conversation.title).toBe('Outline Test Deck');
    expect(result.conversation.approvedAt).toBeNull();
    expect(result.messages).toHaveLength(2);

    const [first, second] = result.messages;
    expect(first!.role).toBe('USER');
    const firstContent = first!.content as Record<string, unknown>;
    expect(firstContent.kind).toBe('brief');
    expect((firstContent.brief as OutlineBrief).audience).toContain('CTO');

    expect(second!.role).toBe('ASSISTANT');
    const secondContent = second!.content as Record<string, unknown>;
    expect(secondContent.kind).toBe('assistant');
    const payload = secondContent.payload as { kind: string; outline: { slides: unknown[] } };
    expect(payload.kind).toBe('outline');
    expect(payload.outline.slides).toHaveLength(5);
  });

  it('rejects a second outline conversation on the same deck', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    await expect(
      createOutlineConversation({ deckId: deck.id, user, brief: brief() }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('postOutlineMessage', () => {
  it('appends user + assistant turns to the conversation', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    const after = await postOutlineMessage({
      conversationId: initial.conversation.id,
      user,
      text: 'Add a slide about pricing.',
    });
    expect(after.messages).toHaveLength(4);
    expect(after.messages[2]!.role).toBe('USER');
    expect(after.messages[3]!.role).toBe('ASSISTANT');
  });

  it('rejects empty messages with ValidationError', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    await expect(
      postOutlineMessage({ conversationId: initial.conversation.id, user, text: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('approveOutline', () => {
  it('writes one html stub per slide, updates deck.json, advances stage to DRAFT', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });

    const result = await approveOutline({ conversationId: initial.conversation.id, user });

    expect(result.slideCount).toBe(5);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.deck.lifecycleStage).toBe('DRAFT');
    expect(result.deck.headCommitSha).toBe(result.commitSha);

    // Slide files exist on disk
    for (const id of ['s1', 's2', 's3', 's4', 's5']) {
      const p = path.join(deck.repoPath, 'slides', `${id}.html`);
      expect(existsSync(p), `slides/${id}.html`).toBe(true);
      const html = readFileSync(p, 'utf8');
      expect(html).toContain(`data-slide-id="${id}"`);
      expect(html).toContain('<!--');
    }

    // deck.json manifest reflects the outline
    const manifest = JSON.parse(readFileSync(path.join(deck.repoPath, 'deck.json'), 'utf8'));
    expect(manifest.slides).toHaveLength(5);
    expect(manifest.slides.map((s: { id: string }) => s.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
    ]);

    // Conversation now marked approved
    const fetched = await getOutlineConversation(initial.conversation.id);
    expect(fetched.conversation.approvedAt).not.toBeNull();
  });

  it('rejects a second approve on the same conversation', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    await approveOutline({ conversationId: initial.conversation.id, user });
    await expect(
      approveOutline({ conversationId: initial.conversation.id, user }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('buildOutlineFiles', () => {
  it('escapes html in slide titles to prevent injection from outline content', () => {
    const files = buildOutlineFiles('Test Deck', {
      slides: [
        {
          id: 's1',
          title: '<script>alert(1)</script>',
          notes: 'Notes with -- double dash and <em>html</em>.',
        },
      ],
    });
    const html = files['slides/s1.html'];
    expect(html).toBeDefined();
    expect(html!).not.toContain('<script>');
    expect(html!).toContain('&lt;script&gt;');
    // HTML comments cannot contain a literal `--` inside the body; we replace
    // with the en-dash escape, so the rendered body should contain `––`.
    expect(html!).toContain('\u2013\u2013');
  });
});

describe('findLatestOutline', () => {
  it('returns null when no assistant outline payload has been persisted', async () => {
    expect(findLatestOutline([])).toBeNull();
  });
});

describe('editOutline', () => {
  it('persists a manual edit as a USER message and overrides the latest outline', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });

    const after = await editOutline({
      conversationId: initial.conversation.id,
      user,
      outline: {
        slides: [
          { id: 'ignored', title: 'Manual title', notes: 'Manual notes', layoutHint: 'hero' },
          { id: 'ignored2', title: 'Second', notes: 'Second notes' },
        ],
      },
    });

    expect(after.messages).toHaveLength(3);
    const edit = after.messages[2]!;
    expect(edit.role).toBe('USER');
    const content = edit.content as Record<string, unknown>;
    expect(content.kind).toBe('edit');

    const latest = findLatestOutline(after.messages);
    expect(latest).not.toBeNull();
    expect(latest!.slides).toHaveLength(2);
    expect(latest!.slides[0]!.id).toBe('s1');
    expect(latest!.slides[0]!.title).toBe('Manual title');
    expect(latest!.slides[1]!.id).toBe('s2');
  });

  it('rejects an empty outline with ValidationError', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    await expect(
      editOutline({
        conversationId: initial.conversation.id,
        user,
        outline: { slides: [] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('approve uses the edited outline (not the AI draft)', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    await editOutline({
      conversationId: initial.conversation.id,
      user,
      outline: {
        slides: [{ id: 's1', title: 'Only slide', notes: 'Only notes' }],
      },
    });
    const result = await approveOutline({ conversationId: initial.conversation.id, user });
    expect(result.slideCount).toBe(1);
    const manifest = JSON.parse(readFileSync(path.join(deck.repoPath, 'deck.json'), 'utf8'));
    expect(manifest.slides).toEqual([
      expect.objectContaining({ id: 's1', title: 'Only slide', notes: 'Only notes' }),
    ]);
  });

  it('rejects edits to an already-approved outline', async () => {
    const user = await makeUser();
    const deck = await makeDeck(user);
    const initial = await createOutlineConversation({ deckId: deck.id, user, brief: brief() });
    await approveOutline({ conversationId: initial.conversation.id, user });
    await expect(
      editOutline({
        conversationId: initial.conversation.id,
        user,
        outline: { slides: [{ id: 's1', title: 't', notes: 'n' }] },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
