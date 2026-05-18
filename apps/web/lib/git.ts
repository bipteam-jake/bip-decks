// Single wrapper around simple-git for all deck-repo operations.
//
// Per .github/copilot-instructions.md: "Git operations go through a single
// lib/git.ts wrapper around simple-git. No raw shell-outs to git elsewhere."
//
// Phase 1 surface area:
//   - initRepo: create a new repo on disk with an initial commit
//   - getHeadSha: read the current HEAD commit
//   - removeRepo: delete a repo directory from disk (used by hard-delete cron)

import { spawn } from 'node:child_process';
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
 * Read a single blob's raw bytes at the given commit. Binary-safe variant of
 * `readFileAtCommit` — needed for asset serving where simple-git's string
 * `show()` would corrupt non-UTF-8 payloads (PNG, JPEG, etc.). Spawns
 * `git show {sha}:{relPath}` directly so we can collect stdout as a Buffer;
 * this still lives inside lib/git.ts so the "no raw git outside this file"
 * rule holds. Throws if git exits non-zero (e.g. path missing in commit).
 */
export async function readBlobAtCommit(
  absPath: string,
  commitSha: string,
  relPath: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['show', `${commitSha}:${relPath}`], {
      cwd: absPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`git show exited ${code}: ${Buffer.concat(errChunks).toString()}`));
    });
  });
}

/**
 * List every blob path in the tree at the given commit. Wraps
 * `git ls-tree -r --name-only {sha}`. Returns POSIX-style relative paths.
 */
export async function listFilesAtCommit(absPath: string, commitSha: string): Promise<string[]> {
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

// ---------------------------------------------------------------------------
// AI-editor working-branch ops (ai-editor.md §7)
// ---------------------------------------------------------------------------

export interface ProposalChange {
  /** Repo-relative POSIX path. */
  file: string;
  operation: 'replace' | 'create';
  content: string;
}

export interface CommitProposalInput {
  absPath: string;
  branchName: string;
  /** Commit SHA to branch from (the deck's current head). */
  baseCommitSha: string;
  changes: ProposalChange[];
  message: string;
  author: GitIdentity;
}

export interface CommitProposalResult {
  commitSha: string;
}

/**
 * Create a fresh branch from baseCommitSha, write the proposed file
 * changes, and commit them. Leaves the working tree on the new branch
 * (callers don't depend on tree state — all reads use `git show {sha}:`).
 *
 * Validates replace vs. create existence against the base tree before
 * touching disk, so a violation surfaces as a clean error rather than a
 * partial commit. Path-shape rules (no .., no leading /, editable dirs)
 * are enforced by the response parser; we re-check the absolute-path
 * resolution here as defense in depth.
 */
export async function commitProposalOnBranch(
  input: CommitProposalInput,
): Promise<CommitProposalResult> {
  const { absPath, branchName, baseCommitSha, changes, message, author } = input;
  const git = client(absPath);

  // Pre-flight: replace must exist in the base tree, create must not.
  const baseFiles = new Set(await listFilesAtCommit(absPath, baseCommitSha));
  for (const change of changes) {
    if (change.operation === 'replace' && !baseFiles.has(change.file)) {
      throw new Error(`proposal: replace target does not exist: ${change.file}`);
    }
    if (change.operation === 'create' && baseFiles.has(change.file)) {
      throw new Error(`proposal: create target already exists: ${change.file}`);
    }
    // Defense in depth: ensure resolved path stays inside the repo.
    const resolved = path.resolve(absPath, change.file);
    if (!resolved.startsWith(path.resolve(absPath) + path.sep)) {
      throw new Error(`proposal: path escapes repo: ${change.file}`);
    }
  }

  await git.checkout(['-B', branchName, baseCommitSha]);

  for (const change of changes) {
    const target = path.join(absPath, change.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, change.content, 'utf8');
    await git.add(change.file);
  }

  await git.commit(message, undefined, {
    '--author': `${author.name} <${author.email}>`,
  });
  const sha = (await git.revparse(['HEAD'])).trim();
  return { commitSha: sha };
}

/**
 * Fast-forward `main` to the tip of `branchName`. Throws if the merge isn't
 * a fast-forward — that would indicate `main` moved underneath us, which
 * the AI-editor lock from §9 is meant to prevent. Returns the new HEAD SHA.
 */
export async function fastForwardMain(absPath: string, branchName: string): Promise<string> {
  const git = client(absPath);
  await git.checkout('main');
  await git.merge(['--ff-only', branchName]);
  return (await git.revparse(['HEAD'])).trim();
}

/**
 * Delete a branch. `force: true` uses -D (deletes even if the branch is
 * ahead of main — needed for reject). Switches off the branch first if
 * we're currently on it so the delete is allowed.
 */
export async function deleteBranch(
  absPath: string,
  branchName: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const git = client(absPath);
  const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  if (current === branchName) {
    await git.checkout('main');
  }
  await git.branch([options.force ? '-D' : '-d', branchName]);
}

/** True if a local branch with the given name exists. */
export async function branchExists(absPath: string, branchName: string): Promise<boolean> {
  const git = client(absPath);
  const list = await git.branchLocal();
  return list.all.includes(branchName);
}
