import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const scriptPath = path.resolve(__dirname, '../scripts/reconcile-task-ledger.sh');

function runReconciler(
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

describe('reconcile-task-ledger.sh', () => {
  let featureDir: string;
  let tasksFile: string;
  let evidenceDir: string;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    featureDir = path.join(root, 'specs', '001-x');
    evidenceDir = path.join(featureDir, 'evidence');
    tasksFile = path.join(featureDir, 'tasks.md');
    fs.mkdirSync(evidenceDir, { recursive: true });
  });

  afterEach(() => {
    removeDir(path.dirname(path.dirname(path.dirname(tasksFile))));
  });

  const writeTasks = (lines: string[]): void =>
    fs.writeFileSync(tasksFile, `# Tasks\n\n${lines.join('\n')}\n`, 'utf8');

  const readTasks = (): string => fs.readFileSync(tasksFile, 'utf8');

  const writeEvidence = (file: string, payload: unknown): void =>
    fs.writeFileSync(path.join(evidenceDir, file), JSON.stringify(payload), 'utf8');

  const reconcile = (extra: string[] = []) =>
    runReconciler([`--feature-dir=${featureDir}`, ...extra], path.dirname(featureDir));

  it('ticks a tagged task whose gate passed', () => {
    writeTasks(['- [ ] T040 [verify:quality] Run the full suite']);
    writeEvidence('quality-gate.json', { status: 'passed' });

    const result = reconcile();
    expect(result.status).toBe(0);
    expect(readTasks()).toContain('- [x] T040 [verify:quality]');
  });

  it('un-ticks a tagged task when its gate regresses', () => {
    // The checkbox must not keep claiming a verification that no longer holds.
    writeTasks(['- [x] T041 [verify:design] Verify WCAG AA contrast']);
    writeEvidence('stitch-design.json', { status: 'failed' });

    expect(reconcile().status).toBe(1);
    expect(readTasks()).toContain('- [ ] T041 [verify:design]');
  });

  it('leaves untagged implementation tasks completely alone', () => {
    // Only the agent knows whether implementation work is done.
    writeTasks(['- [ ] T001 Create the scaffold', '- [x] T002 Wire env config']);
    writeEvidence('quality-gate.json', { status: 'passed' });

    reconcile();
    expect(readTasks()).toContain('- [ ] T001 Create the scaffold');
    expect(readTasks()).toContain('- [x] T002 Wire env config');
  });

  it('does not tick a tagged task when the evidence is missing', () => {
    writeTasks(['- [ ] T042 [verify:bundle] Keep the bundle in budget']);
    const result = reconcile();
    expect(result.status).toBe(1);
    expect(readTasks()).toContain('- [ ] T042');
    expect(result.stdout).toContain('no evidence');
  });

  it('treats skipped evidence as not passed', () => {
    // A `skipped` gate established nothing, so the task it describes is not done.
    writeTasks(['- [ ] T043 [verify:contracts] Contracts satisfied']);
    writeEvidence('contracts.json', { status: 'skipped' });

    expect(reconcile().status).toBe(1);
    expect(readTasks()).toContain('- [ ] T043');
  });

  it('never rewrites tasks.md on --dry-run', () => {
    writeTasks(['- [ ] T040 [verify:quality] Run the full suite']);
    writeEvidence('quality-gate.json', { status: 'passed' });

    const result = reconcile(['--dry-run']);
    expect(result.stdout).toContain('dry-run');
    expect(readTasks()).toContain('- [ ] T040');
  });

  it('is idempotent', () => {
    writeTasks(['- [ ] T040 [verify:quality] Run the full suite']);
    writeEvidence('quality-gate.json', { status: 'passed' });

    reconcile();
    const afterFirst = readTasks();
    const second = reconcile();
    expect(second.stdout).toContain('changed: 0');
    expect(readTasks()).toBe(afterFirst);
  });

  it('fails hard on an unknown tag instead of silently skipping it', () => {
    // A typo would otherwise disable the check while looking like coverage.
    writeTasks(['- [ ] T099 [verify:tipos] Typo']);
    writeEvidence('quality-gate.json', { status: 'passed' });

    const result = reconcile();
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain('unknown');
    expect(readTasks()).toContain('- [ ] T099');
  });

  it('writes the reconciliation as evidence, not the other way round', () => {
    writeTasks(['- [ ] T040 [verify:quality] Run the full suite']);
    writeEvidence('quality-gate.json', { status: 'passed' });

    reconcile();
    const evidence = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, 'task-ledger.json'), 'utf8')
    );
    expect(evidence.status).toBe('reconciled');
    expect(evidence.results[0].gate).toBe('quality');
  });

  it('supports every documented gate tag', () => {
    writeTasks([
      '- [ ] T1 [verify:quality] a',
      '- [ ] T2 [verify:contracts] b',
      '- [ ] T3 [verify:design] c',
      '- [ ] T4 [verify:bundle] d',
      '- [ ] T5 [verify:runtime] e',
    ]);
    writeEvidence('quality-gate.json', { status: 'passed' });
    writeEvidence('contracts.json', { status: 'passed' });
    writeEvidence('stitch-design.json', { status: 'passed' });
    writeEvidence('bundle-budget.json', { status: 'passed' });
    writeEvidence('runtime-entrypoint.json', { status: 'passed' });

    expect(reconcile().status).toBe(0);
    const text = readTasks();
    for (const task of ['T1', 'T2', 'T3', 'T4', 'T5']) {
      expect(text).toContain(`- [x] ${task} `);
    }
  });

  it('does nothing, and does not fail, without a tasks.md', () => {
    // The completion gate owns that failure; this script only reconciles.
    const result = runReconciler([`--feature-dir=${featureDir}`], path.dirname(featureDir));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing to reconcile');
  });

  it('rejects an unknown option', () => {
    expect(runReconciler(['--nope'], path.dirname(featureDir)).status).toBe(2);
  });

  it('documents the tag vocabulary', () => {
    const help = runReconciler(['--help'], path.dirname(featureDir));
    expect(help.status).toBe(0);
    for (const tag of ['[verify:quality]', '[verify:contracts]', '[verify:design]', '[verify:bundle]', '[verify:runtime]']) {
      expect(help.stdout).toContain(tag);
    }
  });
});
