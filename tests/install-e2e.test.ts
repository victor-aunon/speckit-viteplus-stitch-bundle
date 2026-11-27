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

  it('warns an existing project about the two config defects it cannot repair', () => {
    // Neither defect is visible until a gate has already run, and both are
    // unrepairable from inside the repair loop, so the installer is the cheapest
    // place to say so out loud. The installer must NOT rewrite the file.
    const source = fs.readFileSync(installScript, 'utf8');
    expect(source).toContain('declares no \\`ignorePatterns\\`');
    expect(source).toContain("from 'vite-plus'");
    expect(source).toContain('TS2769');
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
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-design-artifacts.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-dev-entrypoint.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/AUDITOR.md'))).toBe(true);
    // Design templates are materialized without the .tmpl suffix.
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/playwright.design.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/design-audit.spec.ts'))).toBe(true);
    // Non-UI features declare their runtime with this template.
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/runtime.json.tmpl'))).toBe(true);
    // `import.meta.env` and the `*.css` side-effect imports are declared by
    // `vite/client`, which nothing references on its own: without this file
    // the type-check fails on TS2339/TS2882 in code the agent did not write.
    const viteEnv = path.join(tempDir, 'vite-env.d.ts');
    expect(fs.existsSync(viteEnv)).toBe(true);
    expect(fs.readFileSync(viteEnv, 'utf8')).toContain('reference types="vite/client"');
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

    // No `.npmrc` is planted: the aligned pins resolve with zero ERESOLVE on
    // their own, and a global legacy-peer-deps would mask real conflicts.
    expect(fs.existsSync(path.join(tempDir, '.npmrc'))).toBe(false);

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

  it('reconciles a brownfield manifest: aliases vite, pins the toolchain, installs what the scripts need', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-reconcile-test-'));
    // The exact shape that used to break: a plain `vite` next to a missing
    // toolchain. vp refuses to boot with two Vite copies installed.
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        { name: 'existing-saas', scripts: {}, dependencies: { vite: '^6.2.0' } },
        null,
        2
      ),
      'utf8'
    );

    runBash(installScript, [`--target-dir=${tempDir}`]);

    const referenceTemplate = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../templates/package.json.tmpl'), 'utf8')
    );
    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));

    // The plain range is replaced by the official alias (docs: npm fails with
    // EOVERRIDE when the direct dependency and the override disagree).
    expect(pkg.devDependencies.vite).toBe(referenceTemplate.devDependencies.vite);
    // The section disappears instead of lingering as `"dependencies": {}`.
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.overrides.vite).toBe(referenceTemplate.overrides.vite);
    expect(pkg.overrides.vitest).toBe(referenceTemplate.overrides.vitest);

    // Without these the quality gate cannot run at all.
    expect(pkg.devDependencies['vite-plus']).toBeDefined();
    expect(pkg.devDependencies.typescript).toBeDefined();
    // vite.config.ts imports these two for the React/Vite profiles.
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    expect(pkg.devDependencies['@shadcn/lint']).toBeDefined();

    // Idempotence: a second run rewrites nothing.
    const before = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8');
    runBash(installScript, [`--target-dir=${tempDir}`]);
    expect(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8')).toBe(before);

    removeDir(tempDir);
  });

  it('gives an API project a Node runtime and vp pack, never the Vite app build', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-api-profile-test-'));
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'billing-api', scripts: {} }, null, 2),
      'utf8'
    );

    runBash(installScript, [`--target-dir=${tempDir}`, '--profile=api']);

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));

    // `vp dev`/`vp build` are built-ins: they start the Vite dev server / run the
    // Vite production build and ignore scripts, so neither can serve a Node API.
    expect(pkg.scripts.dev).toBe('npm run dev:api');
    expect(pkg.scripts['dev:api']).toBe('tsx watch src/main.ts');
    expect(pkg.scripts.build).toBe('vp pack src/main.ts');
    expect(pkg.devDependencies.tsx).toBeDefined();

    // The API profile gets the bundler-agnostic config (no React plugin rules).
    const viteConfig = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toContain("from 'vite-plus'");
    expect(viteConfig).not.toContain('@vitejs/plugin-react');

    removeDir(tempDir);
  });

  it('seeds an API project from an empty directory, with no React left behind', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-empty-api-test-'));

    // No package.json at all: the template is the seed, and it is React-shaped.
    runBash(installScript, [`--target-dir=${tempDir}`, '--profile=api']);

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));

    expect(pkg.scripts['dev:api']).toBe('tsx watch src/main.ts');
    expect(pkg.scripts.dev).toBe('npm run dev:api');
    expect(pkg.scripts.build).toBe('vp pack src/main.ts');
    expect(pkg.scripts['verify-design']).toBeUndefined();
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeUndefined();
    expect(pkg.devDependencies['@shadcn/lint']).toBeUndefined();
    expect(pkg.devDependencies['@playwright/test']).toBeUndefined();
    expect(pkg.devDependencies.tsx).toBeDefined();
    expect(pkg.devDependencies['vite-plus']).toBeDefined();

    // The config must match the seed: agnostic, no React plugin.
    const viteConfig = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toContain("from '@vitejs/plugin-react'");

    removeDir(tempDir);
  });

  it('seeds a fullstack project without assuming React', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-empty-fullstack-test-'));

    // No framework detected yet: the seed must not contradict itself by pruning
    // the React surface and then provisioning a config that imports it.
    runBash(installScript, [`--target-dir=${tempDir}`, '--profile=fullstack']);

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeUndefined();

    const viteConfig = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toContain("from '@vitejs/plugin-react'");
    expect(viteConfig).not.toContain('jsPlugins');
    // The architecture and complexity contract still applies.
    expect(viteConfig).toContain('complexity:');

    removeDir(tempDir);
  });

  it('retargets the seed scripts when the project turns out to be Next.js', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-seed-then-next-'));

    // 1. Install into an empty directory: the React seed, as usual.
    runBash(installScript, [`--target-dir=${tempDir}`]);
    const seeded = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
    expect(seeded.scripts.dev).toBe('vp dev');

    // 2. The agent then scaffolds Next.js after the install, as the workflow does.
    seeded.dependencies = { ...seeded.dependencies, next: '^16.4.6' };
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(seeded, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, 'next.config.ts'), 'export default {};\n', 'utf8');

    // 3. The per-task bootstrap must follow the framework, not the old seed.
    const output = runBash(
      path.join(tempDir, '.specify/scripts/bash/bootstrap-project-env.sh'),
      ['--no-git', '--no-templates'],
      { cwd: tempDir }
    );
    expect(output).toContain('bundle default, technology changed');

    const reconciled = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
    expect(reconciled.scripts.dev).toBe('next dev');
    expect(reconciled.scripts.build).toBe('next build');
    expect(reconciled.scripts.test).toBe('vp test');

    removeDir(tempDir);
  });

  it('gives a vanilla web project a React-free config and no React dependencies', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-vanilla-profile-test-'));
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'landing-page', scripts: {} }, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><title>x</title>', 'utf8');

    runBash(installScript, [`--target-dir=${tempDir}`, '--profile=vanilla']);

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));

    // A vanilla project is bundled by Vite, so the built-ins are correct here.
    expect(pkg.scripts.dev).toBe('vp dev');
    expect(pkg.scripts.build).toBe('vp build');

    // ...but it has no React runtime and no shadcn component library, so paying
    // for those dependencies (and their peer surface) would be pure waste.
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeUndefined();
    expect(pkg.devDependencies['@shadcn/lint']).toBeUndefined();
    expect(pkg.devDependencies['vite-plus']).toBeDefined();

    const viteConfig = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8');
    // The template's header comment names both plugins to explain their absence;
    // what must not exist is the import and the jsPlugins entry.
    expect(viteConfig).not.toContain("from '@vitejs/plugin-react'");
    expect(viteConfig).not.toContain("from '@shadcn/lint'");
    expect(viteConfig).not.toContain('jsPlugins');
    // Still enforces the architecture and complexity contract.
    expect(viteConfig).toContain('complexity:');
    expect(viteConfig).toContain('typeCheck: true');

    removeDir(tempDir);
  });

  it('gives a full-stack framework its own dev/build commands', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-fullstack-test-'));
    // Detection must work from the declared dependency alone: a clean starter may
    // not have created next.config yet when the installer runs.
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        { name: 'marketing-site', scripts: {}, dependencies: { next: '^16.4.6' } },
        null,
        2
      ),
      'utf8'
    );

    runBash(installScript, [`--target-dir=${tempDir}`]);

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));

    expect(pkg.scripts.dev).toBe('next dev');
    expect(pkg.scripts.build).toBe('next build');
    // Vitest via vp is framework-agnostic and stays the test runner.
    expect(pkg.scripts.test).toBe('vp test');
    // The agnostic config must not carry React bundler plugins into a Next tree.
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeUndefined();
    expect(pkg.devDependencies['vite-plus']).toBeDefined();

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

  it('should support profile-specific AGENTS.md installation and autodetection', () => {
    // 1. Explicit --profile=api
    const apiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-api-test-'));
    fs.mkdirSync(path.join(apiDir, '.specify'), { recursive: true });
    runBash(installScript, [`--target-dir=${apiDir}`, '--profile=api']);

    const apiAgents = fs.readFileSync(path.join(apiDir, 'AGENTS.md'), 'utf8');
    expect(apiAgents).toContain('API & Backend Service Profile');
    expect(apiAgents).toContain('HTTP Runtime Entrypoint Contract');
    expect(apiAgents).not.toContain('@shadcn/lint');
    expect(apiAgents).not.toContain('React presentation components');
    removeDir(apiDir);

    // 2. Autodetect API service from package.json name
    const autoApiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-auto-api-'));
    fs.mkdirSync(path.join(autoApiDir, '.specify'), { recursive: true });
    fs.writeFileSync(
      path.join(autoApiDir, 'package.json'),
      JSON.stringify({ name: 'example-api-service', version: '1.0.0' }),
      'utf8'
    );
    runBash(installScript, [`--target-dir=${autoApiDir}`]);

    const autoApiAgents = fs.readFileSync(path.join(autoApiDir, 'AGENTS.md'), 'utf8');
    expect(autoApiAgents).toContain('API & Backend Service Profile');
    expect(autoApiAgents).not.toContain('React presentation components');
    removeDir(autoApiDir);

    // 3. Autodetect Vanilla web
    const vanillaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-vanilla-test-'));
    fs.mkdirSync(path.join(vanillaDir, '.specify'), { recursive: true });
    fs.writeFileSync(
      path.join(vanillaDir, 'package.json'),
      JSON.stringify({ name: 'vanilla-app', version: '1.0.0' }),
      'utf8'
    );
    fs.writeFileSync(path.join(vanillaDir, 'index.html'), '<html></html>', 'utf8');
    runBash(installScript, [`--target-dir=${vanillaDir}`]);

    const vanillaAgents = fs.readFileSync(path.join(vanillaDir, 'AGENTS.md'), 'utf8');
    expect(vanillaAgents).toContain('Vanilla Web Profile');
    expect(vanillaAgents).not.toContain('@shadcn/lint');
    removeDir(vanillaDir);
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
    // WCAG AA must be checked by axe, not by the weaker DOM fallback.
    expect(pkg.devDependencies['@axe-core/playwright']).toBeDefined();

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
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-design-artifacts.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/scripts/bash/check-dev-entrypoint.sh'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/workflows/viteplus-stitch/AUDITOR.md'))).toBe(true);
    // Design templates are materialized without the .tmpl suffix.
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/playwright.design.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.specify/templates/design-audit.spec.ts'))).toBe(true);

    // Clean up
    fs.unlinkSync(zipPath);
    removeDir(tempDir);
  });

  it('provisions a bundler-agnostic vite.config.ts when the project is Next.js', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-install-next-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'next-app', scripts: { dev: 'next dev', build: 'next build' } }, null, 2),
        'utf8'
      );
      fs.writeFileSync(path.join(tempDir, 'next.config.mjs'), 'export default {};\n', 'utf8');

      const output = runBash(installScript, [`--target-dir=${tempDir}`]);
      expect(output).toContain('Detected next');

      const config = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8');
      // The bundler belongs to the framework: injecting the React plugin or the
      // Tailwind/shadcn rules would fail to resolve in a Next dependency tree.
      expect(config).not.toContain('@vitejs/plugin-react');
      expect(config).not.toContain('@shadcn/lint');
      // A plain object needs no local `vite-plus` install to be loadable.
      expect(config).not.toContain("from 'vite-plus'");
      expect(config).toContain('typeCheck');
      expect(config).toContain('complexity');

      // The project's own package.json is never rewritten.
      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('next build');
    } finally {
      removeDir(tempDir);
    }
  });

  it('provisions the React config for a Vite project without a framework config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speckit-install-vite-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'vite-app', scripts: { dev: 'vp dev' } }, null, 2),
        'utf8'
      );
      const output = runBash(installScript, [`--target-dir=${tempDir}`]);
      expect(output).toContain('Initialized vite.config.ts (React plugin');
      const config = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf8');
      expect(config).toContain('@vitejs/plugin-react');
      expect(config).toContain('@shadcn/lint');
    } finally {
      removeDir(tempDir);
    }
  });
});
