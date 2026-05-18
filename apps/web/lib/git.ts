// Single wrapper around simple-git for all deck-repo operations.
//
// Per .github/copilot-instructions.md: "Git operations go through a single
// lib/git.ts wrapper around simple-git. No raw shell-outs to git elsewhere."
//
// Phase 1 surface area:
//   - initRepo: create a new repo on disk with an initial commit
//   - getHeadSha: read the current HEAD commit
//   - removeRepo: delete a repo directory from disk (used by hard-delete cron)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git';

export interface GitIdentity {
  name: string;
  email: string;
}

export interface InitRepoInput {
  /** Absolute filesystem path where the repo should live. Must not exist. */
  absPath: string;
  /** Identity to record on the initial commit. */
  author: GitIdentity;
  /** Commit message for the initial commit. */
  initialCommitMessage: string;
  /** Files to write (relative path -> string contents) before the initial commit. */
  files: Record<string, string>;
}

export interface InitRepoResult {
  /** SHA of the initial commit. */
  commitSha: string;
}

function client(repoPath: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 1,
  };
  return simpleGit(options);
}

/**
 * Create a new git repo on disk, write the given files, stage them, and make
 * an initial commit authored as the given user. Returns the commit SHA.
 *
 * Refuses to clobber an existing directory — the caller is responsible for
 * picking a unique path (deck slug uniqueness handles this in practice).
 */
export async function initRepo(input: InitRepoInput): Promise<InitRepoResult> {
  const { absPath, author, initialCommitMessage, files } = input;

  // Refuse to clobber. fs.stat throws ENOENT if the path is free.
  try {
    await fs.stat(absPath);
    throw new Error(`Refusing to init repo: path already exists: ${absPath}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await fs.mkdir(absPath, { recursive: true });

  // Write all files first so a single `add .` picks them up.
  for (const [relPath, contents] of Object.entries(files)) {
    const target = path.join(absPath, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  }

  const git = client(absPath);
  // `main` branch by default so we don't depend on host git config.
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.name', author.name, false, 'local');
  await git.addConfig('user.email', author.email, false, 'local');
  await git.add('.');
  await git.commit(initialCommitMessage, undefined, {
    '--author': `${author.name} <${author.email}>`,
  });
  const sha = (await git.revparse(['HEAD'])).trim();
  return { commitSha: sha };
}

/** Read the current HEAD commit SHA of a repo. */
export async function getHeadSha(absPath: string): Promise<string> {
  return (await client(absPath).revparse(['HEAD'])).trim();
}

/**
 * Read a single file's contents at the given commit, without checking the
 * commit out. Wraps `git show {sha}:{relPath}`. Throws if the path doesn't
 * exist in that commit — callers that need optional reads should catch.
 */
export async function readFileAtCommit(
  absPath: string,
  commitSha: string,
  relPath: string,
): Promise<string> {
  return client(absPath).show([`${commitSha}:${relPath}`]);
}

/**
 * List every blob path in the tree at the given commit. Wraps
 * `git ls-tree -r --name-only {sha}`. Returns POSIX-style relative paths.
 */
export async function listFilesAtCommit(
  absPath: string,
  commitSha: string,
): Promise<string[]> {
  const raw = await client(absPath).raw(['ls-tree', '-r', '--name-only', commitSha]);
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Recursively delete a repo directory. No-op if it doesn't exist. Intended
 * for the 30-day hard-delete cron from data-model §3.3 (not in Phase 1
 * deck CRUD, but exposed here so future code uses the same wrapper).
 */
export async function removeRepo(absPath: string): Promise<void> {
  await fs.rm(absPath, { recursive: true, force: true });
}
