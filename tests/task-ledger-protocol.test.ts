import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const root = path.resolve(__dirname, '..');

/**
 * The task ledger has two owners, and the split is the whole point:
 *
 *  - untagged tasks are implementation work, ticked by the agent after the
 *    (scoped) quality gate it can actually run mid-feature;
 *  - `[verify:<gate>]` tasks are gate results, ticked AND un-ticked by
 *    `reconcile-task-ledger.sh` from the evidence those gates wrote.
 *
 * Before this split, the checkbox was a hand-maintained mirror of gate state
 * that the agent could not keep accurate, so a finished feature arrived with an
 * empty ledger and `gate_tasks` failed. The prose lives in seven copies; this
 * test keeps them from drifting apart again.
 */
const GUARDRAIL_FILES = [
  'templates/guardrails.md',
  'templates/AGENTS.md.tmpl',
  'templates/AGENTS.fullstack.md.tmpl',
  'templates/AGENTS.vanilla.md.tmpl',
  'templates/AGENTS.api.md.tmpl',
  'templates/AGENTS.react.md.tmpl',
];

const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

describe('task ledger ownership', () => {
  const workflow = yaml.parse(read('workflows/viteplus-stitch/workflow.yml'));
  const stepIds = workflow.steps.map((step: any) => step.id);
  const guardrailsStep = workflow.steps.find((step: any) => step.id === 'guardrails');
  const repairLoop = workflow.steps
    .find((step: any) => step.id === 'repair_gates')
    .then.find((step: any) => step.id === 'repair_gates_loop');

  it('names both owners in every copy of the rules', () => {
    for (const rel of GUARDRAIL_FILES) {
      const text = read(rel);
      expect(text, rel).toMatch(/TWO KINDS OF TASK, TWO OWNERS/i);
      expect(text, rel).toMatch(/IMPLEMENTATION TASKS \(untagged\) are yours/i);
      expect(text, rel).toMatch(/VERIFICATION TASKS \(`\[verify:<gate>\]`\) are NOT yours/i);
    }
    expect(guardrailsStep.prompt).toMatch(/TWO KINDS OF TASK, TWO OWNERS/i);
  });

  it('forbids hand-editing a gate-derived checkbox', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/never tick and never un-tick/i);
    }
    const repairAgent = repairLoop.steps.find((step: any) => step.id === 'repair_agent');
    expect(repairAgent.prompt).toMatch(/NEVER TOUCH `\[verify:/);
  });

  it('points implementation tasks at the scoped gate that can be green mid-feature', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toContain('--scope');
    }
  });

  it('routes every untagged tick through the enforcing script', () => {
    // "Tick only on a green gate" was prose nobody could check. The precondition
    // is now enforced by mark-task-done.sh, which also refuses a STALE pass.
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toContain('mark-task-done.sh');
      expect(read(rel), rel).toMatch(/fatal violation of Quality Gate Integrity/i);
    }
    expect(guardrailsStep.prompt).toContain('mark-task-done.sh');
    expect(guardrailsStep.prompt).toMatch(/postdates your\s+last edit/i);
  });

  it('forbids hand-editing an untagged checkbox', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/never by editing `tasks\.md`/i);
    }
    const repairAgent = repairLoop.steps.find((step: any) => step.id === 'repair_agent');
    expect(repairAgent.prompt).toMatch(/never by editing `tasks\.md`/i);
  });

  it('tells the agent to tag the verification tasks it writes', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/TAG NEW VERIFICATION TASKS/i);
    }
    expect(guardrailsStep.prompt).toMatch(/TAG NEW VERIFICATION TASKS/i);
  });

  it('reconciles the ledger BEFORE the completion gate judges it', () => {
    // Judging a ledger that has not been reconciled is what made a finished
    // feature report as incomplete.
    expect(stepIds.indexOf('reconcile_tasks')).toBeGreaterThan(-1);
    expect(stepIds.indexOf('reconcile_tasks')).toBeLessThan(stepIds.indexOf('gate_tasks'));

    const repairIds = repairLoop.steps.map((step: any) => step.id);
    expect(repairIds).toContain('reconcile_tasks_recheck');
    expect(repairIds.indexOf('reconcile_tasks_recheck')).toBeLessThan(
      repairIds.indexOf('recheck_tasks')
    );
  });

  it('runs the reconciler with no swallowed exit code', () => {
    // continue_on_error already keeps the workflow alive; `|| true` would also
    // hide the exit-2 that flags an unknown tag.
    for (const id of ['reconcile_tasks']) {
      const step = workflow.steps.find((candidate: any) => candidate.id === id);
      expect(step.type).toBe('shell');
      expect(step.continue_on_error).toBe(true);
      expect(step.run).not.toContain('|| true');
      expect(step.run).toContain('reconcile-task-ledger.sh');
    }
  });

  it('reports pending work by owner, not as one number', () => {
    const gate = read('scripts/check-tasks-complete.sh');
    expect(gate).toContain('implementation: $PENDING_UNTAGGED, gate-derived: $PENDING_TAGGED');
    expect(gate).toMatch(/\[verify:\*\] tasks: the gate each one names is RED/i);
  });

  it('ships the reconciler through the installer', () => {
    expect(fs.existsSync(path.join(root, 'scripts/reconcile-task-ledger.sh'))).toBe(true);
    expect(read('scripts/install.sh')).toContain('reconcile-task-ledger.sh');
  });

  it('documents the tag vocabulary where the agent reads it', () => {
    for (const tag of ['quality', 'contracts', 'design', 'bundle', 'runtime']) {
      expect(read('templates/guardrails.md')).toContain(tag);
    }
  });
});
