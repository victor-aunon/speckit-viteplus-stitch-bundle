import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('Strict Stitch design token gate', () => {
  const root = path.resolve(__dirname, '..');
  const scriptPath = path.join(root, 'scripts/verify-stitch-design.sh');
  const specTmpl = path.join(root, 'templates/design-audit.spec.ts.tmpl');

  function makeDesignsDir(tokensFileContent: string, withManifest = false): string {
    const featureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-design-test-'));
    const designsDir = path.join(featureDir, 'designs');
    fs.mkdirSync(designsDir, { recursive: true });
    fs.writeFileSync(path.join(designsDir, 'tokens.css'), tokensFileContent, 'utf8');
    if (withManifest) {
      fs.writeFileSync(
        path.join(designsDir, 'routes-manifest.json'),
        JSON.stringify({ screens: [] }),
        'utf8'
      );
    }
    return featureDir;
  }

  it('design-audit template parses tokens.css and strictly diffs every Stitch token', () => {
    expect(fs.existsSync(specTmpl)).toBe(true);
    const content = fs.readFileSync(specTmpl, 'utf8');

    // Parses the Stitch source of truth instead of asserting a couple of hardcoded names.
    expect(content).toContain('parseDesignTokens');
    expect(content).toContain('diffDesignTokens');
    expect(content).toContain('expectedTokens');
    expect(content).toContain('actualTokens');

    // Fails on the actual list of mismatched/absent tokens.
    expect(content).toContain('toEqual([])');

    // The old weak assertion (only checking the bag of styles exists) must be gone.
    expect(content).not.toContain('expect(rootStyles).toBeDefined()');
    expect(content).not.toContain('--color-bg-canvas');
  });

  it('rejects a tokens.css file that declares no design tokens in --tokens-only mode', () => {
    const featureDir = makeDesignsDir(':root {\n  color: red;\n}\n', true);
    try {
      expect(() =>
        runBash(scriptPath, [`--feature-dir=${featureDir}`, '--tokens-only'])
      ).toThrow();
    } finally {
      removeDir(featureDir);
    }
  });

  it('accepts tokens.css with declarations in --tokens-only mode without launching Playwright', () => {
    const featureDir = makeDesignsDir(
      ':root {\n  --color-primary: #123456;\n  --spacing-md: 16px;\n}\n',
      true
    );
    try {
      const output = runBash(scriptPath, [`--feature-dir=${featureDir}`, '--tokens-only']);
      expect(output).toContain('2 design token');
      expect(output).not.toContain('Executing visual fidelity tests');
    } finally {
      removeDir(featureDir);
    }
  });

  it('fails when a UI feature has designs but is missing tokens.css', () => {
    const featureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-design-test-'));
    const designsDir = path.join(featureDir, 'designs');
    fs.mkdirSync(designsDir, { recursive: true });
    fs.writeFileSync(
      path.join(designsDir, 'routes-manifest.json'),
      JSON.stringify({ screens: [] }),
      'utf8'
    );
    try {
      expect(() =>
        runBash(scriptPath, [`--feature-dir=${featureDir}`, '--tokens-only'])
      ).toThrow();
    } finally {
      removeDir(featureDir);
    }
  });

  it('still exits cleanly when the feature has no designs directory at all', () => {
    const output = runBash(scriptPath, ['--feature-dir=./__non_existent_stitch_dir__']);
    expect(output).toContain('No designs directory found');
  });
});
