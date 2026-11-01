import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runBash } from './helpers/bash';

describe('verify-stitch-design.sh and templates', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/verify-stitch-design.sh');
  const configTmpl = path.resolve(__dirname, '../templates/playwright.design.config.ts.tmpl');
  const specTmpl = path.resolve(__dirname, '../templates/design-audit.spec.ts.tmpl');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should support --help flag and display usage', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: verify-stitch-design.sh');
    expect(output).toContain('Playwright');
  });

  it('should exit 0 cleanly with skip message when no designs directory exists', () => {
    const output = runBash(scriptPath, ['--feature-dir=./__non_existent_feature_dir__']);
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
