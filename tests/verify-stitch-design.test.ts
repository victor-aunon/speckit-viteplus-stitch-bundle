import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('verify-stitch-design.sh and templates', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/verify-stitch-design.sh');
  const configTmpl = path.resolve(__dirname, '../templates/playwright.design.config.ts.tmpl');
  const specTmpl = path.resolve(__dirname, '../templates/design-audit.spec.ts.tmpl');
  const sealScript = path.resolve(__dirname, '../scripts/design-seal.sh');

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
    expect(output).toContain('--skip-orphans');
  });

  it('should exit 0 cleanly with skip message when no designs directory exists', () => {
    const output = runBash(scriptPath, ['--feature-dir=./__non_existent_feature_dir__']);
    expect(output).toContain('No designs directory found');
    expect(output).toContain('Skipping visual verification');
  });

  it('should fail with exit 1 when UI is required (--require-ui or SPECIFY_HAS_UI=true) and designs directory is missing', () => {
    try {
      runBash(scriptPath, ['--feature-dir=./__non_existent_feature_dir__', '--require-ui'], { stdio: 'pipe' });
      expect.fail('Should have failed when UI is required and designs directory is missing');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      expect(combined).toContain('VISUAL GATE FAILED');
      expect(combined).toContain('UI verification is required');
    }

    try {
      runBash(scriptPath, ['--feature-dir=./__non_existent_feature_dir__'], {
        env: { ...process.env, SPECIFY_HAS_UI: 'true' },
        stdio: 'pipe'
      });
      expect.fail('Should have failed when SPECIFY_HAS_UI=true and designs directory is missing');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      expect(combined).toContain('VISUAL GATE FAILED');
      expect(combined).toContain('UI verification is required');
    }
  });

  it('should write structural token evidence to a dedicated artifact (never stitch-design.json)', () => {
    const tempDir = path.resolve(__dirname, '../.specify/tmp-test-stitch-evidence');
    const designsDir = path.join(tempDir, 'designs');
    const evidenceDir = path.join(tempDir, 'evidence');
    fs.mkdirSync(designsDir, { recursive: true });
    fs.writeFileSync(path.join(designsDir, 'tokens.css'), ':root { --color-primary: #0070f3; }', 'utf8');

    try {
      const output = runBash(scriptPath, [
        `--feature-dir=${tempDir}`,
        `--evidence-dir=${evidenceDir}`,
        '--tokens-only'
      ]);
      expect(output).toContain('TOKENS GATE PASSED');
      expect(output).toContain('No rendering, no snapshots');
      expect(fs.existsSync(path.join(evidenceDir, 'stitch-design.json'))).toBe(false);

      const evidencePath = path.join(evidenceDir, 'stitch-design-tokens.json');
      expect(fs.existsSync(evidencePath)).toBe(true);
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      expect(evidence.gate).toBe('verify-stitch-design');
      expect(evidence.status).toBe('passed');
      expect(evidence.tokens_only).toBe(true);
      expect(evidence.full_visual_verification).toBe(false);
      expect(evidence.tokens_count).toBe(1);
      expect(fs.existsSync(path.join(evidenceDir, 'stitch-design-tokens.history.jsonl'))).toBe(true);
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('should reject --tokens-only when UI verification is required', () => {
    try {
      runBash(scriptPath, ['--feature-dir=./__non_existent_feature_dir__', '--tokens-only', '--require-ui'], {
        stdio: 'pipe'
      });
      expect.fail('tokens-only must not satisfy a --require-ui claim');
    } catch (error: any) {
      expect(error.status).toBe(2);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('--tokens-only is incompatible with --require-ui');
    }
  });

  it('templates should exist, keep 0.05 as the default tolerance and evaluate tokens', () => {
    expect(fs.existsSync(configTmpl)).toBe(true);
    expect(fs.existsSync(specTmpl)).toBe(true);

    const configContent = fs.readFileSync(configTmpl, 'utf8');
    // 0.05 stays the default, but it must be overridable: a tolerance nobody
    // measured is how a visual gate becomes a window no agent can close.
    expect(configContent).toContain('SPECIFY_DESIGN_TOLERANCE ?? 0.05');

    const specContent = fs.readFileSync(specTmpl, 'utf8');
    expect(specContent).toContain('tokens.css');
  });

  /**
   * The goldens are re-rendered from `designs/*.html` on every run, so if the
   * master can move, the gate grades the implementation against whatever the agent
   * last edited. Incident: a repair agent added `min-height: 2.75rem` to a screen
   * at 13:39, the visual gate re-ran at 13:44 and passed — against the reference
   * the agent had just moved. The auditor never saw it: its protocol is
   * "from-scratch, not a diff review".
   */
  function sealedFeature(seal: (designsDir: string) => string): string {
    const featureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-seal-gate-'));
    const designsDir = path.join(featureDir, 'designs');
    fs.mkdirSync(designsDir, { recursive: true });
    fs.mkdirSync(path.join(featureDir, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(designsDir, 'screen-a.html'), '<div>a</div>\n', 'utf8');
    fs.writeFileSync(
      path.join(designsDir, 'tokens.css'),
      ':root { --color-primary: #000; }\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(featureDir, 'evidence/design-artifacts.json'),
      JSON.stringify({ status: 'passed', designs_seal: seal(designsDir) }),
      'utf8'
    );
    return featureDir;
  }

  const currentSeal = (designsDir: string): string =>
    String(runBash(sealScript, [`--designs-dir=${designsDir}`], { stdio: 'pipe' })).trim();

  it('refuses to grade against a design master that moved after it was sealed', () => {
    const featureDir = sealedFeature(() => 'seal-from-before-the-edit');
    try {
      // Move the reference, exactly as the agent did.
      fs.writeFileSync(
        path.join(featureDir, 'designs/screen-a.html'),
        '<div>a</div><style>button { min-height: 2.75rem; }</style>\n',
        'utf8'
      );

      try {
        runBash(scriptPath, [`--feature-dir=${featureDir}`, '--tokens-only'], { stdio: 'pipe' });
        expect.fail('the visual gate must refuse a moved design master');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(out).toContain('design master changed after the design gate approved it');
        expect(out).toContain('seal-from-before-the-edit');
        expect(out).toContain('check-design-artifacts.sh');
      }
    } finally {
      removeDir(featureDir);
    }
  });

  it('accepts a design master that still matches its seal', () => {
    const featureDir = sealedFeature(currentSeal);
    try {
      const output = runBash(scriptPath, [`--feature-dir=${featureDir}`, '--tokens-only'], {
        stdio: 'pipe',
      });
      expect(String(output)).toContain('Design master unchanged since the design gate');
    } finally {
      removeDir(featureDir);
    }
  });
});
