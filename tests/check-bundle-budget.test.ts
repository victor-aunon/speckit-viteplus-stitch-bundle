import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-bundle-budget.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-bundle-budget.sh');
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-test-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should support --help flag and display usage instructions', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-bundle-budget.sh');
    expect(output).toContain('--max-chunk-kb=<N>');
    expect(output).toContain('--max-total-kb=<N>');
    expect(output).toContain('--skip-build');
    expect(output).toContain('--dry-run');
  });

  it('should skip gracefully when no distribution directory exists', () => {
    const output = runBash(scriptPath, ['--skip-build', `--dist-dir=${path.join(tempDir, 'nonexistent')}`]);
    expect(output).toContain('Skipping bundle budget verification');
  });

  it('should pass cleanly when all chunks are within budget', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    // 50 KB dummy file
    fs.writeFileSync(path.join(distDir, 'index.js'), Buffer.alloc(50 * 1024, 'a'));
    fs.writeFileSync(path.join(distDir, 'index.css'), Buffer.alloc(20 * 1024, 'b'));

    const output = runBash(scriptPath, ['--skip-build', `--dist-dir=${distDir}`, '--max-chunk-kb=100', '--max-total-kb=500']);
    expect(output).toContain('Total size = 70KB');
    expect(output).toContain('PERFORMANCE GATE PASSED');
  });

  it('should fail when a chunk exceeds the single-chunk budget', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    // 150 KB chunk against a 100 KB limit
    fs.writeFileSync(path.join(distDir, 'heavy-vendor.js'), Buffer.alloc(150 * 1024, 'a'));

    try {
      runBash(scriptPath, ['--skip-build', `--dist-dir=${distDir}`, '--max-chunk-kb=100'], { stdio: 'pipe' });
      expect.fail('Should fail due to chunk budget violation');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('BUDGET VIOLATION');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('heavy-vendor.js');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('exceeds budget: 100KB');
    }
  });

  it('should fail when total bundle exceeds max-total-kb limit', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    // Three 40 KB chunks = 120 KB total against 100 KB total limit
    fs.writeFileSync(path.join(distDir, 'c1.js'), Buffer.alloc(40 * 1024, 'a'));
    fs.writeFileSync(path.join(distDir, 'c2.js'), Buffer.alloc(40 * 1024, 'b'));
    fs.writeFileSync(path.join(distDir, 'c3.js'), Buffer.alloc(40 * 1024, 'c'));

    try {
      runBash(scriptPath, ['--skip-build', `--dist-dir=${distDir}`, '--max-chunk-kb=50', '--max-total-kb=100'], { stdio: 'pipe' });
      expect.fail('Should fail due to total bundle budget violation');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('Total bundle size (120KB) exceeds total budget (100KB)');
    }
  });

  it('should support --dry-run mode without exiting with error', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'heavy.js'), Buffer.alloc(150 * 1024, 'a'));

    const output = runBash(scriptPath, ['--skip-build', `--dist-dir=${distDir}`, '--max-chunk-kb=100', '--dry-run']);
    expect(output).toContain('PERFORMANCE GATE DRY-RUN');
    expect(output).toContain('1 budget violation(s) detected (dry-run mode)');
  });
});
