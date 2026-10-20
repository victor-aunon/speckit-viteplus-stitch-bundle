import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import yaml from 'yaml';

describe('Bundle Installer Script E2E', () => {
  const installScript = path.resolve(__dirname, '../scripts/install.sh');

  it('script should exist and be executable', () => {
    expect(fs.existsSync(installScript)).toBe(true);
    const stats = fs.statSync(installScript);
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });

  it('should install workflow, scripts, and hooks into target project cleanly and idempotently', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-install-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    // First execution
    const output1 = execSync(`bash ${installScript} --target-dir="${tempDir}"`, { encoding: 'utf8' });
    expect(output1).toContain('Installation of viteplus-stitch completed successfully');

    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/workflow.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-quality-gate.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/verify-stitch-design.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/extensions.yml'))).toBe(true);

    const extContent = yaml.parse(fs.readFileSync(path.join(tempDir, '.specify/extensions.yml'), 'utf8'));
    expect(extContent.hooks.after_task.length).toBeGreaterThan(0);

    // Second execution (Idempotence)
    const output2 = execSync(`bash ${installScript} --target-dir="${tempDir}"`, { encoding: 'utf8' });
    expect(output2).toContain('Installation of viteplus-stitch completed successfully');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should merge cleanly into an existing extensions.yml with existing hooks without duplicate YAML keys', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-existing-hooks-test-'));
    const specifyDir = path.join(tempDir, '.specify');
    fs.mkdirSync(specifyDir, { recursive: true });

    // Create an existing extensions.yml
    const existingYaml = `schema_version: "1.0"\nhooks:\n  before_plan:\n    - name: "custom-pre-hook"\n      command: "echo test"\n`;
    fs.writeFileSync(path.join(specifyDir, 'extensions.yml'), existingYaml, 'utf8');

    execSync(`bash ${installScript} --target-dir="${tempDir}"`, { encoding: 'utf8' });

    const mergedContent = fs.readFileSync(path.join(specifyDir, 'extensions.yml'), 'utf8');
    const parsed = yaml.parse(mergedContent);

    // Must not have duplicate 'hooks' key and must contain both hook sections
    expect(parsed.hooks.before_plan).toBeDefined();
    expect(parsed.hooks.after_task).toBeDefined();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should install cleanly from a built .zip artifact using --zip option', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-zip-install-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    // Build the bundle zip first
    const bundleDir = path.resolve(__dirname, '..');
    execSync(`cd "${bundleDir}" && specify bundle build`, { encoding: 'utf8' });
    const zipPath = path.join(bundleDir, 'viteplus-stitch-1.0.0.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const output = execSync(`bash ${installScript} --target-dir="${tempDir}" --zip="${zipPath}"`, { encoding: 'utf8' });
    expect(output).toContain('Unpacking release archive from');
    expect(output).toContain('Installation of viteplus-stitch completed successfully');

    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/workflow.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-quality-gate.sh'))).toBe(true);

    // Clean up
    fs.unlinkSync(zipPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
