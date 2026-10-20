import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('verify-stitch-design.sh and templates', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/verify-stitch-design.sh');
  const configTmpl = path.resolve(__dirname, '../templates/playwright.design.config.ts.tmpl');
  const specTmpl = path.resolve(__dirname, '../templates/design-audit.spec.ts.tmpl');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });

  it('should support --help flag and display usage', () => {
    const output = execSync(`bash ${scriptPath} --help`, { encoding: 'utf8' });
    expect(output).toContain('Usage: verify-stitch-design.sh');
    expect(output).toContain('Playwright');
  });

  it('should exit 0 cleanly with skip message when no designs directory exists', () => {
    const output = execSync(`bash ${scriptPath} --feature-dir=/tmp/non-existent-feature-dir`, { encoding: 'utf8' });
    expect(output).toContain('No designs directory found');
    expect(output).toContain('Skipping visual verification');
  });

  it('templates should exist and configure maxDiffPixelRatio 0.05 and tokens evaluation', () => {
    expect(fs.existsSync(configTmpl)).toBe(true);
    expect(fs.existsSync(specTmpl)).toBe(true);

    const configContent = fs.readFileSync(configTmpl, 'utf8');
    expect(configContent).toContain('maxDiffPixelRatio: 0.05');

    const specContent = fs.readFileSync(specTmpl, 'utf8');
    expect(specContent).toContain('tokens.css');
  });
});
