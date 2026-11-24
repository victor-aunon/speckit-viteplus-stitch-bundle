import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import yaml from 'yaml';
import { bashHasCommand, runBash } from './helpers/bash';
import { getBundleArtifactName } from './helpers/bundle';
import { removeDir } from './helpers/fs';

describe('Bundle Installer Script E2E', () => {
  const installScript = path.resolve(__dirname, '../scripts/install.sh');
  const releaseScript = path.resolve(__dirname, '../scripts/build-release.sh');

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
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-blast-radius.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-contracts.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-bundle-budget.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/emit-telemetry.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-tasks-complete.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-verification-verdict.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/bootstrap-project-env.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/AUDITOR.md'))).toBe(true);
    // Design templates are materialized without the .tmpl suffix.
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/playwright.design.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/design-audit.spec.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/extensions.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/GUARDRAILS.md'))).toBe(true);

    const extContent = yaml.parse(fs.readFileSync(path.join(tempDir, '.specify/extensions.yml'), 'utf8'));
    expect(extContent.hooks.after_task.length).toBeGreaterThan(0);

    const packageJsonPath = path.join(tempDir, 'package.json');
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(packageJson.scripts['check-quality']).toBeDefined();
    expect(packageJson.scripts['dev']).toBe('vp dev');
    expect(packageJson.scripts['check']).toBe('vp check');
    expect(packageJson.scripts['test']).toBe('vp test');
    expect(packageJson.scripts['build']).toBe('vp build');
    expect(packageJson.devDependencies['vite-plus']).toBeDefined();
    expect(packageJson.devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(packageJson.devDependencies['@shadcn/lint']).toBeDefined();
    expect(packageJson.overrides).toBeDefined();
    expect(packageJson.overrides['@vitejs/plugin-react']).toEqual({ vite: '$vite' });

    const npmrcPath = path.join(tempDir, '.npmrc');
    expect(fs.existsSync(npmrcPath)).toBe(true);
    expect(fs.readFileSync(npmrcPath, 'utf8')).toContain('legacy-peer-deps=true');

    const constitutionPath = path.join(tempDir, '.specify/memory/constitution.md');
    expect(fs.existsSync(constitutionPath)).toBe(true);
    const constitution = fs.readFileSync(constitutionPath, 'utf8');
    expect(constitution).toContain('Quality Gate Integrity (NON-NEGOTIABLE)');
    expect(constitution).toContain('viteplus-stitch:quality-gate-integrity');
    expect(constitution).toContain('Impeccable UI Craft Lifecycle');
    expect(constitution).toContain('viteplus-stitch:impeccable-lifecycle');
    expect(constitution).toContain('vite.config.ts');

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    expect(fs.existsSync(agentsPath)).toBe(true);
    const agentsContent = fs.readFileSync(agentsPath, 'utf8');
    expect(agentsContent).toContain('viteplus-stitch:agents-instructions');
    expect(agentsContent).toContain('Clean Architecture Boundaries');
    expect(agentsContent).toContain('check-quality-gate.sh');

    // Second execution (Idempotence) must not duplicate the constitution section or AGENTS.md section
    const output2 = runBash(installScript, [`--target-dir=${tempDir}`]);
    expect(output2).toContain('Installation of viteplus-stitch completed successfully');

    const constitutionAfter = fs.readFileSync(constitutionPath, 'utf8');
    const occurrences = constitutionAfter.split('viteplus-stitch:quality-gate-integrity').length - 1;
    expect(occurrences).toBe(1);
    const impeccableOccurrences = constitutionAfter.split('viteplus-stitch:impeccable-lifecycle').length - 1;
    expect(impeccableOccurrences).toBe(1);

    const agentsAfter = fs.readFileSync(agentsPath, 'utf8');
    const agentsOccurrences = agentsAfter.split('viteplus-stitch:agents-instructions').length - 1;
    expect(agentsOccurrences).toBe(1);

    removeDir(tempDir);
  });

  it('should ship only the files the installer consumes', () => {
    expect(fs.existsSync(releaseScript)).toBe(true);
    const stats = fs.statSync(releaseScript);
    expect(process.platform === 'win32' || (stats.mode & 0o111) > 0).toBe(true);

    const content = fs.readFileSync(releaseScript, 'utf8');
    // Staging must be an explicit allow-list, never the whole working copy.
    for (const entry of ['bundle.yml', 'README.md', 'workflows', 'scripts', 'templates', 'extensions']) {
      expect(content).toContain(`"${entry}"`);
    }
    expect(content).not.toContain('cp -R "$BUNDLE_ROOT/."');
  });

  it('should preserve an existing constitution and AGENTS.md, appending sections once', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-constitution-test-'));
    const memoryDir = path.join(tempDir, '.specify/memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    const existing = '# My Constitution\n\n### I. Custom Rule\nKeep me.\n';
    fs.writeFileSync(path.join(memoryDir, 'constitution.md'), existing, 'utf8');

    const existingAgents = '# My Existing Agent Config\nAlways follow team style.\n';
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), existingAgents, 'utf8');

    runBash(installScript, [`--target-dir=${tempDir}`]);
    runBash(installScript, [`--target-dir=${tempDir}`]);

    const merged = fs.readFileSync(path.join(memoryDir, 'constitution.md'), 'utf8');
    expect(merged).toContain('Keep me.');
    expect(merged).toContain('Quality Gate Integrity (NON-NEGOTIABLE)');
    expect(merged).toContain('Impeccable UI Craft Lifecycle');
    const occurrences = merged.split('viteplus-stitch:quality-gate-integrity').length - 1;
    expect(occurrences).toBe(1);
    const impeccableOccurrences = merged.split('viteplus-stitch:impeccable-lifecycle').length - 1;
    expect(impeccableOccurrences).toBe(1);

    const mergedAgents = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8');
    expect(mergedAgents).toContain('Always follow team style.');
    expect(mergedAgents).toContain('Clean Architecture Boundaries');
    const agentsOccurrences = mergedAgents.split('viteplus-stitch:agents-instructions').length - 1;
    expect(agentsOccurrences).toBe(1);

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

  it('should provision a Vite+ config that registers the React plugin', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-vite-config-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    runBash(installScript, [`--target-dir=${tempDir}`]);

    const configPath = path.join(tempDir, 'vite.config.ts');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = fs.readFileSync(configPath, 'utf8');
    expect(config).toContain("@vitejs/plugin-react");
    expect(config).toContain('plugins: [react()]');
    // The template ships the plugin as a dependency, so both must agree.
    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    // The visual gate runs `npx playwright test`; the dependency must ship.
    expect(pkg.devDependencies['@playwright/test']).toBeDefined();

    removeDir(tempDir);
  });

  it('should never overwrite an existing vite.config.ts', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-vite-config-preserve-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'vite.config.ts'), '// custom config\n', 'utf8');

    runBash(installScript, [`--target-dir=${tempDir}`]);

    expect(fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8')).toBe('// custom config\n');

    removeDir(tempDir);
  });

  it('should add newly introduced hooks to an already-installed extensions.yml', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-hook-upgrade-test-'));
    const specifyDir = path.join(tempDir, '.specify');
    fs.mkdirSync(specifyDir, { recursive: true });

    // A project installed with an older bundle: gate hooks exist, the new
    // project-bootstrap / tasks-completion-gate hooks do not.
    const legacyYaml = `schema_version: "1.0"
hooks:
  after_task:
    - name: "viteplus-quality-gate"
      command: ".specify/scripts/bash/check-quality-gate.sh --skip-build"
      optional: false
  after_implement:
    - name: "final-quality-gate"
      command: ".specify/scripts/bash/check-quality-gate.sh"
      optional: false
`;
    fs.writeFileSync(path.join(specifyDir, 'extensions.yml'), legacyYaml, 'utf8');

    runBash(installScript, [`--target-dir=${tempDir}`]);

    const merged = yaml.parse(fs.readFileSync(path.join(specifyDir, 'extensions.yml'), 'utf8'));
    const afterTask = merged.hooks.after_task.map((hook: any) => hook.name);
    const afterImplement = merged.hooks.after_implement.map((hook: any) => hook.name);

    expect(afterTask).toContain('project-bootstrap');
    expect(afterTask).toContain('viteplus-quality-gate');
    expect(afterImplement).toContain('project-bootstrap');
    expect(afterImplement).toContain('tasks-completion-gate');
    expect(afterImplement).toContain('final-quality-gate');
    // Idempotent: no hook is duplicated.
    expect(afterTask.filter((name: string) => name === 'project-bootstrap')).toHaveLength(1);
    expect(afterImplement.filter((name: string) => name === 'tasks-completion-gate')).toHaveLength(1);

    removeDir(tempDir);
  });

  it('should not duplicate hooks when reinstalled twice', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-hook-idempotent-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    runBash(installScript, [`--target-dir=${tempDir}`]);
    runBash(installScript, [`--target-dir=${tempDir}`]);

    const merged = yaml.parse(fs.readFileSync(path.join(tempDir, '.specify/extensions.yml'), 'utf8'));
    for (const section of ['after_task', 'after_implement']) {
      const names = merged.hooks[section].map((hook: any) => hook.name);
      expect(new Set(names).size).toBe(names.length);
    }

    removeDir(tempDir);
  });

  // Requires both `unzip` and the Spec Kit CLI (`specify bundle build`); skipped when
  // either tool is missing (e.g. a bare CI runner).
  it.skipIf(!bashHasCommand('unzip') || !bashHasCommand('specify'))('should install cleanly from a built .zip artifact using --zip option', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-zip-install-test-'));
    fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });

    // Build the release artifact the way releases are published.
    const bundleDir = path.resolve(__dirname, '..');
    runBash(releaseScript, [], { cwd: bundleDir });
    const zipPath = path.join(bundleDir, getBundleArtifactName());
    expect(fs.existsSync(zipPath)).toBe(true);

    // The artifact must ship the bundle, not the development workspace.
    const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(entries.some((entry) => entry.startsWith('node_modules/'))).toBe(false);
    expect(entries.some((entry) => entry.startsWith('tests/'))).toBe(false);
    expect(entries).toContain('bundle.yml');
    expect(entries).toContain('scripts/check-quality-gate.sh');
    expect(fs.statSync(zipPath).size).toBeLessThan(1024 * 1024);

    const output = runBash(installScript, [`--target-dir=${tempDir}`, `--zip=${zipPath}`]);
    expect(output).toContain('Unpacking release archive from');
    expect(output).toContain('Installation of viteplus-stitch completed successfully');

    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/workflow.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-quality-gate.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-env-config.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-blast-radius.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-contracts.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-bundle-budget.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/emit-telemetry.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-tasks-complete.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-verification-verdict.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/bootstrap-project-env.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/AUDITOR.md'))).toBe(true);
    // Design templates are materialized without the .tmpl suffix.
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/playwright.design.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/design-audit.spec.ts'))).toBe(true);

    // Clean up
    fs.unlinkSync(zipPath);
    removeDir(tempDir);
  });
});
