import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-quality-gate.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-quality-gate.sh');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should execute the environment configuration gate as part of the quality gate', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('check-env-config.sh');
  });

  it('should support --help flag and output usage instructions', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-quality-gate.sh');
    expect(output).toContain('Vite+');
    expect(output).toContain('Airbnb');
    expect(output).toContain('--skip-tests');
    expect(output).toContain('--skip-build');
  });

  it('should integrate automated regression test execution with a real test count', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('Regression Gate');
    expect(content).toContain('TEST_STATUS=${PIPESTATUS[0]}');
    expect(content).toContain('count_executed_tests');
    // Zero executed tests must never be reported as a pass.
    expect(content).toContain('executed ZERO tests');
    expect(content).toContain('--allow-no-tests');
    expect(content).not.toContain('--passWithNoTests');
    expect(content).toContain('Test suite failed with regressions');
    expect(content).toContain('SKIP_TESTS');
  });

  it('should refuse to audit an inherited ancestor git repository', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('Project root is NOT its own git repository');
    expect(content).toContain('--allow-foreign-git');
    expect(content).toContain('GIT_OWNED');
  });

  it('should integrate application compilation and build gate', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('Build Gate');
    expect(content).toContain('BUILD_CMD');
    expect(content).toContain('BUILD_STATUS=$?');
    expect(content).toContain('SKIP_BUILD');
    expect(content).toContain('Application build / compilation failed');
  });

  it('should support --dry-run mode and verify tooling without running full check', () => {
    const output = runBash(scriptPath, ['--dry-run']);
    expect(output).toContain('[QUALITY GATE]');
    expect(output).toContain('Dry run completed');
  });

  it('should report failures and exit non-zero when a check fails', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('CHECK_STATUS=$?');
    expect(content).toContain('[QUALITY GATE FAILED]');
    expect(content).toContain('exit 1');
  });

  it('should support --scope and filter regression test execution', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('Scoped regression check active');
    expect(content).toContain('TEST_CMD="$TEST_CMD $SCOPE_DIR"');
    expect(content).toContain('SPECIFY_SCOPE');
    expect(content).toContain('Auto-detected feature scope from git status');
  });

  it('should propagate --scope to check-env-config.sh so inherited debt does not block the agent', () => {
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain('ENV_ARGS+=("--path=$SCOPE_DIR")');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate-env-scope-'));
    const configDir = path.join(tempDir, 'src/config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'env.ts'),
      'export type Env = { API_URL: string };\nexport const env: Env = { API_URL: import.meta.env.VITE_API_URL ?? "x" };\n',
      'utf8'
    );

    // In-scope slice is clean...
    const featureDir = path.join(tempDir, 'src/features/billing');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, 'charge.ts'), 'export const fee = 1;\n', 'utf8');

    // ...while legacy code outside the slice keeps its deprecated direct access.
    const legacyDir = path.join(tempDir, 'src/features/legacy');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'old.ts'), 'export const key = process.env.STRIPE_KEY;\n', 'utf8');

    try {
      try {
        runBash(scriptPath, ['--scope=src/features/billing'], { cwd: tempDir, stdio: 'pipe' });
        expect.fail('quality gate should stop before running vp in a project without Vite+');
      } catch (error: any) {
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain("Scoped env-config check active: scanning 'src/features/billing'");
        expect(combined).not.toContain('ENV CONFIG GATE FAILED');
        // It moves past the env gate and only stops later, when vp cannot run here.
        expect(combined).toContain('Engine detected');
      }
    } finally {
      removeDir(tempDir);
    }
  });

  it('should fail from a real project when application code reads env directly', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate-env-test-'));
    const featureDir = path.join(tempDir, 'src/features/billing');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'charge.ts'),
      'export const key = process.env.STRIPE_KEY;\n',
      'utf8'
    );

    try {
      try {
        runBash(scriptPath, [], { cwd: tempDir, stdio: 'pipe' });
        expect.fail('quality gate should have failed');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('ENV CONFIG GATE FAILED');
      }
    } finally {
      removeDir(tempDir);
    }
  });

  it('should write machine evidence to evidence-dir on gate failure', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate-evidence-test-'));
    const evidenceDir = path.join(tempDir, 'evidence');
    const featureDir = path.join(tempDir, 'src/features/billing');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'charge.ts'),
      'export const key = process.env.STRIPE_KEY;\n',
      'utf8'
    );

    try {
      runBash(scriptPath, [`--evidence-dir=${evidenceDir}`], { cwd: tempDir, stdio: 'pipe' });
      expect.fail('quality gate should fail on direct process.env access');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const evidencePath = path.join(evidenceDir, 'quality-gate.json');
      expect(fs.existsSync(evidencePath)).toBe(true);
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      expect(evidence.gate).toBe('check-quality-gate');
      expect(evidence.status).toBe('failed');
      expect(evidence.failed_step).toBe('env_config');
      expect(evidence.checks.env_config).toBe('failed');
      expect(evidence.checks.code_quality).toBe('unreached');
      expect(evidence.checks.regression_tests).toBe('unreached');
      expect(evidence.checks.build).toBe('unreached');
    } finally {
      removeDir(tempDir);
    }
  });

  it('should fail with exit 1 and record dependencies failure when package.json exists but node_modules is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate-deps-test-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test-pkg"}', 'utf8');

    try {
      runBash(scriptPath, [], { cwd: tempDir, stdio: 'pipe' });
      expect.fail('quality gate should fail when node_modules is missing');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      expect(combined).toContain('QUALITY GATE FAILED');
      expect(combined).toContain("'node_modules/' directory is missing");
    } finally {
      removeDir(tempDir);
    }
  });

  it('should detect newly added @ts-ignore or eslint-disable comments in git delta', () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-tamper-suppress-'));
    try {
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
      fs.mkdirSync(path.join(gitDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'src/main.ts'), 'export const a = 1;\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: gitDir });

      // Add a suppression comment
      fs.writeFileSync(path.join(gitDir, 'src/main.ts'), '// @ts-ignore\nexport const a = 1;\n', 'utf8');

      try {
        runBash(scriptPath, [], { cwd: gitDir, stdio: 'pipe' });
        expect.fail('should fail when @ts-ignore is added in delta');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('ANTI-TAMPERING VIOLATION');
        expect(combined).toContain('@ts-ignore');
      }
    } finally {
      removeDir(gitDir);
    }
  });

  it('should grandfather legacy suppression comments in untouched code', () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-grandfather-'));
    try {
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
      fs.mkdirSync(path.join(gitDir, 'src'), { recursive: true });
      // Legacy file with pre-existing suppression from 2022
      fs.writeFileSync(path.join(gitDir, 'src/legacy.ts'), '// @ts-ignore\nexport const legacy = true;\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'legacy init'], { cwd: gitDir });

      // Agent adds clean new file without suppressions
      fs.writeFileSync(path.join(gitDir, 'src/new-feature.ts'), 'export const clean = 42;\n', 'utf8');

      try {
        runBash(scriptPath, [], { cwd: gitDir, stdio: 'pipe' });
        expect.fail('should stop at engine detection, not anti-tampering');
      } catch (error: any) {
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).not.toContain('ANTI-TAMPERING VIOLATION');
        expect(combined).toContain('Engine detected');
      }
    } finally {
      removeDir(gitDir);
    }
  });

  it('should detect tampering when quality rules are deleted from vite.config.ts', () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-tamper-vite-'));
    try {
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
      fs.writeFileSync(
        path.join(gitDir, 'vite.config.ts'),
        "export default { test: { rules: { 'complexity': ['error', 10], 'no-restricted-imports': 'error' } } };\n",
        'utf8'
      );
      execFileSync('git', ['add', '.'], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'init vite config'], { cwd: gitDir });

      // Agent tampers with vite.config.ts by deleting complexity rule
      fs.writeFileSync(
        path.join(gitDir, 'vite.config.ts'),
        "export default { test: { rules: { 'no-restricted-imports': 'error' } } };\n",
        'utf8'
      );

      try {
        runBash(scriptPath, [], { cwd: gitDir, stdio: 'pipe' });
        expect.fail('should fail when quality rules are deleted from vite.config.ts');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('ANTI-TAMPERING VIOLATION');
        expect(combined).toContain('Deleting or weakening quality rules in bundler config is prohibited');
      }
    } finally {
      removeDir(gitDir);
    }
  });

  it('should detect tampering when test script in package.json is neutralized', () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-tamper-pkg-'));
    try {
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
      fs.writeFileSync(
        path.join(gitDir, 'package.json'),
        JSON.stringify({ name: 'my-app', scripts: { test: 'vp test' } }, null, 2),
        'utf8'
      );
      fs.mkdirSync(path.join(gitDir, 'node_modules'));
      execFileSync('git', ['add', '.'], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'init package.json'], { cwd: gitDir });

      // Agent neutralizes test script to echo
      fs.writeFileSync(
        path.join(gitDir, 'package.json'),
        JSON.stringify({ name: 'my-app', scripts: { test: 'echo ok' } }, null, 2),
        'utf8'
      );

      try {
        runBash(scriptPath, [], { cwd: gitDir, stdio: 'pipe' });
        expect.fail('should fail when test script is neutralized in package.json');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('ANTI-TAMPERING VIOLATION');
        expect(combined).toContain('Neutralizing quality scripts in package.json is prohibited');
      }
    } finally {
      removeDir(gitDir);
    }
  });
});
