import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Clean Architecture boundaries for vertical slices', () => {
  const viteTmpl = path.resolve(__dirname, '../templates/vite.config.ts.tmpl');

  it('applies domain boundary rules to every vertical slice and shared core using Oxlint overrides', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    expect(content).toContain("files: ['**/src/**/domain/**', '**/src/core/domain/**']");
    expect(content).toContain("'no-restricted-imports'");
    expect(content).toContain("'**/application/**'");
    expect(content).toContain("'**/infrastructure/**'");
    expect(content).toContain("'**/ui/**'");
    expect(content).toContain('Clean Architecture Violation: Domain cannot depend on Application, Infrastructure, or UI');
  });

  it('applies application, infrastructure, and UI boundary rules to vertical slices', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    // Application boundary
    expect(content).toContain("files: ['**/src/**/application/**', '**/src/core/application/**']");
    expect(content).toContain('Clean Architecture Violation: Application cannot depend on Infrastructure or UI');

    // Infrastructure boundary
    expect(content).toContain("files: ['**/src/**/infrastructure/**', '**/src/infrastructure/**']");
    expect(content).toContain('Clean Architecture Violation: Infrastructure cannot depend on UI');

    // UI boundary
    expect(content).toContain("files: ['**/src/**/ui/**', '**/src/ui/**']");
    expect(content).toContain('Clean Architecture Violation: UI cannot directly import Infrastructure adapters');
  });

  it('documents the supported vertical slice layout', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    expect(content.toLowerCase()).toContain('vertical slice');
    expect(content).toContain('src/features/<slice>');
  });

  it('exempts UI components from the 50-line function length limit', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    expect(content).toContain("files: ['**/src/**/ui/**', '**/src/ui/**']");
    expect(content).toContain("'max-lines-per-function': 'off'");
  });
});
