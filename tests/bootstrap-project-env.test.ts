import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('bootstrap-project-env.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/bootstrap-project-env.sh');
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-env-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: tempDir, encoding: 'utf8' });

  it('should be executable and support --help', () => {
    const stats = fs.statSync(scriptPath);
    expect(process.platform === 'win32' || (stats.mode & 0o111) > 0).toBe(true);
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: bootstrap-project-env.sh');
    expect(output).toContain('--no-git');
    expect(output).toContain('--designs-dir');
  });

  it('creates a git repository with an ignored-dependency baseline commit', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"bootstrap-fixture"}', 'utf8');
    fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'node_modules/left-pad.js'), 'module.exports = 1;', 'utf8');

    const output = runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    expect(output).toContain('Initialized git repository');
    expect(output).toContain('Recorded baseline commit');
    expect(fs.existsSync(path.join(tempDir, '.git'))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf8')).toContain('node_modules/');
    // Dependencies must never be part of the baseline snapshot.
    expect(git('ls-files')).not.toContain('node_modules/');
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('keeps run state and telemetry out of the baseline commit', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"bootstrap-fixture"}', 'utf8');
    fs.mkdirSync(path.join(tempDir, '.specify/workflows/runs/abc'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.specify/workflows/runs/abc/state.json'),
      JSON.stringify({ transcript: 'agent output that must not be committed' }),
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, '.specify/telemetry.jsonl'), '{"event":"x"}\n', 'utf8');

    runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    const tracked = git('ls-files');
    // state.json stores stdout/stderr of every step: committing it leaks context.
    expect(tracked).not.toContain('.specify/workflows/runs/');
    expect(tracked).not.toContain('.specify/telemetry.jsonl');
    // Project tooling is still part of the baseline.
    expect(tracked).toContain('package.json');
    const ignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf8');
    expect(ignore).toContain('.specify/workflows/runs/');
    expect(ignore).toContain('.specify/telemetry.jsonl');
  });

  it('is idempotent: a second run does nothing', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"bootstrap-fixture"}', 'utf8');

    runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);
    const second = runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    expect(second).toContain('Nothing to do');
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('never initializes a repository that already exists', () => {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# existing', 'utf8');
    git('add', '.');
    git('commit', '-qm', 'existing');

    const output = runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    expect(output).not.toContain('Initialized git repository');
    expect(output).not.toContain('Recorded baseline commit');
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('materializes Playwright assets from .tmpl templates when designs exist', () => {
    const templatesDir = path.join(tempDir, '.specify/templates');
    const designsDir = path.join(tempDir, 'specs/001-ui/designs');
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.mkdirSync(designsDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, 'playwright.design.config.ts.tmpl'), 'export default {};', 'utf8');
    fs.writeFileSync(path.join(templatesDir, 'design-audit.spec.ts.tmpl'), 'export const audit = 1;', 'utf8');
    fs.writeFileSync(path.join(designsDir, 'tokens.css'), ':root { --a: #000; }', 'utf8');

    const output = runBash(scriptPath, [`--root=${tempDir}`, '--designs-dir=' + designsDir, '--no-git']);

    expect(output).toContain('Materialized playwright.design.config.ts');
    expect(output).toContain('Materialized tests/design/design-audit.spec.ts');
    expect(fs.readFileSync(path.join(tempDir, 'playwright.design.config.ts'), 'utf8')).toBe('export default {};');
    expect(
      fs.readFileSync(path.join(tempDir, 'tests/design/design-audit.spec.ts'), 'utf8')
    ).toBe('export const audit = 1;');
  });

  it('does not overwrite an existing design config or spec', () => {
    const templatesDir = path.join(tempDir, '.specify/templates');
    const designsDir = path.join(tempDir, 'specs/001-ui/designs');
    fs.mkdirSync(path.join(tempDir, 'tests/design'), { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.mkdirSync(designsDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, 'playwright.design.config.ts.tmpl'), 'template config', 'utf8');
    fs.writeFileSync(path.join(templatesDir, 'design-audit.spec.ts.tmpl'), 'template spec', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'playwright.design.config.ts'), 'custom config', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'tests/design/design-audit.spec.ts'), 'custom spec', 'utf8');

    runBash(scriptPath, [`--root=${tempDir}`, '--designs-dir=' + designsDir, '--no-git']);

    expect(fs.readFileSync(path.join(tempDir, 'playwright.design.config.ts'), 'utf8')).toBe('custom config');
    expect(fs.readFileSync(path.join(tempDir, 'tests/design/design-audit.spec.ts'), 'utf8')).toBe('custom spec');
  });

  it('skips Playwright assets when the feature declares no designs', () => {
    const templatesDir = path.join(tempDir, '.specify/templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, 'playwright.design.config.ts.tmpl'), 'export default {};', 'utf8');

    const output = runBash(scriptPath, [`--root=${tempDir}`, '--no-git']);

    expect(output).toContain('No designs directory found');
    expect(fs.existsSync(path.join(tempDir, 'playwright.design.config.ts'))).toBe(false);
  });
});
