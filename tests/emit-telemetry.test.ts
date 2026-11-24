import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('emit-telemetry.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/emit-telemetry.sh');
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
    logFile = path.join(tempDir, 'telemetry.jsonl');
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should support --help flag and display usage', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: emit-telemetry.sh');
    expect(output).toContain('--gate=<name>');
    expect(output).toContain('--status=<status>');
    expect(output).toContain('--model=<name>');
    expect(output).toContain('--subagent=<name>');
    expect(output).toContain('--import-state');
    expect(output).toContain('--summary');
  });

  it('should append structured JSON lines with timestamps and gate execution details', () => {
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-quality-gate',
      '--status=passed',
      '--duration-ms=1500',
      '--scope=src/features/billing',
      '--exit-code=0',
      '--details={"oxlint":"passed","types":"passed"}'
    ]);

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);

    const record = JSON.parse(lines[0]);
    expect(record.gate).toBe('check-quality-gate');
    expect(record.status).toBe('passed');
    expect(record.duration_ms).toBe(1500);
    expect(record.exit_code).toBe(0);
    expect(record.scope).toBe('src/features/billing');
    expect(record.details.oxlint).toBe('passed');
    expect(record.timestamp).toBeDefined();
    // Provenance defaults: step falls back to the gate, model/subagent to "none"
    expect(record.step).toBe('check-quality-gate');
    expect(record.model).toBe('none');
    expect(record.subagent).toBe('none');
  });

  it('should record agent, model and subagent (role) when provided', () => {
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-quality-gate',
      '--step=gate_quality',
      '--agent=pi',
      '--model=gemini-2.8-pro',
      '--subagent=LEAD ADVERSARIAL QUALITY AUDITOR',
      '--status=passed',
      '--duration-ms=900'
    ]);

    const record = JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n')[0]);
    expect(record.step).toBe('gate_quality');
    // agent = integration process, subagent = assigned role/persona
    expect(record.agent).toBe('pi');
    expect(record.model).toBe('gemini-2.8-pro');
    expect(record.subagent).toBe('LEAD ADVERSARIAL QUALITY AUDITOR');

    // --role is an alias for --subagent
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-contracts',
      '--role=HEURISTIC UX AUDITOR',
      '--status=passed'
    ]);
    const aliasRecord = JSON.parse(fs.readFileSync(logFile, 'utf8').trim().split('\n')[1]);
    expect(aliasRecord.subagent).toBe('HEURISTIC UX AUDITOR');
  });

  describe('--import-state', () => {
    let runDir: string;
    let statePath: string;

    beforeEach(() => {
      runDir = path.join(tempDir, '.specify/workflows/runs/run42');
      fs.mkdirSync(runDir, { recursive: true });
      statePath = path.join(runDir, 'state.json');

      fs.writeFileSync(
        path.join(runDir, 'workflow.yml'),
        [
          'schema_version: "1.0"',
          'workflow:',
          '  id: demo',
          'steps:',
          '  - id: plan',
          '    type: command',
          '    prompt: |',
          '      ROLE: LEAD TECHNICAL ARCHITECT.',
          '  - id: gate_quality',
          '    type: shell',
          '    run: bash check-quality-gate.sh',
          ''
        ].join('\n')
      );

      fs.writeFileSync(
        path.join(runDir, 'log.jsonl'),
        [
          JSON.stringify({ event: 'step_started', step_id: 'plan', timestamp: '2026-01-01T10:00:00.000000+00:00' }),
          JSON.stringify({ event: 'step_completed', step_id: 'plan', status: 'completed', timestamp: '2026-01-01T10:00:01.500000+00:00' }),
          JSON.stringify({ event: 'step_started', step_id: 'gate_quality', timestamp: '2026-01-01T10:00:02.000000+00:00' }),
          JSON.stringify({ event: 'step_completed', step_id: 'gate_quality', status: 'failed', timestamp: '2026-01-01T10:00:02.250000+00:00' })
        ].join('\n') + '\n'
      );

      fs.writeFileSync(
        statePath,
        JSON.stringify({
          run_id: 'run42',
          workflow_id: 'demo',
          status: 'failed',
          step_results: {
            plan: {
              type: 'command',
              integration: 'claude',
              model: 'gemini-2.8-pro',
              status: 'completed',
              output: { exit_code: 0 }
            },
            gate_quality: {
              type: 'shell',
              integration: null,
              model: null,
              status: 'failed',
              output: { exit_code: 1 },
              error: 'Quality gate failed.'
            }
          },
          updated_at: '2026-01-01T10:00:05.000000+00:00'
        }),
        'utf8'
      );
    });

    const readEvents = (): any[] =>
      fs
        .readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

    it('should import every workflow step with model, subagent and role', () => {
      runBash(scriptPath, [`--file=${logFile}`, `--import-state=${statePath}`]);

      const events = readEvents();
      expect(events).toHaveLength(2);

      const plan = events.find((e) => e.step === 'plan');
      expect(plan.event).toBe('step_execution');
      expect(plan.run_id).toBe('run42');
      expect(plan.workflow_id).toBe('demo');
      expect(plan.step_type).toBe('command');
      expect(plan.agent).toBe('claude');
      expect(plan.model).toBe('gemini-2.8-pro');
      expect(plan.subagent).toBe('LEAD TECHNICAL ARCHITECT.');
      expect(plan.status).toBe('completed');
      expect(plan.duration_ms).toBe(1500);
      expect(plan.exit_code).toBe(0);

      const gate = events.find((e) => e.step === 'gate_quality');
      expect(gate.agent).toBe('none');
      expect(gate.model).toBe('none');
      expect(gate.subagent).toBe('none');
      expect(gate.status).toBe('failed');
      expect(gate.duration_ms).toBe(250);
      expect(gate.exit_code).toBe(1);
      expect(gate.error).toBe('Quality gate failed.');
    });

    it('should be idempotent and preserve non-imported events', () => {
      runBash(scriptPath, [
        `--file=${logFile}`,
        '--gate=check-quality-gate',
        '--status=passed'
      ]);

      runBash(scriptPath, [`--file=${logFile}`, `--import-state=${statePath}`]);
      runBash(scriptPath, [`--file=${logFile}`, `--import-state=${statePath}`]);

      const events = readEvents();
      expect(events.filter((e) => e.event === 'step_execution')).toHaveLength(2);
      expect(events.filter((e) => e.event === 'gate_execution')).toHaveLength(1);
    });

    it('should discover the active run from .specify/workflows/runs', () => {
      runBash(scriptPath, [`--file=${logFile}`, '--import-state'], {
        cwd: tempDir
      });

      const events = readEvents();
      expect(events.map((e) => e.step).sort()).toEqual(['gate_quality', 'plan']);
    });

    it('should extract roles from the yaml.safe_dump snapshot shape', () => {
      // The CLI persists the run snapshot with yaml.safe_dump, which keeps the
      // ROLE on the `prompt:` line (or escapes the newlines), not in a block
      // scalar. A line-oriented parser finds nothing there.
      const runDir = path.join(tempDir, '.specify/workflows/runs/runDump');
      fs.mkdirSync(runDir, { recursive: true });
      const statePath = path.join(runDir, 'state.json');

      const snapshot = yaml.stringify({
        steps: [
          {
            id: 'guardrails',
            type: 'prompt',
            prompt: 'ROLE: ARCHITECTURAL GOVERNANCE & PROTOCOL ENFORCER.\n\nYou are running the workflow.'
          },
          {
            id: 'audit-spec',
            type: 'prompt',
            prompt: 'ROLE: LEAD REQUIREMENTS & DOMAIN ARCHITECT.\nPerform the audit.'
          }
        ]
      });
      fs.writeFileSync(path.join(runDir, 'workflow.yml'), snapshot, 'utf8');
      fs.writeFileSync(
        statePath,
        JSON.stringify({
          run_id: 'runDump',
          workflow_id: 'viteplus-stitch',
          status: 'completed',
          step_results: {
            guardrails: { type: 'prompt', integration: 'pi', model: 'gemini-2.8-pro', status: 'completed' },
            'audit-spec': { type: 'prompt', integration: 'pi', model: 'deepseek-v3', status: 'completed' }
          },
          updated_at: '2026-01-01T00:00:00.000000+00:00'
        }),
        'utf8'
      );

      runBash(scriptPath, [`--file=${logFile}`, `--import-state=${statePath}`]);

      const events = fs
        .readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events.find((event) => event.step === 'guardrails').subagent).toBe(
        'ARCHITECTURAL GOVERNANCE & PROTOCOL ENFORCER.'
      );
      expect(events.find((event) => event.step === 'audit-spec').subagent).toBe(
        'LEAD REQUIREMENTS & DOMAIN ARCHITECT.'
      );
    });

    it('should never record unresolved template placeholders as provenance', () => {
      // The Spec Kit engine stores step_config.model verbatim when the resolved
      // value is empty, so state.json contains "{{ inputs.model }}".
      const runDir = path.join(tempDir, '.specify/workflows/runs/runPlaceholder');
      fs.mkdirSync(runDir, { recursive: true });
      const statePath = path.join(runDir, 'state.json');
      fs.writeFileSync(
        path.join(runDir, 'workflow.yml'),
        ['steps:', '  - id: guardrails', '    type: prompt', ''].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        statePath,
        JSON.stringify({
          run_id: 'runPlaceholder',
          workflow_id: 'demo',
          status: 'running',
          step_results: {
            guardrails: {
              type: 'prompt',
              integration: '{{ inputs.integration }}',
              model: '{{ inputs.model }}',
              status: 'completed'
            },
            specify: {
              type: 'command',
              integration: 'pi',
              model: 'gemini-2.8-pro',
              status: 'completed'
            }
          },
          updated_at: '2026-01-01T00:00:00.000000+00:00'
        }),
        'utf8'
      );

      runBash(scriptPath, [`--file=${logFile}`, `--import-state=${statePath}`]);

      const events = fs
        .readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      const unresolved = events.find((event) => event.step === 'guardrails');
      expect(unresolved.model).toBe('integration-default');
      expect(unresolved.agent).toBe('auto');
      expect(unresolved.subagent).toBe('none');

      const resolved = events.find((event) => event.step === 'specify');
      expect(resolved.model).toBe('gemini-2.8-pro');
      expect(resolved.agent).toBe('pi');
    });

    it('should show model and subagent columns in the summary', () => {
      runBash(scriptPath, [`--file=${logFile}`, `--import-state=${statePath}`]);
      // Combined import + summary in a single invocation must still print the table.
      const summaryOutput = runBash(scriptPath, [`--file=${logFile}`, '--import-state', '--summary'], {
        cwd: tempDir
      });

      expect(summaryOutput).toContain('MODEL');
      expect(summaryOutput).toContain('SUBAGENT');
      expect(summaryOutput).toContain('AGENT');
      expect(summaryOutput).toContain('SUBAGENT');
      expect(summaryOutput).toContain('LEAD TECHNICAL ARCHITECT.');
      expect(summaryOutput).toContain('gemini-2.8-pro');
      expect(summaryOutput).toContain('claude');
      expect(summaryOutput).toContain('none');
    });
  });

  it('should support --summary to display formatted telemetry table', () => {
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-quality-gate',
      '--status=passed',
      '--duration-ms=1200'
    ]);
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-bundle-budget',
      '--status=failed',
      '--duration-ms=850',
      '--exit-code=1'
    ]);

    const summaryOutput = runBash(scriptPath, [`--file=${logFile}`, '--summary']);
    expect(summaryOutput).toContain('[TELEMETRY SUMMARY]');
    expect(summaryOutput).toContain('check-quality-gate');
    expect(summaryOutput).toContain('check-bundle-budget');
    expect(summaryOutput).toContain('passed');
    expect(summaryOutput).toContain('failed');
    expect(summaryOutput).toContain('none');
  });
});
