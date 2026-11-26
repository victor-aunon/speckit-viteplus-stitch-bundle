import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const root = path.resolve(__dirname, '..');

/**
 * The task-ledger protocol is prose, and prose is where this bundle keeps
 * losing. It was duplicated across the workflow prompt and six templates, none
 * of which said the one thing that matters: the gate cannot pass mid-feature, so
 * a compliant agent can never tick a box and a finished feature arrives with an
 * empty ledger. `gate_tasks` then reports it as incomplete and spends a repair
 * window on bookkeeping.
 *
 * This test pins the whole protocol in every copy, so a future edit to one file
 * cannot silently reintroduce the deadlock in the other five.
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

describe('task ledger protocol', () => {
  const workflow = yaml.parse(read('workflows/viteplus-stitch/workflow.yml'));
  const guardrailsStep = workflow.steps.find((step: any) => step.id === 'guardrails');
  const repairLoop = workflow.steps
    .find((step: any) => step.id === 'repair_gates')
    .then.find((step: any) => step.id === 'repair_gates_loop');
  const repairAgent = repairLoop.steps.find((step: any) => step.id === 'repair_agent');

  it('tells the agent the per-task gate is expected to fail mid-feature', () => {
    // Without this, the instruction "verify it passes after each task" reads as
    // a precondition the agent must satisfy, and it cannot.
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/EXPECTED to exit non-zero/i);
    }
    expect(guardrailsStep.prompt).toMatch(/EXPECTED to exit non-zero/i);
  });

  it('requires reconciling the ledger once the gate is green', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toContain('reconcile');
    }
    expect(guardrailsStep.prompt).toContain('reconcile');
    expect(repairAgent.prompt).toMatch(/RECONCILE THE LEDGER/i);
  });

  it('keeps ticking legal only on a green gate', () => {
    // The anti-fraud property is the reason the deadlock exists; it must not be
    // relaxed to fix the deadlock.
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/while the gate exits non-zero is a fatal violation/i);
    }
    expect(guardrailsStep.prompt).toMatch(/while the gate exits non-zero is strictly forbidden/i);
    expect(repairAgent.prompt).toMatch(/exits 0/i);
  });

  it('demands a justification per tick instead of a blind batch pass', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/justification/);
    }
    expect(repairAgent.prompt).toMatch(/justification/);
  });

  it('ties polish and verification tasks to the gate that proves them', () => {
    for (const rel of GUARDRAIL_FILES) {
      expect(read(rel), rel).toMatch(/verification tasks are ticked only when the gate/i);
    }
  });

  it('points the tasks gate failure at the missing reconciliation', () => {
    // The agent reads this output inside the repair window; it is the cheapest
    // possible place to name the actual problem.
    const gate = read('scripts/check-tasks-complete.sh');
    expect(gate).toMatch(/ledger was never reconciled/i);
    expect(gate).toContain('AGENTS.md');
  });

  it('no copy still states the unimplementable absolute rule', () => {
    const stale = /Marking a task `- \[x\]` without executing the quality gate in the terminal is strictly forbidden/;
    expect(guardrailsStep.prompt).not.toMatch(stale);
  });
});
