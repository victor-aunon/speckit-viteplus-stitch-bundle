import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const scriptPath = path.resolve(__dirname, '../scripts/repair-loop-guard.sh');

/** Run a script and return `{ status, stdout, stderr }` without throwing. */
function runScript(
  script: string,
  args: string[],
  cwd: string
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = runBash(script, args, { cwd, stdio: 'pipe' }) as string;
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

  /** Run the shipped guard from `scripts/`. */
  const runGuard = (args: string[], cwd: string = tempDir) =>
    runScript(scriptPath, args, cwd);

  /** Run an arbitrary guard copy (used to simulate a partial install). */
  const runGuardWith = (script: string, args: string[]) =>
    runScript(script, args, tempDir);

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

  const readTelemetry = (): any[] => {
    const file = path.join(tempDir, '.specify/telemetry.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  it('emits a repair_window event with the measured duration', () => {
    // Nothing else measures this span: a real run wrote no `repair_agent` step
    // event at all, so nearly three hours of repair were unattributed.
    initRepo();
    expect(runGuard(['--snapshot', '--step=repair_agent'], tempDir).status).toBe(0);
    write('tracked.txt', 'a\nb\n');
    expect(runGuard(['--assess', '--step=repair_agent'], tempDir).status).toBe(0);

    const event = readTelemetry().find((entry) => entry.event === 'repair_window');
    expect(event).toBeDefined();
    expect(event.step).toBe('repair_agent');
    expect(event.status).toBe('end');
    expect(typeof event.duration_ms).toBe('number');
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('emits the window even when the iteration stalled', () => {
    // A stalled window is exactly the one worth measuring, so the emission must
    // not sit behind the progress verdict.
    initRepo();
    runGuard(['--snapshot'], tempDir);
    expect(runGuard(['--assess'], tempDir).status).toBe(1);

    const events = readTelemetry().filter((entry) => entry.event === 'repair_window');
    expect(events).toHaveLength(1);
  });

  it('keeps the two loops distinguishable by --step', () => {
    initRepo();
    runGuard(['--snapshot', '--step=verdict_repair_agent'], tempDir);
    write('tracked.txt', 'a\nb\n');
    runGuard(['--assess', '--step=verdict_repair_agent'], tempDir);

    const event = readTelemetry().find((entry) => entry.event === 'repair_window');
    expect(event.step).toBe('verdict_repair_agent');
  });

  it('still measures the window outside a git work tree', () => {
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    expect(runGuard(['--assess'], tempDir).status).toBe(0);

    const event = readTelemetry().find((entry) => entry.event === 'repair_window');
    expect(event).toBeDefined();
  });

  it('never lets telemetry change the verdict or the exit code', () => {
    // Point SCRIPT_DIR at a guard copy with no emit-telemetry.sh beside it: the
    // step must still return the stall verdict instead of failing.
    const isolated = path.join(tempDir, 'isolated');
    fs.mkdirSync(isolated, { recursive: true });
    fs.copyFileSync(scriptPath, path.join(isolated, 'repair-loop-guard.sh'));
    initRepo();

    const snapshot = runGuardWith(path.join(isolated, 'repair-loop-guard.sh'), ['--snapshot']);
    expect(snapshot.status).toBe(0);
    const assessed = runGuardWith(path.join(isolated, 'repair-loop-guard.sh'), ['--assess']);
    expect(assessed.status).toBe(1);
    expect(assessed.stdout).toContain('REPAIR LOOP STALLED');
  });

  it('keeps its state out of the project git history', () => {
    // The managed `.specify/.gitignore` covers only `feature.json` and the
    // extension overrides, so the state was fully committable.
    // `bootstrap-project-env.sh` runs `git add .specify` on every repair
    // iteration, and a real run left six identical
    // `chore: baseline specify tooling snapshot` commits whose entire content
    // was this directory plus `.circuit-breaker-state`.
    initRepo();

    expect(runGuard(['--snapshot']).status).toBe(0);

    const ignoreFile = path.join(tempDir, '.specify/.repair-loop/.gitignore');
    expect(fs.existsSync(ignoreFile)).toBe(true);
    expect(fs.readFileSync(ignoreFile, 'utf8').trim()).toBe('*');

    // Nothing the guard wrote may be stageable, so no future `git add .specify`
    // can resurrect the bookkeeping into a commit.
    git(tempDir, ['add', '-A']);
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(staged.trim()).toBe('');
  });

  it('writes the ignore file on every verb that creates the state dir', () => {
    // `--assess` also mkdirs the state dir (for reason.txt), and a missing ignore
    // there would let a stalled window commit its own diagnosis.
    initRepo();
    expect(runGuard(['--snapshot']).status).toBe(0);
    fs.rmSync(path.join(tempDir, '.specify/.repair-loop/.gitignore'));

    const assessed = runGuard(['--assess']);

    expect(assessed.status).toBe(1);
    expect(
      fs.readFileSync(path.join(tempDir, '.specify/.repair-loop/.gitignore'), 'utf8').trim()
    ).toBe('*');
  });

  it('--reset clears the window state too', () => {
    initRepo();
    runGuard(['--snapshot'], tempDir);
    expect(fs.existsSync(path.join(tempDir, '.specify/.repair-loop/window-start'))).toBe(true);
    runGuard(['--reset'], tempDir);
    expect(fs.existsSync(path.join(tempDir, '.specify/.repair-loop/window-start'))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, '.specify/.repair-loop/window-step'))).toBe(false);
  });

  it('counts a commit as progress', () => {
    // `git status` and `git diff HEAD` are BOTH empty once the agent commits, so
    // a window that ended in a commit used to look identical to one that did
    // nothing. A real run reported "stalled" after a 13-minute window that had
    // fixed things, and the loop stopped right after its best iteration.
    initRepo();
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);

    write('tracked.txt', 'a\nb\n');
    git(tempDir, ['add', '-A']);
    git(tempDir, ['commit', '-qm', 'fix: real work']);

    const { status, stdout } = runGuard(['--assess'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('changed the working tree');
  });

  it('still reports a stall when nothing happened at all', () => {
    initRepo();
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    expect(runGuard(['--assess'], tempDir).status).toBe(1);
  });

  it('handles a repository with no HEAD and no changes', () => {
    git(tempDir, ['init', '-q', '.']);
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'a\n', 'utf8');
    expect(runGuard(['--snapshot'], tempDir).status).toBe(0);
    expect(runGuard(['--assess'], tempDir).status).toBe(1);
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
