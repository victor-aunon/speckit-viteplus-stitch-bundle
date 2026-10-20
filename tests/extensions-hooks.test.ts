import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

describe('Extensions Hooks and Vite Config Templates', () => {
  const extPath = path.resolve(__dirname, '../extensions/extensions.yml');
  const viteTmpl = path.resolve(__dirname, '../templates/vite.config.ts.tmpl');
  const routesTmpl = path.resolve(__dirname, '../templates/routes-manifest.json.tmpl');

  it('should declare after_task and after_implement hooks executing quality gates', () => {
    expect(fs.existsSync(extPath)).toBe(true);
    const ext = yaml.parse(fs.readFileSync(extPath, 'utf8'));
    expect(ext.hooks).toBeDefined();
    expect(ext.hooks.after_task).toBeDefined();

    const afterTaskCommands = ext.hooks.after_task.map((h: any) => h.command);
    expect(afterTaskCommands).toContain('.specify/scripts/bash/check-quality-gate.sh');
    expect(afterTaskCommands).toContain('.specify/scripts/bash/verify-stitch-design.sh');
  });

  it('vite.config.ts.tmpl should configure Airbnb rules, complexity, layer rules, and shadcn lint', () => {
    expect(fs.existsSync(viteTmpl)).toBe(true);
    const content = fs.readFileSync(viteTmpl, 'utf8');

    // Complexity limits
    expect(content).toContain("'complexity': ['error', 10]");
    expect(content).toContain("'max-lines-per-function'");

    // Clean Architecture layer boundaries
    expect(content).toContain('import/no-restricted-paths');
    expect(content).toContain('src/core/domain');
    expect(content).toContain('src/infrastructure');

    // shadcn / Tailwind lint
    expect(content).toContain('@shadcn/lint');
    expect(content).toContain('shadcn/no-arbitrary-values');

    // Format
    expect(content).toContain('singleQuote: true');
    expect(content).toContain('semi: true');
  });

  it('routes-manifest.json.tmpl should declare screens array structure', () => {
    expect(fs.existsSync(routesTmpl)).toBe(true);
    const routes = JSON.parse(fs.readFileSync(routesTmpl, 'utf8'));
    expect(Array.isArray(routes.screens)).toBe(true);
  });
});
