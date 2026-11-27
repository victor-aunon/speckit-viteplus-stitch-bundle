import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const scriptsDir = path.resolve(__dirname, '../scripts');
const qualityGate = path.join(scriptsDir, 'check-quality-gate.sh');
const blastRadius = path.join(scriptsDir, 'check-blast-radius.sh');
const contracts = path.join(scriptsDir, 'check-contracts.sh');
const tasksGate = path.join(scriptsDir, 'check-tasks-complete.sh');
const verdictGate = path.join(scriptsDir, 'check-verification-verdict.sh');

function writeExecutable(file: string, content: string): void {
  fs.writeFileSync(file, content, 'utf8');
  fs.chmodSync(file, 0o755);
}

describe('gate integrity contract', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-integrity-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  const writeFakeVp = (tests: number): string => {
    const binDir = path.join(tempDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeExecutable(
      path.join(binDir, 'vp'),
      `#!/usr/bin/env bash
# Real vp delegates 'vp run <script>' to the package.json script; mirror that so
# the fixture is faithful for both the built-in and the declared-script path.
if [ "$1" = "run" ]; then shift; fi
case "$1" in
  check) exit 0 ;;
  test)
    if [ "${tests}" -eq 0 ]; then
      echo "No test files found, exiting with code 0"
    else
      echo " Test Files  1 passed (1)"
      echo "      Tests  ${tests} passed (${tests})"
    fi
    exit 0
    ;;
  build) exit 0 ;;
esac
exit 0
`
    );
    return binDir;
  };

  const scaffoldProject = (): void => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"gate-fixture","scripts":{"test":"vp test --run"}}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'vitest.config.ts'), 'export default {};', 'utf8');
    fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src/main.ts'), 'export const answer = 42;\n', 'utf8');
  };

  describe('regression gate', () => {
    it('fails when the test suite executes zero tests', () => {
      scaffoldProject();
      const binDir = writeFakeVp(0);

      try {
        runBash(qualityGate, [`--evidence-dir=${path.join(tempDir, 'evidence')}`, '--skip-build'], {
          cwd: tempDir,
          stdio: 'pipe',
          env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
        });
        expect.fail('zero executed tests must fail the gate');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('executed ZERO tests');
        const evidence = JSON.parse(
          fs.readFileSync(path.join(tempDir, 'evidence/quality-gate.json'), 'utf8')
        );
        expect(evidence.failed_step).toBe('regression_tests');
        expect(evidence.tests_executed).toBe(0);
        expect(evidence.checks.regression_tests).toBe('failed');
      }
    });

    it('passes zero tests only with an explicit human opt-in and marks evidence skipped', () => {
      scaffoldProject();
      const binDir = writeFakeVp(0);

      const output = runBash(qualityGate, [
        `--evidence-dir=${path.join(tempDir, 'evidence')}`,
        '--skip-build',
        '--allow-no-tests'
      ], {
        cwd: tempDir,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
      });

      expect(output).toContain('allowed by --allow-no-tests');
      const evidence = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'evidence/quality-gate.json'), 'utf8')
      );
      expect(evidence.status).toBe('passed');
      expect(evidence.checks.regression_tests).toBe('skipped');
      expect(evidence.tests_executed).toBe(0);
    });

    it('records the real number of executed tests in evidence and telemetry details', () => {
      scaffoldProject();
      const binDir = writeFakeVp(7);

      const output = runBash(qualityGate, [
        `--evidence-dir=${path.join(tempDir, 'evidence')}`,
        '--skip-build'
      ], {
        cwd: tempDir,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
      });

      expect(output).toContain('7 test(s) executed');
      const evidence = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'evidence/quality-gate.json'), 'utf8')
      );
      expect(evidence.checks.regression_tests).toBe('passed');
      expect(evidence.tests_executed).toBe(7);
    });
  });

  describe('git ownership', () => {
    it('refuses to audit an inherited ancestor repository', () => {
      // An unrelated repository in the parent directory (the $HOME scenario).
      execFileSync('git', ['init'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });

      const projectDir = path.join(tempDir, 'nested-project');
      fs.mkdirSync(path.join(projectDir, '.specify'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"nested"}', 'utf8');

      try {
        runBash(qualityGate, [], { cwd: projectDir, stdio: 'pipe' });
        expect.fail('quality gate must refuse an inherited git repository');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('NOT its own git repository');
        expect(combined).toContain('git init');
      }

      try {
        runBash(blastRadius, ['--check-scope'], { cwd: projectDir, stdio: 'pipe' });
        expect.fail('blast radius must refuse an inherited git repository');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('not its own git repository');
      }
    });

    it('allows app-shell and canonical config paths in a scoped run', () => {
      execFileSync('git', ['init'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'src/config'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src/config/env.ts'), 'export const apiUrl = "x";\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: tempDir });
      execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: tempDir });

      // The canonical env module, the app entry and the global stylesheet are
      // shared infrastructure: a scoped run must be allowed to touch them,
      // otherwise check-env-config.sh and this gate contradict each other.
      fs.writeFileSync(path.join(tempDir, 'src/config/env.ts'), 'export const apiUrl = "y";\n', 'utf8');
      fs.mkdirSync(path.join(tempDir, 'src/features/billing'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src/features/billing/view.tsx'), 'export const View = () => null;\n', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'src/main.tsx'), 'export const main = 1;\n', 'utf8');
      fs.mkdirSync(path.join(tempDir, 'src/styles'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src/styles/app.css'), 'body { margin: 0; }\n', 'utf8');

      const output = runBash(blastRadius, ['--check-scope', '--scope=src/features/billing'], {
        cwd: tempDir
      });
      expect(output).toContain('within legitimate boundaries');
    });

    it('still rejects unrelated source paths in a scoped run', () => {
      execFileSync('git', ['init'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'src/legacy'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src/legacy/old.ts'), 'export const old = 1;\n', 'utf8');
      execFileSync('git', ['add', '.'], { cwd: tempDir });
      execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: tempDir });

      fs.writeFileSync(path.join(tempDir, 'src/legacy/old.ts'), 'export const old = 2;\n', 'utf8');

      try {
        runBash(blastRadius, ['--check-scope', '--scope=src/features/billing'], {
          cwd: tempDir,
          stdio: 'pipe'
        });
        expect.fail('out-of-slice source files must still be rejected');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('outside target feature scope');
      }
    });

    it('accepts a project that owns its git repository', () => {
      execFileSync('git', ['init'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      fs.mkdirSync(path.join(tempDir, '.specify'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"own"}', 'utf8');

      const output = runBash(blastRadius, ['--check-scope'], { cwd: tempDir });
      expect(output).toContain('within legitimate boundaries');
    });
  });

  describe('contract selectors', () => {
    const writeUiProject = (selector: string): string => {
      const featureDir = path.join(tempDir, 'specs/001-ui');
      const designsDir = path.join(featureDir, 'designs');
      fs.mkdirSync(designsDir, { recursive: true });
      const manifestPath = path.join(designsDir, 'routes-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ screens: [{ id: 'screen-home', route: '/', selector }] }),
        'utf8'
      );

      fs.mkdirSync(path.join(tempDir, 'src/components'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'src/components/BillingCard.tsx'),
        'export const BillingCard = () => <section data-testid="billing-root">ok</section>;\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tempDir, 'src/App.tsx'),
        'import { BillingCard } from "./components/BillingCard";\nexport const App = () => <BillingCard />;\n',
        'utf8'
      );
      return featureDir;
    };

    it('fails on a ghost selector that no component declares', () => {
      const featureDir = writeUiProject('[data-testid="ghost-panel"]');

      try {
        runBash(contracts, ['--feature-dir=' + featureDir, '--require-ui'], {
          cwd: tempDir,
          stdio: 'pipe'
        });
        expect.fail('a manifest-only selector must not pass a UI contract gate');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('Ghost selector');
        expect(combined).toContain('ghost-panel');
      }
    });

    it('passes when the declared selector exists in the rendered source', () => {
      const featureDir = writeUiProject('[data-testid="billing-root"]');
      const output = runBash(contracts, ['--feature-dir=' + featureDir, '--require-ui'], {
        cwd: tempDir
      });
      expect(output).toContain('All declared selectors exist');
      expect(output).toContain('CONTRACT GATE PASSED');
    });
  });

  describe('append-only evidence', () => {
    it('records state changes without duplicating identical runs', () => {
      const featureDir = path.join(tempDir, 'specs/001-tasks');
      const evidenceDir = path.join(featureDir, 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(featureDir, 'tasks.md'), '- [x] T001 done\n- [ ] T002 pending\n', 'utf8');

      const historyPath = path.join(evidenceDir, 'tasks.history.jsonl');
      const history = (): any[] =>
        fs.readFileSync(historyPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

      // Identical outcome twice: the audit trail does not grow.
      runBash(tasksGate, [`--feature-dir=${featureDir}`, '--allow-incomplete'], { stdio: 'pipe' });
      runBash(tasksGate, [`--feature-dir=${featureDir}`, '--allow-incomplete'], { stdio: 'pipe' });
      expect(history()).toHaveLength(1);
      expect(history()[0].status).toBe('skipped');

      // A different outcome is a state change and is appended.
      try {
        runBash(tasksGate, [`--feature-dir=${featureDir}`], { stdio: 'pipe' });
      } catch {
        // The gate fails on unchecked tasks; that is the point.
      }

      const events = history();
      expect(events).toHaveLength(2);
      expect(events[1].status).toBe('failed');
      expect(events[1].previous_status).toBe('skipped');
      expect(events[1].tasks_pending).toBe(1);

      // The current artifact always mirrors the latest history entry.
      const current = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'tasks.json'), 'utf8'));
      expect(current.status).toBe(events[1].status);
    });
  });

  describe('check-tasks-complete.sh', () => {
    it('fails while tasks remain unchecked and lists them', () => {
      const featureDir = path.join(tempDir, 'specs/001-partial');
      fs.mkdirSync(featureDir, { recursive: true });
      fs.writeFileSync(
        path.join(featureDir, 'tasks.md'),
        '- [x] T001 scaffold\n- [ ] T002 domain layer\n- [ ] T003 tests\n',
        'utf8'
      );

      try {
        runBash(tasksGate, [`--feature-dir=${featureDir}`], { stdio: 'pipe' });
        expect.fail('unchecked tasks must fail the completion gate');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain('2 of 3 task(s) are still unchecked');
        expect(combined).toContain('T002 domain layer');
      }
    });

    it('passes when every task is checked', () => {
      const featureDir = path.join(tempDir, 'specs/001-done');
      fs.mkdirSync(featureDir, { recursive: true });
      fs.writeFileSync(path.join(featureDir, 'tasks.md'), '- [x] T001 done\n- [X] T002 done\n', 'utf8');

      const output = runBash(tasksGate, [`--feature-dir=${featureDir}`]);
      expect(output).toContain('all 2 task(s) are checked');
    });

    it('fails when no tasks.md exists', () => {
      const featureDir = path.join(tempDir, 'specs/001-missing');
      fs.mkdirSync(featureDir, { recursive: true });

      try {
        runBash(tasksGate, [`--feature-dir=${featureDir}`], { stdio: 'pipe' });
        expect.fail('a missing task ledger must not pass');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('no tasks.md found');
      }
    });
  });

  describe('check-verification-verdict.sh', () => {
    const writeVerdict = (payload: unknown): string => {
      const featureDir = path.join(tempDir, 'specs/001-audit');
      const evidenceDir = path.join(featureDir, 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'verification.json'), JSON.stringify(payload), 'utf8');
      return featureDir;
    };

    it('fails the workflow on a reject verdict and prints blocking reasons', () => {
      const featureDir = writeVerdict({
        verdict: 'reject',
        critical: 4,
        high: 3,
        medium: 3,
        scenarios_passed: 0,
        scenarios_total: 22,
        reasons: ['zero tests executed', 'ghost selectors']
      });

      try {
        runBash(verdictGate, [`--feature-dir=${featureDir}`], { stdio: 'pipe' });
        expect.fail('a reject verdict must fail');
      } catch (error: any) {
        expect(error.status).toBe(1);
        const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        expect(combined).toContain("returned 'reject'");
        expect(combined).toContain('zero tests executed');
        expect(combined).toContain('Scenarios : 0/22 passing');
      }
    });

    it('passes on a pass verdict', () => {
      const featureDir = writeVerdict({
        verdict: 'PASS',
        critical: 0,
        high: 0,
        medium: 0,
        scenarios_passed: 22,
        scenarios_total: 22
      });

      const output = runBash(verdictGate, [`--feature-dir=${featureDir}`]);
      expect(output).toContain("returned 'pass'");
      const evidence = JSON.parse(
        fs.readFileSync(path.join(featureDir, 'evidence/verification-verdict.json'), 'utf8')
      );
      expect(evidence.status).toBe('passed');
    });

    it('fails when the machine verdict is missing', () => {
      const featureDir = path.join(tempDir, 'specs/001-no-verdict');
      fs.mkdirSync(featureDir, { recursive: true });

      try {
        runBash(verdictGate, [`--feature-dir=${featureDir}`], { stdio: 'pipe' });
        expect.fail('a missing machine verdict must fail');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('no machine verdict found');
      }
    });

    it('fails on a malformed verdict value', () => {
      const featureDir = writeVerdict({ verdict: 'maybe' });

      try {
        runBash(verdictGate, [`--feature-dir=${featureDir}`], { stdio: 'pipe' });
        expect.fail('a non pass/reject verdict must fail');
      } catch (error: any) {
        expect(error.status).toBe(1);
        expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain("must be exactly 'pass' or 'reject'");
      }
    });
  });

  describe('evidence formatting contract', () => {
    /**
     * Every gate writes its evidence as `JSON.stringify(data, null, 2)`.
     * `JSON.stringify` does not terminate the file with a newline, and Oxfmt
     * requires one — so each gate wrote a file that its OWN quality gate rejects.
     *
     * This was not theoretical. A real run spent eleven hours and seven repair
     * iterations on it: `check-design-artifacts` wrote `design-artifacts.json` at
     * 23:55, `check-quality-gate` ran `vp check` at 00:18 and failed on that file,
     * and the repair agent was forbidden from editing evidence. The loop could not
     * win, and the abort message blamed the application code.
     */
    const evidenceWriters = fs
      .readdirSync(scriptsDir)
      .filter((name) => name.endsWith('.sh'))
      .map((name) => ({ name, source: fs.readFileSync(path.join(scriptsDir, name), 'utf8') }))
      .filter((entry) => entry.source.includes('writeFileSync(outPath'));

    it('finds the evidence writers at all', () => {
      // Guard against a refactor that renames the pattern and silently disables
      // the assertions below.
      expect(evidenceWriters.length).toBeGreaterThanOrEqual(8);
    });

    it('never writes evidence JSON without a trailing newline', () => {
      const offenders = evidenceWriters
        .filter((entry) =>
          /writeFileSync\(outPath,\s*JSON\.stringify\([^)]*\)\s*,\s*"utf8"\)/.test(entry.source)
        )
        .map((entry) => entry.name);

      expect(offenders).toEqual([]);
    });

    it('terminates the serialized payload with a newline', () => {
      for (const entry of evidenceWriters) {
        expect(entry.source).toMatch(/JSON\.stringify\([^\n]*null, 2\)\s*\+\s*"\\n"/);
      }
    });
  });
});
