import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const scriptPath = path.resolve(__dirname, '../scripts/repair-loop-guard.sh');

/** Run the guard and return `{ status, stdout, stderr }` without throwing. */
function runGuard(
  args: string[],
  cwd: string
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = runBash(scriptPath, args, { cwd, stdio: 'pipe' }) as string;
    return { status: 0, stdout, stderr: '' };
  } catch (error: any) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    };
  }
}

function git(cwd: string, args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args],
    { cwd, stdio: 'ignore' }
  );
}

describe('repair-loop-guard.sh', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-guard-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  const initRepo = (): void => {
    git(tempDir, ['init', '-q', '.']);
    fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'a\n', 'utf8');
    git(tempDir, ['add', '-A']);
    git(tempDir, ['commit', '-qm', 'init']);
  };

  const write = (relative: string, content: string): void => {
    const target = path.join(tempDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };

  it('exists and is executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('documents both verbs in --help', () => {
    const { status, stdout } = runGuard(['--help'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage: repair-loop-guard.sh');
    expect(stdout).toContain('--snapshot');
    expect(stdout).toContain('--assess');
    expect(stdout).toContain('--reset');
  });

  it('rejects an unknown option with exit code 2', () => {
    const { status, stderr } = runGuard(['--nope'], tempDir);
    expect(status).toBe(2);
    expect(stderr).toContain('Unknown option');
  });

  it('reports a stall (exit 1) when the iteration changed nothing', () => {
    initRepo();
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);

    const { status, stdout } = runGuard(['--assess'], tempDir);
    expect(status).toBe(1);
    expect(stdout).toContain('REPAIR LOOP STALLED');

    const reason = path.join(tempDir, '.specify/.repair-loop/reason.txt');
    expect(fs.existsSync(reason)).toBe(true);
    expect(fs.readFileSync(reason, 'utf8')).toContain('NOT repairable');
  });

  it('reports progress (exit 0) when a tracked file is edited', () => {
    initRepo();
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    write('tracked.txt', 'a\nb\n');
    expect(runGuard(['--assess'], tempDir).status).toBe(0);
  });

  it('detects a brand-new untracked file', () => {
    initRepo();
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    write('src/new-module.ts', 'export const x = 1;\n');
    expect(runGuard(['--assess'], tempDir).status).toBe(0);
  });

  it('detects a content edit to an already-untracked file', () => {
    // `git status` lists untracked paths by name only; without hashing their
    // contents an agent that only refines a new file would look stalled.
    initRepo();
    write('src/new-module.ts', 'export const x = 1;\n');
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    write('src/new-module.ts', 'export const x = 2;\n');
    expect(runGuard(['--assess'], tempDir).status).toBe(0);
  });

  it('ignores evidence artifacts rewritten by every gate run', () => {
    // Evidence carries a fresh timestamp on each run. If it counted as progress
    // the guard would never fire, which is worse than not having it.
    initRepo();
    write('specs/001-x/evidence/quality-gate.json', '{"status":"failed"}\n');
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);

    write('specs/001-x/evidence/quality-gate.json', '{"status":"failed","timestamp":"later"}\n');
    write('specs/001-x/evidence/quality-gate.history.jsonl', '{"status":"failed"}\n');
    write('specs/001-x/evidence/nested/deep.json', '{"status":"failed"}\n');

    const { status } = runGuard(['--assess'], tempDir);
    expect(status).toBe(1);
  });

  it('counts generated design artifacts as progress', () => {
    // The repair prompt requires generating designs/ when the visual gate finds
    // no screens. That is a legitimate repair, not bookkeeping.
    initRepo();
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    write('specs/001-x/designs/screen.html', '<html></html>\n');
    expect(runGuard(['--assess'], tempDir).status).toBe(0);
  });

  it('never blocks the loop outside a git work tree', () => {
    const { status, stdout } = runGuard(['--snapshot'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('Not a git work tree');

    const assessed = runGuard(['--assess'], tempDir);
    expect(assessed.status).toBe(0);
  });

  it('lets the loop continue when no baseline was captured', () => {
    initRepo();
    const { status, stdout } = runGuard(['--assess'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('No baseline captured');
  });

  it('--reset clears the stored state', () => {
    initRepo();
    runGuard(['--snapshot'], tempDir);
    expect(runGuard(['--assess'], tempDir).status).toBe(1);

    expect(runGuard(['--reset'], tempDir).status).toBe(0);
    expect(runGuard(['--assess'], tempDir).status).toBe(0);
  });

  it('honours --state-dir', () => {
    initRepo();
    const custom = path.join(tempDir, 'custom-state');
    expect(runGuard(['--snapshot', `--state-dir=${custom}`], tempDir).status).toBe(0);
    expect(fs.existsSync(path.join(custom, 'fingerprint'))).toBe(true);
  });

  it('treats a repository with no commits as a valid baseline', () => {
    // `git diff HEAD` has no HEAD to diff against here; the guard must still
    // work instead of erroring out and blocking the loop.
    git(tempDir, ['init', '-q', '.']);
    fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'a\n', 'utf8');
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);

    const stalled = runGuard(['--assess'], tempDir);
    expect(stalled.status).toBe(1);

    runGuard(['--snapshot'], tempDir);
    write('tracked.txt', 'b\n');
    expect(runGuard(['--assess'], tempDir).status).toBe(0);
  });
});
