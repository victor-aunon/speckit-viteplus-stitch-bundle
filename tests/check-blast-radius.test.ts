import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-blast-radius.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-blast-radius.sh');
  let tempStateDir: string;

  beforeEach(() => {
    tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-test-'));
  });

  afterEach(() => {
    removeDir(tempStateDir);
  });

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should support --help flag and display usage instructions', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-blast-radius.sh');
    expect(output).toContain('--scope=<path>');
    expect(output).toContain('--check-breaker');
    expect(output).toContain('--record-failure');
    expect(output).toContain('--reset');
  });

  it('should support --dry-run mode without modifying circuit breaker state', () => {
    const output = runBash(scriptPath, ['--dry-run', `--state-dir=${tempStateDir}`, '--record-failure']);
    expect(output).toContain('[CIRCUIT BREAKER WARNING]');
    const stateFile = path.join(tempStateDir, '.circuit-breaker-state');
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('should record consecutive failures and trip when reaching max failures threshold', () => {
    // Attempt 1
    const out1 = runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--max-failures=3', '--record-failure']);
    expect(out1).toContain('attempt 1 of 3');

    // Attempt 2
    const out2 = runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--max-failures=3', '--record-failure']);
    expect(out2).toContain('attempt 2 of 3');

    // Healthy check before 3rd failure
    const checkOut = runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--max-failures=3', '--check-breaker']);
    expect(checkOut).toContain('Circuit breaker is healthy (failures: 2 / 3)');

    // Attempt 3: Trips the breaker
    try {
      runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--max-failures=3', '--record-failure'], { stdio: 'pipe' });
      expect.fail('Should have tripped the circuit breaker on 3rd attempt');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('CIRCUIT BREAKER TRIPPED');
    }

    // Subsequent check-breaker call must fail
    try {
      runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--max-failures=3', '--check-breaker'], { stdio: 'pipe' });
      expect.fail('check-breaker should fail when tripped');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('CIRCUIT BREAKER TRIPPED');
    }

    // Resetting breaker restores health
    const resetOut = runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--reset']);
    expect(resetOut).toContain('Circuit breaker counter reset to 0');

    const healthyAgain = runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--max-failures=3', '--check-breaker']);
    expect(healthyAgain).toContain('Circuit breaker is healthy (failures: 0 / 3)');
    // This case spawns 7 sequential bash+node processes; the default 15s budget
    // is too tight when the rest of the suite runs in parallel.
  }, 60000);

  it('should reset failure counter on --record-success', () => {
    runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--record-failure']);
    const stateFile = path.join(tempStateDir, '.circuit-breaker-state');
    expect(fs.readFileSync(stateFile, 'utf8')).toBe('1');

    runBash(scriptPath, [`--state-dir=${tempStateDir}`, '--record-success']);
    expect(fs.readFileSync(stateFile, 'utf8')).toBe('0');
  });

  it('check-quality-gate.sh should integrate check-blast-radius.sh', () => {
    const qgPath = path.resolve(__dirname, '../scripts/check-quality-gate.sh');
    const content = fs.readFileSync(qgPath, 'utf8');
    expect(content).toContain('check-blast-radius.sh');
    expect(content).toContain('--check-breaker');
    expect(content).toContain('--check-scope');
    expect(content).toContain('--record-failure');
    expect(content).toContain('--record-success');
    expect(content).toContain('--reset-breaker');
  });

  it('should detect violations when protected .specify/memory/ is modified', () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-protect-test-'));
    try {
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
      const memDir = path.join(gitDir, '.specify/memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'constitution.md'), 'initial', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: gitDir });

      // Tamper with constitution.md
      fs.writeFileSync(path.join(memDir, 'constitution.md'), 'tampered', 'utf8');

      try {
        runBash(scriptPath, ['--check-scope'], { cwd: gitDir, stdio: 'pipe' });
        expect.fail('should fail on protected memory file tampering');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('BLAST RADIUS VIOLATION');
        expect(combined).toContain('.specify/memory/');
      }
    } finally {
      removeDir(gitDir);
    }
  });
});
