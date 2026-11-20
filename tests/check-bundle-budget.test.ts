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

  function writeOversizedDist(): string {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    // Three 40 KB chunks = 120 KB total against 100 KB total limit
    fs.writeFileSync(path.join(distDir, 'c1.js'), Buffer.alloc(40 * 1024, 'a'));
    fs.writeFileSync(path.join(distDir, 'c2.js'), Buffer.alloc(40 * 1024, 'b'));
    fs.writeFileSync(path.join(distDir, 'c3.js'), Buffer.alloc(40 * 1024, 'c'));
    return distDir;
  }

  it('should fail when total bundle exceeds max-total-kb limit in strict mode', () => {
    const distDir = writeOversizedDist();

    try {
      runBash(
        scriptPath,
        ['--skip-build', `--dist-dir=${distDir}`, '--max-chunk-kb=50', '--max-total-kb=100', '--strict'],
        { stdio: 'pipe' }
      );
      expect.fail('Should fail due to total bundle budget violation');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain(
        'Total bundle size (120KB) exceeds total budget (100KB)'
      );
    }
  });

  it('should grandfather a pre-existing total overage instead of blocking brownfield agents', () => {
    const distDir = writeOversizedDist();

    const output = runBash(scriptPath, [
      '--skip-build',
      `--dist-dir=${distDir}`,
      '--max-chunk-kb=50',
      '--max-total-kb=100',
    ]);

    expect(output).toContain('[BROWNFIELD BUDGET]');
    expect(output).toContain('inherited overage does not block the agent');
    expect(output).toContain('BUNDLE_BASELINE_TOTAL_KB=120');
    expect(output).toContain('PERFORMANCE GATE PASSED WITH WARNINGS');
  });

  it('should enforce a no-growth baseline once inherited debt is recorded', () => {
    const distDir = writeOversizedDist();

    // Growth of 20 KB over a recorded 100 KB baseline (120 KB total) stays inside the
    // default 25 KB tolerance, so it is not a regression.
    const tolerated = runBash(scriptPath, [
      '--skip-build',
      `--dist-dir=${distDir}`,
      '--max-chunk-kb=50',
      '--max-total-kb=100',
      '--baseline-total-kb=100',
    ]);
    expect(tolerated).toContain('Treated as pre-existing debt');
    expect(tolerated).toContain('PERFORMANCE GATE PASSED WITH WARNINGS');

    try {
      runBash(
        scriptPath,
        [
          '--skip-build',
          `--dist-dir=${distDir}`,
          '--max-chunk-kb=50',
          '--max-total-kb=100',
          '--baseline-total-kb=80',
        ],
        { stdio: 'pipe' }
      );
      expect.fail('Should fail when growing beyond the inherited baseline');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('grows beyond the inherited baseline');
    }
  });

  it('should read budgets from environment variables and .bundle-budget.json', () => {
    const distDir = writeOversizedDist();

    const envOutput = runBash(scriptPath, ['--skip-build', `--dist-dir=${distDir}`, '--max-chunk-kb=50'], {
      env: { ...process.env, BUNDLE_MAX_TOTAL_KB: '500' },
    });
    expect(envOutput).toContain('PERFORMANCE GATE PASSED');
    expect(envOutput).not.toContain('[BROWNFIELD BUDGET]');

    const projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.bundle-budget.json'),
      JSON.stringify({ maxChunkKb: 50, maxTotalKb: 500 }, null, 2),
      'utf8'
    );
    fs.mkdirSync(path.join(projectDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'dist', 'c1.js'), Buffer.alloc(40 * 1024, 'a'));
    fs.writeFileSync(path.join(projectDir, 'dist', 'c2.js'), Buffer.alloc(40 * 1024, 'b'));
    fs.writeFileSync(path.join(projectDir, 'dist', 'c3.js'), Buffer.alloc(40 * 1024, 'c'));

    const configOutput = runBash(scriptPath, ['--skip-build'], { cwd: projectDir });
    expect(configOutput).toContain('Loaded bundle budgets from .bundle-budget.json');
    expect(configOutput).toContain('total 500KB');
    expect(configOutput).toContain('PERFORMANCE GATE PASSED');
  });

  it('should exempt grandfathered legacy chunks from the per-chunk budget', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'vendor-three-legacy.js'), Buffer.alloc(150 * 1024, 'a'));
    fs.writeFileSync(path.join(distDir, 'feature.js'), Buffer.alloc(40 * 1024, 'b'));

    const output = runBash(scriptPath, [
      '--skip-build',
      `--dist-dir=${distDir}`,
      '--max-chunk-kb=100',
      '--baseline-total-kb=190',
    ], { env: { ...process.env, BUNDLE_IGNORE_CHUNKS: 'vendor-three-*.js' } });

    expect(output).toContain('Exempted legacy chunk (per-chunk budget skipped)');
    expect(output).toContain('PERFORMANCE GATE PASSED');
  });

  it('should still fail a new oversized chunk in a brownfield project', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'vendor-three-legacy.js'), Buffer.alloc(150 * 1024, 'a'));
    fs.writeFileSync(path.join(distDir, 'billing-feature.js'), Buffer.alloc(150 * 1024, 'b'));

    try {
      runBash(scriptPath, [
        '--skip-build',
        `--dist-dir=${distDir}`,
        '--max-chunk-kb=100',
        '--baseline-total-kb=300',
      ], { stdio: 'pipe', env: { ...process.env, BUNDLE_IGNORE_CHUNKS: 'vendor-three-*.js' } });
      expect.fail('Should fail on the agent-authored oversized chunk');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('billing-feature.js');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).not.toContain("Chunk '" + distDir + '/vendor-three-legacy.js');
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
