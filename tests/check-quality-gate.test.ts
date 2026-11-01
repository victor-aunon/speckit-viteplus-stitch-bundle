import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-quality-gate.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-quality-gate.sh');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should execute the environment configuration gate as part of the quality gate', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('check-env-config.sh');
  });

  it('should support --help flag and output usage instructions', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-quality-gate.sh');
    expect(output).toContain('Vite+');
    expect(output).toContain('Airbnb');
  });

  it('should support --dry-run mode and verify tooling without running full check', () => {
    const output = runBash(scriptPath, ['--dry-run']);
    expect(output).toContain('[QUALITY GATE]');
    expect(output).toContain('Dry run completed');
  });

  it('should report failures and exit non-zero when a check fails', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('CHECK_STATUS=$?');
    expect(content).toContain('[QUALITY GATE FAILED]');
    expect(content).toContain('exit 1');
  });

  it('should fail from a real project when application code reads env directly', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate-env-test-'));
    const featureDir = path.join(tempDir, 'src/features/billing');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'charge.ts'),
      'export const key = process.env.STRIPE_KEY;\n',
      'utf8'
    );

    try {
      try {
        runBash(scriptPath, [], { cwd: tempDir, stdio: 'pipe' });
        expect.fail('quality gate should have failed');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('ENV CONFIG GATE FAILED');
      }
    } finally {
      removeDir(tempDir);
    }
  });
});
