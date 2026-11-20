import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  getBundleVersion,
  readBundleManifest,
  readWorkflowDefinition,
} from './helpers/bundle';

describe('Bundle Manifest Validation', () => {
  it('should have a valid bundle.yml with required Spec Kit schema fields', () => {
    const manifestPath = path.join(REPO_ROOT, 'bundle.yml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = readBundleManifest();
    expect(content.schema_version).toBe('1.0');
    expect(content.bundle.id).toBe('viteplus-stitch');
    expect(content.bundle.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(content.bundle.role).toBe('workflow');
    expect(content.bundle.license).toBe('MIT');
    expect(content.requires?.speckit_version).toBeDefined();
    expect(content.provides?.workflows?.[0].id).toBe('viteplus-stitch');
  });

  it('should keep every version declaration aligned with bundle.yml', () => {
    const version = getBundleVersion();
    const manifest = readBundleManifest();

    // The workflow shipped by the bundle must be published at the same version.
    expect(manifest.provides?.workflows?.[0].version).toBe(version);
    expect(readWorkflowDefinition().workflow.version).toBe(version);

    // npm metadata must not drift from the bundle release.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.version).toBe(version);

    const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
  });

  it('should resolve the installed version from bundle.yml instead of a hardcoded literal', () => {
    const installScript = fs.readFileSync(path.join(REPO_ROOT, 'scripts/install.sh'), 'utf8');
    expect(installScript).toContain('bundle.yml');
    expect(installScript).toContain("version: '$BUNDLE_VERSION'");
  });

  it('should not require the Stitch MCP server so the bundle installs anywhere', () => {
    const content = readBundleManifest();
    const requiredMcp: string[] = content.requires?.mcp ?? [];

    // Spec Kit's `requires.mcp` has no "optional" variant: listing Stitch there would
    // block `specify bundle install` on any machine without the Stitch MCP server.
    expect(requiredMcp).not.toContain('stitch');
    expect(content.requires?.speckit_version).toBeDefined();

    // Stitch stays opt-in through the workflow input instead.
    const workflow = readWorkflowDefinition();
    expect(workflow.inputs.enable_stitch).toBeDefined();
    expect(workflow.inputs.enable_stitch.type).toBe('boolean');
    expect(workflow.requires?.mcp).toBeUndefined();
  });

  it('should have a valid package.json with correct bundle metadata', () => {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.name).toContain('speckit-viteplus-stitch');
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies.yaml).toBeDefined();
  });

  it('should have a complete README.md with operations guide', () => {
    const readmePath = path.join(REPO_ROOT, 'README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
    const readme = fs.readFileSync(readmePath, 'utf8');
    expect(readme).toContain('Vite+ & Stitch Quality Workflow');
    expect(readme).toContain('specify bundle install');
  });
});
