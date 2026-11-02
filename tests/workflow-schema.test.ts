import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

describe('Workflow YAML Schema Validation', () => {
  it('should declare all required gates and steps in workflow.yml', () => {
    const wfPath = path.resolve(__dirname, '../workflows/viteplus-stitch/workflow.yml');
    expect(fs.existsSync(wfPath)).toBe(true);
    const wf = yaml.parse(fs.readFileSync(wfPath, 'utf8'));
    expect(wf.schema_version).toBe('1.0');
    expect(wf.workflow.id).toBe('viteplus-stitch');
    expect(wf.workflow.name).toBe('Vite+ Stitch SDD Lifecycle');

    const stepIds = wf.steps.map((s: any) => s.id);
    expect(stepIds).toEqual([
      'guardrails',
      'specify',
      'review-spec',
      'plan',
      'review-design',
      'tasks',
      'implement'
    ]);

    // The first step must instruct the model that gate tampering is forbidden
    // before it is allowed to touch any code.
    const guardrails = wf.steps[0];
    expect(guardrails.type).toBe('prompt');
    expect(guardrails.integration).toContain('inputs.integration');
    expect(guardrails.prompt).toContain('NON-NEGOTIABLE');
    expect(guardrails.prompt).toContain('vite.config.ts');
    expect(guardrails.prompt).toContain('check-quality-gate.sh');
    expect(guardrails.prompt).toContain('GUARDRAILS.md');

    const reviewSpecGate = wf.steps.find((s: any) => s.id === 'review-spec');
    expect(reviewSpecGate.type).toBe('gate');
    expect(reviewSpecGate.options).toContain('approve');
    expect(reviewSpecGate.options).toContain('reject');

    const reviewDesignGate = wf.steps.find((s: any) => s.id === 'review-design');
    expect(reviewDesignGate.type).toBe('gate');
    expect(reviewDesignGate.options).toContain('approve');
    expect(reviewDesignGate.options).toContain('request_changes');

    expect(wf.inputs.spec).toBeDefined();
    expect(wf.inputs.enable_stitch).toBeDefined();
  });

  it('should ship a guardrails policy that forbids weakening quality gates', () => {
    const guardrailsPath = path.resolve(__dirname, '../templates/guardrails.md');
    expect(fs.existsSync(guardrailsPath)).toBe(true);
    const content = fs.readFileSync(guardrailsPath, 'utf8');

    expect(content).toContain('Non-Negotiable');
    expect(content).toContain('vite.config.ts');
    expect(content).toContain('check-quality-gate.sh');
    expect(content).toContain('check-env-config.sh');
    expect(content).toContain('verify-stitch-design.sh');
    expect(content).toContain('package.json');
    expect(content).toContain('eslint-disable');
    expect(content).toContain('ask the human');
  });

  it('should pause after every implementation phase by default and allow --auto-continue', () => {
    const wfPath = path.resolve(__dirname, '../workflows/viteplus-stitch/workflow.yml');
    const wf = yaml.parse(fs.readFileSync(wfPath, 'utf8'));

    expect(wf.inputs.auto_continue).toBeDefined();
    expect(wf.inputs.auto_continue.type).toBe('boolean');
    expect(wf.inputs.auto_continue.default).toBe(false);

    const implement = wf.steps.find((s: any) => s.id === 'implement');
    expect(implement.type).toBe('if');
    expect(implement.condition).toContain('inputs.auto_continue');

    const autoContinueStep = implement.then.find((s: any) => s.id === 'implement-auto');
    expect(autoContinueStep.command).toBe('speckit.implement');
    expect(autoContinueStep.input.args).toContain('--phased');
    expect(autoContinueStep.input.args).toContain('--verify-gates');
    expect(autoContinueStep.input.args).toContain('--auto-continue');

    const pausedStep = implement.else.find((s: any) => s.id === 'implement-paused');
    expect(pausedStep.command).toBe('speckit.implement');
    expect(pausedStep.input.args).toContain('--phased');
    expect(pausedStep.input.args).toContain('--verify-gates');
    expect(pausedStep.input.args).toContain('--pause-after-phase');
  });
});
