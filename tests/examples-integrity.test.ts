import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runBash } from './helpers/bash.js';

describe('Examples Reference Architecture Integrity', () => {
  const root = path.resolve(__dirname, '..');
  const examplesDir = path.resolve(root, 'examples');
  const envGateScript = path.join(root, 'scripts/check-env-config.sh');

  const expectedExamples = [
    { id: '1-api-service', hasUi: false },
    { id: '2-react-vite', hasUi: true },
    { id: '3-nextjs-app', hasUi: true },
    { id: '4-vanilla-web', hasUi: true },
  ];

  it('should contain all 4 clean archetypes with required files and English spec-input', () => {
    for (const eg of expectedExamples) {
      const dir = path.join(examplesDir, eg.id);
      expect(fs.existsSync(dir), `Directory ${eg.id} should exist`).toBe(true);

      const readmePath = path.join(dir, 'README.md');
      expect(fs.existsSync(readmePath), `${eg.id}/README.md should exist`).toBe(true);

      const gitignorePath = path.join(dir, '.gitignore');
      expect(fs.existsSync(gitignorePath), `${eg.id}/.gitignore should exist`).toBe(true);

      const pkgPath = path.join(dir, 'package.json');
      expect(fs.existsSync(pkgPath), `${eg.id}/package.json should exist`).toBe(true);

      const envPath = path.join(dir, 'src/config/env.ts');
      expect(fs.existsSync(envPath), `${eg.id}/src/config/env.ts should exist`).toBe(true);

      const specInputPath = path.join(dir, 'spec.input.txt');
      expect(fs.existsSync(specInputPath), `${eg.id}/spec.input.txt should exist`).toBe(true);

      const specContent = fs.readFileSync(specInputPath, 'utf8');
      expect(specContent).toContain('Context & Purpose');
      expect(specContent).toContain('Key Acceptance Criteria');
      expect(specContent).toContain('Technical Constraints');

      // Verify that no leftover pre-implemented feature files pollute the clean example starters
      expect(fs.existsSync(path.join(dir, 'src/features')), `${eg.id} should start clean without src/features`).toBe(false);
      expect(fs.existsSync(path.join(dir, 'specs')), `${eg.id} should start clean without specs/`).toBe(false);
    }
  });

  it('keeps every example .gitignore an explicit deny-list, never a catch-all', () => {
    // A `*` + `!negation` whitelist hides everything the agent creates from
    // `git status` and `git ls-files --others`, which blinds check-blast-radius.sh
    // and the anti-tampering scan (an untracked @ts-ignore becomes invisible) and
    // makes `git add .specify` a no-op, so the tooling baseline commit silently
    // never happens. Both were measured, not assumed.
    for (const eg of expectedExamples) {
      const ignorePath = path.join(examplesDir, eg.id, '.gitignore');
      const rules = fs
        .readFileSync(ignorePath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));

      expect(rules, `${eg.id}/.gitignore must not use a catch-all`).not.toContain('*');
      expect(
        rules.filter((rule) => rule.startsWith('!')),
        `${eg.id}/.gitignore must not rely on negation whitelisting`
      ).toEqual([]);

      // Artifacts that must never reach a baseline commit.
      for (const required of [
        'node_modules/',
        'dist/',
        '.specify/workflows/runs/',
        '.specify/telemetry.jsonl',
        'playwright-report/',
        'test-results/',
      ]) {
        expect(rules, `${eg.id}/.gitignore must ignore ${required}`).toContain(required);
      }

      // Work the gates must be able to see. Ignoring these would make every diff
      // look clean no matter what the agent did.
      for (const forbidden of ['src/', 'specs/', 'tests/', 'src/config/']) {
        expect(rules, `${eg.id}/.gitignore must not ignore ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
  });

  it('should pass check-env-config.sh for all 4 example archetypes', () => {
    for (const eg of expectedExamples) {
      const egDir = path.join(examplesDir, eg.id);
      const envConfigFile = path.join(egDir, 'src/config/env.ts');
      const output = runBash(
        envGateScript,
        [`--path=${egDir}`, `--env-config=${envConfigFile}`],
        {
          cwd: egDir,
          stdio: 'pipe',
        }
      );
      expect(output).toContain('PASSED');
    }
  });
});
