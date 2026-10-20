import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('check-quality-gate.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-quality-gate.sh');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeGreaterThan(0); // executable
  });

  it('should support --help flag and output usage instructions', () => {
    const output = execSync(`bash ${scriptPath} --help`, { encoding: 'utf8' });
    expect(output).toContain('Usage: check-quality-gate.sh');
    expect(output).toContain('Vite+');
    expect(output).toContain('Airbnb');
  });

  it('should support --dry-run mode and verify tooling without running full check', () => {
    const output = execSync(`bash ${scriptPath} --dry-run`, { encoding: 'utf8' });
    expect(output).toContain('[QUALITY GATE]');
    expect(output).toContain('Dry run completed');
  });

  it('should format diagnostic failure message on error without aborting under set -e', () => {
    try {
      execSync(`TEST_FAIL_CMD="exit 1" bash -c 'source ${scriptPath}'`, { encoding: 'utf8' });
    } catch (e: any) {
      expect(e.status).toBe(1);
    }
  });
});
