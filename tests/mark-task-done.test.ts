import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const scriptPath = path.resolve(__dirname, '../scripts/mark-task-done.sh');

function runMarker(
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

describe('mark-task-done.sh', () => {
  let root: string;
  let featureDir: string;
  let tasksFile: string;
  let evidenceFile: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mark-task-'));
    featureDir = path.join(root, 'specs', '001-x');
    tasksFile = path.join(featureDir, 'tasks.md');
    evidenceFile = path.join(featureDir, 'evidence', 'quality-gate.json');
    fs.mkdirSync(path.join(featureDir, 'evidence'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      tasksFile,
      ['- [ ] T001 Create the scaffold', '- [ ] T040 [verify:quality] Run the suite'].join('\n') + '\n',
      'utf8'
    );
  });

  afterEach(() => {
    removeDir(root);
  });

  const writeGate = (status: string, ageSeconds = 60): void => {
    fs.writeFileSync(evidenceFile, JSON.stringify({ status, timestamp: new Date().toISOString() }), 'utf8');
    const when = new Date(Date.now() - ageSeconds * 1000);
    fs.utimesSync(evidenceFile, when, when);
  };

  const readTasks = (): string => fs.readFileSync(tasksFile, 'utf8');

  const mark = (id: string, extra: string[] = []) =>
    runMarker([`--id=${id}`, `--feature-dir=${featureDir}`, '--source-roots=src', ...extra], root);

  it('documents the precondition it enforces', () => {
    const help = runMarker(['--help'], root);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--id');
    expect(help.stdout).toMatch(/postdates|STALE|stale/i);
  });

  it('requires --id', () => {
    expect(runMarker([], root).status).toBe(2);
  });

  it('refuses to mark without a passing gate', () => {
    const result = mark('T001');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('without a passing quality gate');
    expect(readTasks()).toContain('- [ ] T001');
  });

  it('refuses to mark on a red gate', () => {
    writeGate('failed');
    expect(mark('T001').status).toBe(1);
    expect(readTasks()).toContain('- [ ] T001');
  });

  it('refuses when the gate pass is stale', () => {
    // The whole point: a green gate from before your last edit proves nothing.
    writeGate('passed', 600);
    const sourceFile = path.join(root, 'src', 'a.ts');
    fs.writeFileSync(sourceFile, 'export const a = 1;\n', 'utf8');

    const result = mark('T001');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STALE');
    expect(result.stderr).toContain('src/a.ts');
    expect(readTasks()).toContain('- [ ] T001');
  });

  it('marks the task when the gate is fresh', () => {
    writeGate('passed', 600);
    const sourceFile = path.join(root, 'src', 'a.ts');
    fs.writeFileSync(sourceFile, 'export const a = 1;\n', 'utf8');
    // Re-run the "gate" after the edit: now the evidence is the newest thing.
    // Strictly newer, because `find -newer` is a strict comparison and a gate
    // that merely TIES with the edit does not demonstrably cover it.
    const now = new Date(Date.now() + 5000);
    fs.utimesSync(evidenceFile, now, now);

    expect(mark('T001').status).toBe(0);
    expect(readTasks()).toContain('- [x] T001');
  });

  it('is idempotent', () => {
    writeGate('passed', 600);
    expect(mark('T001').status).toBe(0);
    const after = readTasks();
    const second = mark('T001');
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already checked');
    expect(readTasks()).toBe(after);
  });

  it('never touches a verify-tagged task', () => {
    // Those are derived from gate evidence by reconcile-task-ledger.sh.
    writeGate('passed', 600);
    const result = mark('T040');
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('reconcile-task-ledger.sh');
    expect(readTasks()).toContain('- [ ] T040');
  });

  it('rejects an unknown id', () => {
    writeGate('passed', 600);
    expect(mark('T999').status).toBe(2);
  });

  it('rejects an ambiguous id', () => {
    fs.appendFileSync(tasksFile, '- [ ] T001 Duplicated line\n', 'utf8');
    writeGate('passed', 600);
    const result = mark('T001');
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('ambiguous');
  });

  it('writes an audit record for every earned tick', () => {
    // A hand-edited checkbox leaves no record, which is how a fabricated tick
    // becomes distinguishable from a verified one.
    writeGate('passed', 600);
    mark('T001');

    const ticks = fs
      .readFileSync(path.join(featureDir, 'evidence', 'task-ticks.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(ticks).toHaveLength(1);
    expect(ticks[0].tasks).toEqual(['T001']);
    expect(ticks[0].gate_timestamp).toBeDefined();
  });

  it('does not write the audit record when nothing was ticked', () => {
    writeGate('passed', 600);
    mark('T001');
    mark('T001'); // already checked
    const ticks = fs
      .readFileSync(path.join(featureDir, 'evidence', 'task-ticks.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(ticks).toHaveLength(1);
  });

  it('does not modify tasks.md on --dry-run', () => {
    writeGate('passed', 600);
    const result = mark('T001', ['--dry-run']);
    expect(result.status).toBe(0);
    expect(readTasks()).toContain('- [ ] T001');
  });

  it('ships through the installer', () => {
    const installer = fs.readFileSync(path.resolve(__dirname, '../scripts/install.sh'), 'utf8');
    expect(installer).toContain('mark-task-done.sh');
  });
});
