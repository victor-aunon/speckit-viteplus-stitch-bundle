import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'scripts/check-env-config.sh');
const qualityGatePath = path.join(root, 'scripts/check-quality-gate.sh');

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-gate-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }
  return dir;
}

function runGate(cwd: string, extraArgs: string[] = []): { output: string; status: number } {
  try {
    const output = runBash(scriptPath, extraArgs, {
      cwd,
      stdio: 'pipe',
    });
    return { output, status: 0 };
  } catch (error: any) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    };
  }
}

describe('Environment configuration quality gate', () => {
  it('script exists and should support --help', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-env-config.sh');
    expect(output).toContain('environment');
  });

  it('rejects process.env reads in feature/code modules', () => {
    const dir = makeProject({
      'src/features/billing/charge.ts': 'export const key = process.env.STRIPE_KEY;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(1);
      expect(result.output).toContain('process.env');
      expect(result.output).toContain('src/config/env.ts');
    } finally {
      removeDir(dir);
    }
  });

  it('rejects import.meta.env reads in feature/code modules', () => {
    const dir = makeProject({
      'src/features/billing/charge.ts': 'export const url = import.meta.env.VITE_API_URL;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(1);
      expect(result.output).toContain('import.meta.env');
    } finally {
      removeDir(dir);
    }
  });

  it('rejects bracket access and destructured env reads', () => {
    for (const source of [
      'export const key = process["env"].STRIPE_KEY;\n',
      'const { env } = process;\nexport const key = env.STRIPE_KEY;\n',
      'export const key = require("process").env.STRIPE_KEY;\n',
    ]) {
      const dir = makeProject({
        'src/features/billing/charge.ts': source,
      });
      try {
        const result = runGate(dir);
        expect(result.status).toBe(1);
        expect(result.output).toContain('Direct environment access');
      } finally {
        removeDir(dir);
      }
    }
  });

  it('does not let an application file named app.config.ts bypass the gate', () => {
    const dir = makeProject({
      'src/features/billing/app.config.ts': 'export const key = process.env.STRIPE_KEY;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(1);
      expect(result.output).toContain('app.config.ts');
    } finally {
      removeDir(dir);
    }
  });

  it('accepts an explicit `as Type` typed env config export', () => {
    const dir = makeProject({
      'src/config/env.ts': [
        'export interface Env { readonly API_URL: string; }',
        'export const env = {',
        '  API_URL: import.meta.env.VITE_API_URL ?? "http://localhost:5173",',
        '} as Env;',
        '',
      ].join('\n'),
      'src/features/billing/charge.ts': 'import { env } from "../../config/env";\nexport const url = env.API_URL;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(0);
    } finally {
      removeDir(dir);
    }
  });

  it('passes when env access is centralized in the typed env config module', () => {
    const dir = makeProject({
      'src/config/env.ts': [
        'export interface Env { readonly API_URL: string; }',
        'export const env: Env = {',
        '  API_URL: import.meta.env.VITE_API_URL ?? "http://localhost:5173",',
        '};',
        '',
      ].join('\n'),
      'src/features/billing/charge.ts': 'import { env } from "../../config/env";\nexport const url = env.API_URL;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(0);
      expect(result.output).toContain('PASSED');
      expect(result.output).toContain('src/config/env.ts');
    } finally {
      removeDir(dir);
    }
  });

  it('rejects an env config module that is not explicitly typed', () => {
    const dir = makeProject({
      'src/config/env.ts': 'export const env = { API_URL: import.meta.env.VITE_API_URL };\n',
      'src/features/billing/charge.ts': 'import { env } from "../../config/env";\nexport const url = env.API_URL;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(1);
      expect(result.output).toContain('typed');
    } finally {
      removeDir(dir);
    }
  });

  it('ignores test/spec files so tests can configure the environment', () => {
    const dir = makeProject({
      'src/features/billing/charge.test.ts': 'export const key = process.env.STRIPE_KEY;\n',
      'src/features/billing/charge.spec.ts': 'export const key = import.meta.env.VITE_KEY;\n',
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(0);
    } finally {
      removeDir(dir);
    }
  });

  it('supports a custom typed env config path', () => {
    const dir = makeProject({
      'src/shared/settings.ts': [
        'export type Settings = { readonly API_URL: string };',
        'export const settings: Settings = {',
        '  API_URL: process.env.API_URL ?? "http://localhost:5173",',
        '};',
        '',
      ].join('\n'),
      'src/features/billing/charge.ts': 'import { settings } from "../../shared/settings";\nexport const url = settings.API_URL;\n',
    });
    try {
      const result = runGate(dir, ['--env-config=src/shared/settings.ts']);
      expect(result.status).toBe(0);
      expect(result.output).toContain('src/shared/settings.ts');
    } finally {
      removeDir(dir);
    }
  });

  it('is wired into the main quality gate', () => {
    const qualityGate = fs.readFileSync(qualityGatePath, 'utf8');
    expect(qualityGate).toContain('check-env-config.sh');
  });
});
