import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import yaml from 'yaml';
import { bashHasCommand, runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('Bundle Installer Script E2E', () => {
  const installScript = path.resolve(__dirname, '../scripts/install.sh');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(installScript)).toBe(true);
    const stats = fs.statSync(installScript);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should install workflow, scripts, and hooks into target project cleanly and idempotently', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-install-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    // First execution
    const output1 = runBash(installScript, [`--target-dir=${tempDir}`]);
    expect(output1).toContain('Installation of viteplus-stitch completed successfully');

    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/workflow.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-quality-gate.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-env-config.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/verify-stitch-design.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/extensions.yml'))).toBe(true);

    const extContent = yaml.parse(fs.readFileSync(path.join(tempDir, '.specify/extensions.yml'), 'utf8'));
    expect(extContent.hooks.after_task.length).toBeGreaterThan(0);

    // Second execution (Idempotence)
    const output2 = runBash(installScript, [`--target-dir=${tempDir}`]);
    expect(output2).toContain('Installation of viteplus-stitch completed successfully');

    removeDir(tempDir);
  });

  it('should merge cleanly into an existing extensions.yml with existing hooks without duplicate YAML keys', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-existing-hooks-test-'));
    const specifyDir = path.join(tempDir, '.specify');
    fs.mkdirSync(specifyDir, { recursive: true });

    // Create an existing extensions.yml
    const existingYaml = `schema_version: "1.0"\nhooks:\n  before_plan:\n    - name: "custom-pre-hook"\n      command: "echo test"\n`;
    fs.writeFileSync(path.join(specifyDir, 'extensions.yml'), existingYaml, 'utf8');

    runBash(installScript, [`--target-dir=${tempDir}`]);

    const mergedContent = fs.readFileSync(path.join(specifyDir, 'extensions.yml'), 'utf8');
    const parsed = yaml.parse(mergedContent);

    // Must not have duplicate 'hooks' key and must contain both hook sections
    expect(parsed.hooks.before_plan).toBeDefined();
    expect(parsed.hooks.after_task).toBeDefined();

    removeDir(tempDir);
  });

  it.skipIf(!bashHasCommand('unzip'))('should install cleanly from a built .zip artifact using --zip option', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-zip-install-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    // Build the bundle zip first
    const bundleDir = path.resolve(__dirname, '..');
    execFileSync('specify', ['bundle', 'build'], { cwd: bundleDir, encoding: 'utf8' });
    const zipPath = path.join(bundleDir, 'viteplus-stitch-1.0.0.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const output = runBash(installScript, [`--target-dir=${tempDir}`, `--zip=${zipPath}`]);
    expect(output).toContain('Unpacking release archive from');
    expect(output).toContain('Installation of viteplus-stitch completed successfully');

    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/workflow.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-quality-gate.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-env-config.sh'))).toBe(true);

    // Clean up
    fs.unlinkSync(zipPath);
    removeDir(tempDir);
  });
});
