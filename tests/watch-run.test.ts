import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { bashHasCommand, runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

/**
 * `watch-run.sh` exists because the engine has no `retry` for a `prompt` step: a
 * model hang ends the run with "Prompt timed out" and somebody has to type
 * `specify workflow resume <id>`. A real run lost two hours that way — not because
 * the pipeline is slow, but because it was waiting for a person who was away.
 *
 * These tests drive the real `specify` CLI with a stub agent. The interesting
 * behaviour is not "it resumes" but the two refusals: a real failure must not be
 * retried, and a capped budget must stop.
 */
describe.skipIf(!bashHasCommand('specify'))('watch-run.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/watch-run.sh');

  const WORKFLOW = `schema_version: "1.0"
workflow:
  id: slowprobe
  name: Slow Probe
  version: "1.0.0"
  author: probe
requires:
  speckit_version: ">=0.8.5"
steps:
  - id: slow
    type: prompt
    timeout: 1
    integration: gemini
    prompt: "do something"
`;

  /** A project with a one-second prompt timeout and a scripted agent. */
  const fixture = (agentBody: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-run-'));
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-run-bin-'));
    const project = path.join(dir, 'project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(dir, 'workflow.yml'), WORKFLOW, 'utf8');
    fs.writeFileSync(path.join(bin, 'gemini'), agentBody, 'utf8');
    fs.chmodSync(path.join(bin, 'gemini'), 0o755);
    execFileSync('git', ['init', '-q', '.'], { cwd: project });
    return {
      dir,
      bin,
      project,
      workflow: path.join(dir, 'workflow.yml'),
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
      cleanup: () => {
        removeDir(dir);
        removeDir(bin);
      },
    };
  };

  const runWatcher = (
    f: ReturnType<typeof fixture>,
    extra: string[] = []
  ): { status: number; output: string } => {
    try {
      const output = runBash(scriptPath, [f.workflow, '--delay=0', '--max-resumes=2', ...extra], {
        cwd: f.project,
        stdio: 'pipe',
        env: f.env,
      });
      return { status: 0, output: String(output) };
    } catch (error: any) {
      return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  };

  it('resumes a run that died on a prompt timeout', () => {
    // Slow on the first call (past the 1s timeout), fast afterwards — exactly what
    // a transient model hang looks like.
    const calls = path.join(os.tmpdir(), `watch-calls-${process.pid}`);
    const f = fixture(
      [
        '#!/usr/bin/env bash',
        `n=$(cat "${calls}" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "${calls}"`,
        '[ "$n" -eq 1 ] && sleep 3',
        'exit 0',
        '',
      ].join('\n')
    );
    try {
      const { status, output } = runWatcher(f);
      expect(status).toBe(0);
      expect(output).toContain('resume 1/2');
      expect(output).toContain('completed');
    } finally {
      fs.rmSync(calls, { force: true });
      f.cleanup();
    }
  }, 30_000);

  it('refuses to retry a failure that is not a timeout', () => {
    // Retrying a real failure burns the budget and buries the bug behind retries.
    const f = fixture('#!/usr/bin/env bash\nexit 2\n');
    try {
      const { status, output } = runWatcher(f);
      expect(status).toBe(1);
      expect(output).toContain('not a timeout');
      expect(output).toContain('exited with code 2');
      expect(output).not.toContain('resume 1/');
    } finally {
      f.cleanup();
    }
  }, 30_000);

  it('gives up when the budget runs out', () => {
    const f = fixture('#!/usr/bin/env bash\nsleep 3\nexit 0\n');
    try {
      const { status, output } = runWatcher(f);
      expect(status).toBe(1);
      expect(output).toContain('resume 1/2');
      expect(output).toContain('resume 2/2');
      expect(output).toContain('gave up');
    } finally {
      f.cleanup();
    }
  }, 60_000);

  it('documents the budget and the delay', () => {
    const help = String(runBash(scriptPath, ['--help'], { stdio: 'pipe' }));
    expect(help).toContain('--max-resumes');
    expect(help).toContain('--delay');
    expect(help).toContain('--resume=<run-id>');
  });
});
