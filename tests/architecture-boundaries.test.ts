import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Clean Architecture boundaries for vertical slices', () => {
  const viteTmpl = path.resolve(__dirname, '../templates/vite.config.ts.tmpl');

  it('applies domain boundary rules to every vertical slice, not only src/core', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    expect(content).toContain("target: '**/src/**/domain/**'");
    expect(content).toContain("from: '**/src/**/@(application|infrastructure|ui)/**'");
  });

  it('applies application, infrastructure, and UI boundary rules to vertical slices', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    expect(content).toContain("target: '**/src/**/application/**'");
    expect(content).toContain("from: '**/src/**/@(infrastructure|ui)/**'");
    expect(content).toContain("target: '**/src/**/infrastructure/**'");
    expect(content).toContain("from: '**/src/**/ui/**'");
    expect(content).toContain("target: '**/src/**/ui/**'");
    expect(content).toContain("from: '**/src/**/infrastructure/**'");
  });

  it('documents the supported vertical slice layout', () => {
    const content = fs.readFileSync(viteTmpl, 'utf8');
    expect(content.toLowerCase()).toContain('vertical slice');
    expect(content).toContain('src/features/<slice>');
  });
});
