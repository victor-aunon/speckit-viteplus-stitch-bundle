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

  it('should support --profile and --has-ui flags to materialize profile-tailored AGENTS.md', () => {
    const templatesDir = path.join(tempDir, '.specify/templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, '../templates/AGENTS.api.md.tmpl'),
      path.join(templatesDir, 'AGENTS.api.md.tmpl')
    );
    fs.copyFileSync(
      path.resolve(__dirname, '../templates/AGENTS.react.md.tmpl'),
      path.join(templatesDir, 'AGENTS.react.md.tmpl')
    );

    // Run with --has-ui=false
    const output = runBash(scriptPath, [`--root=${tempDir}`, '--has-ui=false', '--no-git']);
    expect(output).toContain('AGENTS.md');
    expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
    const content = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('API & Backend Service Profile');
  });

  it('always leaves a HEAD even when there is nothing to commit', () => {
    // A repository without a HEAD makes `git diff HEAD` fail, blinding the
    // anti-tampering gate.
    const output = runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    expect(output).toContain('Recorded baseline commit');
    expect(git('rev-parse', '--verify', 'HEAD').trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(git('status', '--porcelain').trim()).toBe('');
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

  it('ensures baseline scripts (dev, build, test, check-quality) in an existing package.json', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'incomplete-app', scripts: { test: 'vitest run' } }),
      'utf8'
    );

    const output = runBash(scriptPath, [`--root=${tempDir}`, '--no-git', '--no-templates']);

    expect(output).toContain('Ensured baseline scripts');
    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('vitest run'); // preserves existing test script
    expect(pkg.scripts.dev).toBe('vp dev');
    expect(pkg.scripts.build).toBe('vp build');
    expect(pkg.scripts['check-quality']).toBeDefined();
    expect(pkg.scripts['verify-design']).toBeDefined();
    expect(pkg.devDependencies['@playwright/test']).toBeDefined();
  });

  it('commits untracked .specify/ tooling files when a git repository already has HEAD', () => {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# existing project', 'utf8');
    git('add', '.');
    git('commit', '-qm', 'initial commit');

    // Tooling is installed/copied into .specify/
    fs.mkdirSync(path.join(tempDir, '.specify/scripts/bash'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.specify/scripts/bash/gate.sh'), '#!/bin/bash\nexit 0', 'utf8');

    const output = runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    expect(output).toContain('Committed baseline specify tooling');
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(2);
    // Git status should be completely clean
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  it('formats the protected gate config and commits it, so it cannot fail the gate', () => {
    // `vite.config.ts` is a PROTECTED_PATTERN: the agent may not edit it, and
    // `vp check` still formats it. An unformatted config therefore fails
    // `code_quality` in about a second with no legal repair — a real run burned 13
    // gate attempts and a 30-minute repair window on a missing trailing newline,
    // in `vite.config.ts` and in a `vitest.config.ts` the agent had just created.
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.mkdirSync(path.join(tempDir, '.specify/scripts/bash'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.specify/scripts/bash/gate.sh'), '#!/bin/bash\n', 'utf8');
    const configPath = path.join(tempDir, 'vite.config.ts');
    fs.writeFileSync(configPath, 'export default {};\n', 'utf8');
    git('add', '.');
    git('commit', '-qm', 'initial commit');

    // Unformatted, exactly as the run's was: no trailing newline.
    fs.writeFileSync(configPath, 'export default {}', 'utf8');

    // `vp` stub: records the call and does the one thing `vp fmt` would do here.
    // Outside the repo: the stub and its log must not show up as untracked files
    // in the very assertion about a clean tree.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-stub-'));
    const calls = path.join(binDir, 'vp-calls.log');
    const vpStub = path.join(binDir, 'vp');
    fs.writeFileSync(
      vpStub,
      [
        '#!/usr/bin/env bash',
        'printf "vp %s\\n" "$*" >> "${VP_CALLS}"',
        'for arg in "$@"; do',
        '  if [ "$arg" != "fmt" ] && [ -f "$arg" ]; then printf "\\n" >> "$arg"; fi',
        'done',
        'exit 0',
        '',
      ].join('\n'),
      'utf8'
    );
    fs.chmodSync(vpStub, 0o755);

    runBash(scriptPath, [`--root=${tempDir}`, '--no-templates'], {
      env: {
        ...process.env,
        VP_CALLS: calls,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

    expect(fs.readFileSync(calls, 'utf8')).toContain('vp fmt vite.config.ts');
    // Formatted, and committed: a dirty protected file would be a gate violation.
    expect(fs.readFileSync(configPath, 'utf8').endsWith('\n')).toBe(true);
    expect(git('status', '--porcelain').trim()).toBe('');
    expect(git('show', '--name-only', '--pretty=format:', 'HEAD')).toContain('vite.config.ts');

    removeDir(binDir);
  });

  it('never commits machine-local repair state into the tooling baseline', () => {
    // The managed `.specify/.gitignore` only covers `feature.json` and the
    // extension overrides, so the repair loop's own bookkeeping reached the
    // history: a real run left six identical
    // `chore: baseline specify tooling snapshot` commits whose entire content
    // was `.repair-loop/` plus `.circuit-breaker-state`. Worse, every such commit
    // also swept up any pending edit to the extra tooling files, so a real change
    // to `playwright.design.config.ts` ended up labelled as a baseline.
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# existing project', 'utf8');
    git('add', '.');
    git('commit', '-qm', 'initial commit');

    const write = (relative: string, content: string): void => {
      const target = path.join(tempDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    };

    // The tooling this snapshot exists to capture.
    write('.specify/scripts/bash/gate.sh', '#!/bin/bash\nexit 0');
    // Machine-local state that must never reach a commit.
    write('.specify/.repair-loop/fingerprint', 'deadbeef');
    write('.specify/.repair-loop/window-start', '1700000000');
    write('.specify/.circuit-breaker-state', '2');
    write('.specify/telemetry.jsonl', '{}\n');
    write('.specify/workflows/runs/run-1.json', '{}');

    runBash(scriptPath, [`--root=${tempDir}`, '--no-templates']);

    const committed = git('show', '--name-only', '--pretty=format:', 'HEAD');
    expect(committed).toContain('.specify/scripts/bash/gate.sh');
    expect(committed).not.toContain('.repair-loop');
    expect(committed).not.toContain('.circuit-breaker-state');
    expect(committed).not.toContain('telemetry.jsonl');
    expect(committed).not.toContain('workflows/runs');
  });
});
