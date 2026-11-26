import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

const scriptPath = path.resolve(__dirname, '../scripts/check-bundle-preflight.sh');
const root = path.resolve(__dirname, '..');

describe('check-bundle-preflight.sh', () => {
  let tempDir: string;
  let bashDir: string;

  let checker: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
    bashDir = path.join(tempDir, '.specify', 'scripts', 'bash');
    fs.mkdirSync(bashDir, { recursive: true });
    // Run the INSTALLED copy: SCRIPT_DIR is derived from the script's own path,
    // so executing the repo copy would always find the repo's complete scripts/
    // and the check would pass for the wrong reason.
    checker = path.join(bashDir, 'check-bundle-preflight.sh');
    fs.copyFileSync(scriptPath, checker);
    fs.chmodSync(checker, 0o755);
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  // Defined inside the describe so it closes over the per-test installed copy.
  const runPreflight = (args: string[], cwd: string) => {
    try {
      const stdout = runBash(checker, args, { cwd, stdio: 'pipe' }) as string;
      return { status: 0, stdout };
    } catch (error: any) {
      return {
        status: typeof error.status === 'number' ? error.status : 1,
        stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      };
    }
  };

  const copyInto = (name: string, executable = true): void => {
    const target = path.join(bashDir, name);
    fs.copyFileSync(path.join(root, 'scripts', name), target);
    // copyFileSync preserves the source mode, so set it explicitly: otherwise a
    // "non-executable" fixture is still executable and the case proves nothing.
    fs.chmodSync(target, executable ? 0o755 : 0o644);
  };

  it('documents that it is read-only and what the exit codes mean', () => {
    const help = runPreflight(['--help'], tempDir);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/never fixes anything/i);
    expect(help.stdout).toContain('Exit Codes');
  });

  it('passes when the installed bundle is complete', () => {
    // Copy exactly what the checker requires, taken from its own list.
    const required = fs
      .readFileSync(path.join(root, 'scripts/check-bundle-preflight.sh'), 'utf8')
      .match(/REQUIRED_SCRIPTS=\(([\s\S]*?)\)/)[1]
      .trim()
      .split('\n')
      .map((line) => line.trim());
    for (const name of required) copyInto(name);
    const modules = fs
      .readFileSync(path.join(root, 'scripts/check-bundle-preflight.sh'), 'utf8')
      .match(/REQUIRED_MODULES=\(([\s\S]*?)\)/)[1]
      .trim()
      .split('\n')
      .map((line) => line.trim());
    for (const name of modules) copyInto(name, false);

    const result = runPreflight([], tempDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('is complete');
  });

  it('names every missing script and how to fix it', () => {
    // The point is the remediation, not just the failure: no agent edit can fix
    // an incomplete install.
    copyInto('check-quality-gate.sh');
    const result = runPreflight([], tempDir);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('installation problem, not a code problem');
    expect(result.stdout).toContain('Missing');
    expect(result.stdout).toContain('reconcile-task-ledger.sh');
    expect(result.stdout).toContain('mark-task-done.sh');
    expect(result.stdout).toContain('specify bundle install');
    expect(result.stdout).toContain('specify workflow resume');
  });

  it('distinguishes present-but-not-executable from missing', () => {
    copyInto('check-quality-gate.sh', false);
    const result = runPreflight(['--quiet'], tempDir);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('not executable');
    expect(result.stdout).toContain('chmod +x');
  });

  it('rejects an unknown option', () => {
    expect(runPreflight(['--nope'], tempDir).status).toBe(2);
  });

  it('requires every script the workflow actually invokes', () => {
    // A required list that drifts from the workflow would let a real dependency
    // go unchecked, which is the failure this whole script exists to prevent.
    const workflow = yaml.parse(
      fs.readFileSync(path.join(root, 'workflows/viteplus-stitch/workflow.yml'), 'utf8')
    );
    const referenced = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node === 'string') {
        for (const match of node.matchAll(/scripts\/bash\/([A-Za-z0-9_.-]+)/g)) {
          referenced.add(match[1]);
        }
      } else if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        Object.values(node as Record<string, unknown>).forEach(walk);
      }
    };
    walk(workflow);

    const source = fs.readFileSync(scriptPath, 'utf8');
    const listed = new Set(
      source
        .match(/REQUIRED_SCRIPTS=\(([\s\S]*?)\)/)[1]
        .trim()
        .split('\n')
        .map((line) => line.trim())
    );
    const modules = new Set(
      source
        .match(/REQUIRED_MODULES=\(([\s\S]*?)\)/)[1]
        .trim()
        .split('\n')
        .map((line) => line.trim())
    );

    // The checker itself is invoked by the workflow but must not require itself.
    referenced.delete('check-bundle-preflight.sh');
    const unchecked = [...referenced].filter(
      (name) => !listed.has(name) && !modules.has(name)
    );
    expect(unchecked).toEqual([]);
  });

  it('requires exactly what the installer ships', () => {
    // Drift in either direction is a defect: a script the installer copies but
    // the checker ignores can go missing silently (check-env-config.sh and
    // check-ghost-classes.sh are skipped behind `if [ -f ]` by the gates that
    // call them), and a script the checker requires but the installer omits
    // would fail every install.
    const installer = fs.readFileSync(path.join(root, 'scripts/install.sh'), 'utf8');
    const shipped = new Set(
      [...installer.matchAll(/scripts\/([A-Za-z0-9_.-]+\.(?:sh|mjs))/g)].map((match) => match[1])
    );
    // The checker cannot require itself; that is the one legitimate difference.
    shipped.delete('check-bundle-preflight.sh');

    const source = fs.readFileSync(scriptPath, 'utf8');
    const listed = new Set([
      ...source
        .match(/REQUIRED_SCRIPTS=\(([\s\S]*?)\)/)[1]
        .trim()
        .split('\n')
        .map((line) => line.trim()),
      ...source
        .match(/REQUIRED_MODULES=\(([\s\S]*?)\)/)[1]
        .trim()
        .split('\n')
        .map((line) => line.trim()),
    ]);

    expect([...shipped].filter((name) => !listed.has(name))).toEqual([]);
    expect([...listed].filter((name) => !shipped.has(name))).toEqual([]);
  });

  it('ships through the installer', () => {
    const installer = fs.readFileSync(path.join(root, 'scripts/install.sh'), 'utf8');
    expect(installer).toContain('check-bundle-preflight.sh');
  });

  it('runs before any feature work starts', () => {
    const workflow = yaml.parse(
      fs.readFileSync(path.join(root, 'workflows/viteplus-stitch/workflow.yml'), 'utf8')
    );
    const ids = workflow.steps.map((step: any) => step.id);
    const index = ids.indexOf('preflight');
    expect(index).toBeGreaterThan(ids.indexOf('bootstrap_env_early'));
    // Failing after `specify`/`plan` would already have spent agent time.
    expect(index).toBeLessThan(ids.indexOf('specify'));
    expect(index).toBeLessThan(ids.indexOf('implement'));
    expect(workflow.steps[index].continue_on_error).toBeUndefined();
  });
});
