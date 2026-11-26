import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * The provisioned `vite.config.ts` templates are the only artifacts the agent
 * cannot lint before it needs them: a syntax error there does not fail the
 * quality gate with a rule violation, it fails every `vp` command with
 * "failed to load config from vite.config.ts".
 *
 * Real regression this guards: a doc comment containing `src/**\/ui` closes the
 * block comment early, so a file that reads as documentation is invalid
 * TypeScript. Nothing in the suite loaded the config, so it shipped broken.
 */

const root = path.resolve(__dirname, '..');
const templatesDir = path.join(root, 'templates');

function configTemplates(): string[] {
  return fs
    .readdirSync(templatesDir)
    .filter((name) => name.startsWith('vite.config') && name.endsWith('.ts.tmpl'))
    .sort();
}

describe('vite config templates', () => {
  it('exist', () => {
    const found = configTemplates();
    expect(found).toContain('vite.config.ts.tmpl');
    expect(found).toContain('vite.config.agnostic.ts.tmpl');
    expect(found).toContain('vite.config.vanilla.ts.tmpl');
  });

  it('parse as valid TypeScript', () => {
    for (const name of configTemplates()) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      const result = ts.transpileModule(source, {
        fileName: name.replace(/\.tmpl$/, ''),
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          isolatedModules: true,
        },
      });

      const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
      );
      const messages = errors.map((diagnostic) => {
        const position =
          diagnostic.file && diagnostic.start !== undefined
            ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
            : undefined;
        const where = position ? `${name}:${position.line + 1}` : name;
        return `${where} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          ' '
        )}`;
      });

      expect(messages, messages.join('\n')).toEqual([]);
    }
  });

  it('export a config object the Vite+ CLI can read', () => {
    for (const name of configTemplates()) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      expect(source, `${name} must default-export its config`).toMatch(/export default (defineConfig\()?\{/);
    }
  });

  it('never close a block comment early with a glob', () => {
    for (const name of configTemplates()) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      for (const line of source.split('\n')) {
        const isCommentLine = /^\s*(\*|\/\/)/.test(line);
        if (!isCommentLine) continue;
        // `**\/` inside a doc comment terminates it; the star-star-slash must only
        // ever appear inside a string literal (glob arrays).
        expect(
          line.includes('**/'),
          `${name} has a glob inside a comment, which closes the block early: ${line.trim()}`
        ).toBe(false);
      }
    }
  });
});
