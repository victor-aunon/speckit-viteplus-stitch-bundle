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
    expect(afterTaskCommands.some((c: string) => c.includes('check-quality-gate.sh --skip-build'))).toBe(true);
    expect(afterTaskCommands.some((c: string) => c.includes('verify-stitch-design.sh --tokens-only --skip-orphans'))).toBe(true);

    const vpQualityGate = ext.hooks.after_task.find((h: any) => h.name === 'viteplus-quality-gate');
    expect(vpQualityGate.description).toContain('regression tests');

    expect(ext.hooks.after_implement).toBeDefined();
    const afterImplementCommands = ext.hooks.after_implement.map((h: any) => h.command);
    expect(afterImplementCommands.some((c: string) => c.includes('check-quality-gate.sh') && !c.includes('--skip-build'))).toBe(true);
    expect(afterImplementCommands).toContain('.specify/scripts/bash/check-bundle-budget.sh');
    expect(afterImplementCommands).toContain('.specify/scripts/bash/verify-stitch-design.sh');
  });

  it('design-audit.spec.ts.tmpl should enforce automated WCAG 2.1 AA accessibility checks', () => {
    const auditTmpl = path.resolve(__dirname, '../templates/design-audit.spec.ts.tmpl');
    expect(fs.existsSync(auditTmpl)).toBe(true);
    const content = fs.readFileSync(auditTmpl, 'utf8');
    expect(content).toContain('WCAG 2.1 AA');
    expect(content).toContain('accessibility: screens meet WCAG 2.1 AA standards');
    expect(content).toContain('image-alt');
    expect(content).toContain('button-name');
  });

  it('vite.config.ts.tmpl should configure Airbnb rules, complexity, layer rules, and shadcn lint', () => {
    expect(fs.existsSync(viteTmpl)).toBe(true);
    const content = fs.readFileSync(viteTmpl, 'utf8');

    // Complexity limits
    expect(content).toContain("'complexity': ['error', 10]");
    expect(content).toContain("'max-lines-per-function'");

    // Atomic Design (Max 1 component per file)
    expect(content).toContain("'react/no-multi-comp'");

    // Clean Architecture layer boundaries
    expect(content).toContain('no-restricted-imports');
    expect(content).toContain('src/core/domain');
    expect(content).toContain('src/infrastructure');

    // shadcn / Tailwind lint
    expect(content).toContain('@shadcn/lint');
    expect(content).toContain('shadcn/no-arbitrary-values');

    // Format
    expect(content).toContain('singleQuote: true');
    expect(content).toContain('semi: true');
  });

  it('routes-manifest.json.tmpl should declare screens array structure with selector and fixtures support', () => {
    expect(fs.existsSync(routesTmpl)).toBe(true);
    const routes = JSON.parse(fs.readFileSync(routesTmpl, 'utf8'));
    expect(Array.isArray(routes.screens)).toBe(true);
    expect(routes.screens[0].selector).toBeDefined();
    expect(routes.screens[0].fixtures).toBeDefined();
  });
});
