import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

describe('Bundle Manifest Validation', () => {
  it('should have a valid bundle.yml with required Spec Kit schema fields', () => {
    const manifestPath = path.resolve(__dirname, '../bundle.yml');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(content.schema_version).toBe('1.0');
    expect(content.bundle.id).toBe('viteplus-stitch');
    expect(content.bundle.version).toBe('1.0.0');
    expect(content.components.workflows[0].id).toBe('viteplus-stitch');
    expect(content.components.extensions[0].path).toBe('extensions/extensions.yml');
  });

  it('should have a valid package.json with correct bundle metadata', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.name).toContain('speckit-viteplus-stitch');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies.yaml).toBeDefined();
  });

  it('should have a complete README.md with operations guide', () => {
    const readmePath = path.resolve(__dirname, '../README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
    const readme = fs.readFileSync(readmePath, 'utf8');
    expect(readme).toContain('Vite+ & Stitch Quality Workflow');
    expect(readme).toContain('specify bundle install');
  });
});
