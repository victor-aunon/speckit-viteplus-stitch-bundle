import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-design-artifacts.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-design-artifacts.sh');
  let tempDir: string;
  let designsDir: string;
  let evidenceDir: string;
  let telemetryFile: string;

  const writeCompleteArtifacts = () => {
    fs.writeFileSync(
      path.join(designsDir, 'tokens.css'),
      ':root {\n  --color-primary: #0a0a0a;\n  --space-2: 8px;\n}\n',
      'utf8'
    );
    fs.writeFileSync(path.join(designsDir, 'home.html'), '<html><body>home</body></html>\n', 'utf8');
    fs.writeFileSync(
      path.join(designsDir, 'routes-manifest.json'),
      JSON.stringify({
        screens: [{ id: 'home', route: '/', selector: '[data-testid="home"]' }]
      }),
      'utf8'
    );
  };

  const run = (args: string[]) =>
    runBash(scriptPath, args, {
      cwd: tempDir,
      env: { ...process.env, SPECIFY_TELEMETRY_FILE: telemetryFile }
    });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-artifacts-'));
    designsDir = path.join(tempDir, 'specs/001-ui/designs');
    evidenceDir = path.join(tempDir, 'specs/001-ui/evidence');
    telemetryFile = path.join(tempDir, 'telemetry.jsonl');
    fs.mkdirSync(designsDir, { recursive: true });
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  it('should be executable and document its options', () => {
    const stats = fs.statSync(scriptPath);
    expect(process.platform === 'win32' || (stats.mode & 0o111) > 0).toBe(true);
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-design-artifacts.sh');
    expect(output).toContain('--allow-missing');
    expect(output).toContain('--dry-run');
  });

  it('fails when the designs directory is missing', () => {
    fs.rmSync(designsDir, { recursive: true, force: true });

    try {
      run(['--feature-dir=specs/001-ui']);
      expect.fail('a UI feature without designs must fail before implementation');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('designs directory not found');
    }
  });

  it('skips with an explicit override and records skipped evidence', () => {
    fs.rmSync(designsDir, { recursive: true, force: true });

    const output = run(['--feature-dir=specs/001-ui', '--allow-missing', `--evidence-dir=${evidenceDir}`]);
    expect(output).toContain('allowed by --allow-missing');

    const evidence = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, 'design-artifacts.json'), 'utf8')
    );
    expect(evidence.gate).toBe('check-design-artifacts');
    expect(evidence.status).toBe('skipped');
  });

  it('fails when tokens.css declares no custom properties', () => {
    writeCompleteArtifacts();
    fs.writeFileSync(path.join(designsDir, 'tokens.css'), ':root { color: red; }\n', 'utf8');

    try {
      run(['--feature-dir=specs/001-ui']);
      expect.fail('tokens.css without tokens must fail');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      expect(combined).toContain('tokens.css');
      expect(combined).toContain('no_tokens');
    }
  });

  it('fails when there is no screen HTML', () => {
    writeCompleteArtifacts();
    fs.rmSync(path.join(designsDir, 'home.html'));

    try {
      run(['--feature-dir=specs/001-ui']);
      expect.fail('a UI feature without screens must fail');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('screens_html');
    }
  });

  it('fails on an invalid manifest or a missing fixture', () => {
    writeCompleteArtifacts();
    fs.writeFileSync(
      path.join(designsDir, 'routes-manifest.json'),
      JSON.stringify({ screens: [{ id: 'home', route: '/' }] }),
      'utf8'
    );

    try {
      run(['--feature-dir=specs/001-ui']);
      expect.fail('a screen without a selector must fail');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('missing "selector"');
    }

    fs.writeFileSync(
      path.join(designsDir, 'routes-manifest.json'),
      JSON.stringify({
        screens: [
          {
            id: 'home',
            route: '/',
            selector: '[data-testid="home"]',
            fixtures: { '/api/home': './fixtures/missing.json' }
          }
        ]
      }),
      'utf8'
    );

    try {
      run(['--feature-dir=specs/001-ui']);
      expect.fail('a missing fixture must fail');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('fixture for "/api/home" not found');
    }
  });

  it('passes with complete artifacts and writes append-only evidence', () => {
    writeCompleteArtifacts();

    const output = run(['--feature-dir=specs/001-ui', `--evidence-dir=${evidenceDir}`]);
    expect(output).toContain('DESIGN GATE PASSED');
    expect(output).toContain('2 design token(s)');
    expect(output).toContain('1 screen HTML file(s)');

    const evidence = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, 'design-artifacts.json'), 'utf8')
    );
    expect(evidence.status).toBe('passed');
    expect(evidence.tokens_count).toBe(2);
    expect(evidence.screens_count).toBe(1);
    expect(evidence.missing).toEqual([]);
    expect(fs.existsSync(path.join(evidenceDir, 'design-artifacts.history.jsonl'))).toBe(true);

    // Telemetry is emitted with the gate name so the run log shows the early check.
    const telemetry = fs
      .readFileSync(telemetryFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(telemetry.some((event) => event.gate === 'check-design-artifacts')).toBe(true);
  });

  it('reports without failing in --dry-run mode', () => {
    writeCompleteArtifacts();
    fs.rmSync(path.join(designsDir, 'tokens.css'));

    const output = run(['--feature-dir=specs/001-ui', '--dry-run']);
    expect(output).toContain('--dry-run: reporting only');
  });
});
