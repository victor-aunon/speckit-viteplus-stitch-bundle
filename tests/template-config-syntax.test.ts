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

  it('keep vendored tooling and generated artifacts out of fmt and lint', () => {
    // `vp check` runs Oxfmt and Oxlint over the whole project, and the documented
    // remedy (`--fix`) then rewrites whatever it finds. Without these exclusions
    // the loop is unwinnable in BOTH directions:
    //   - with `--fix`, Oxfmt reformats `.specify/**`, which check-blast-radius.sh
    //     treats as protected: a violation the agent is forbidden to repair.
    //   - without it, the gates' own evidence stays unformatted (written with no
    //     trailing newline) and `code_quality` fails on the gate's own output.
    const expected = ['.specify/**', 'specs/**/evidence/**', 'specs/**/designs/**'];
    for (const name of configTemplates()) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      expect(source, `${name}: lint block must declare ignorePatterns`).toMatch(
        /lint:\s*\{[\s\S]*?ignorePatterns:/
      );
      expect(source, `${name}: fmt block must declare ignorePatterns`).toMatch(
        /fmt:\s*\{[\s\S]*?ignorePatterns:/
      );
      for (const pattern of expected) {
        expect(source, `${name}: must exclude ${pattern}`).toContain(pattern);
      }
    }
  });

  it('import defineConfig from vite-plus so the Vite+ blocks type-check', () => {
    // Vite's own UserConfigExport declares none of `lint`, `fmt`, `check`, `test`
    // or `run`. With `lint.options.typeCheck: true` the config file is itself
    // type-checked, so importing defineConfig from 'vite' makes the provisioned
    // config fail its own gate with TS2769 ("'lint' does not exist in type
    // 'UserConfigExport'"). Profiles that export a plain object are exempt: they
    // must keep loading before `node_modules/` exists.
    for (const name of configTemplates()) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      // Only the profiles that actually import defineConfig: the others mention it
      // in a comment explaining why they deliberately export a plain object.
      if (!/^\s*import\b[^\n]*\bdefineConfig\b/m.test(source)) continue;
      expect(source, `${name} must not import from vite`).not.toContain("from 'vite'");
      expect(source, `${name} must import from vite-plus`).toContain("from 'vite-plus'");
    }
  });

  it('exempt the vendored audit spec from the application complexity budget', () => {
    // `tests/design/design-audit.spec.ts` is materialized from the bundle and the
    // agent may not edit it. Its CSS token resolver legitimately exceeds the
    // application limits (complexity 10, max-depth 3), so grading it there only
    // produces errors nobody is allowed to fix — the gate then fails forever.
    for (const name of configTemplates()) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      const designOverride = source.slice(source.indexOf('**/tests/design/**'));
      expect(designOverride, `${name}: missing tests/design override`).not.toBe('');
      expect(designOverride).toContain("complexity: 'off'");
      expect(designOverride).toContain("'max-depth': 'off'");
    }
  });

  it('ship a vite-env.d.ts declaring the vite/client types', () => {
    // Nothing declares `import.meta.env` or the `*.css` side-effect imports on its
    // own: `vite` is aliased to @voidzero-dev/vite-plus-core, whose root has no
    // `client.d.ts`. Without this the type-check reports TS2339/TS2882 in code the
    // agent did not write.
    const envTemplate = path.join(templatesDir, 'vite-env.d.ts.tmpl');
    expect(fs.existsSync(envTemplate)).toBe(true);
    expect(fs.readFileSync(envTemplate, 'utf8')).toContain('reference types="vite/client"');

    const pkg = JSON.parse(fs.readFileSync(path.join(templatesDir, 'package.json.tmpl'), 'utf8'));
    expect(pkg.devDependencies['@types/node']).toBeDefined();
  });

  it('ship the jsdom test block, so nobody edits a protected config to run tests', () => {
    // `vite.config.ts` is now a protected gate file. That is only safe if the
    // template already gives vitest what it needs: a real run had to add this
    // block by hand — jsdom plus `exclude: ['tests/design/**']` — because without
    // it every component test died on `document is not defined`, and the agent
    // reached for the gate config.
    for (const name of ['vite.config.ts.tmpl', 'vite.config.vanilla.ts.tmpl']) {
      const source = fs.readFileSync(path.join(templatesDir, name), 'utf8');
      expect(source, `${name}: needs a jsdom test environment`).toMatch(
        /test:\s*\{[\s\S]*?environment:\s*'jsdom'/
      );
      // The audit spec belongs to `playwright test`. An `include` that sweeps
      // tests/** makes vitest execute it and fail on `test.describe`.
      expect(source, `${name}: must exclude tests/design from vitest`).toMatch(
        /exclude:\s*\[[^\]]*tests\/design/
      );
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(templatesDir, 'package.json.tmpl'), 'utf8'));
    expect(pkg.devDependencies.jsdom).toBeDefined();
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
