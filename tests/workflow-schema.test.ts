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
      'audit-spec',
      'review-spec',
      'plan',
      'generate-designs',
      'critique-design',
      'review-design',
      'tasks',
      'implement',
      'bootstrap-deps',
      'gate-quality',
      'gate-bundle',
      'gate-contracts',
      'verify'
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

    // Imperative shell quality gates executed by the workflow engine
    const bootstrapStep = wf.steps.find((s: any) => s.id === 'bootstrap-deps');
    expect(bootstrapStep.type).toBe('shell');
    expect(bootstrapStep.run).toContain('package.json');
    expect(bootstrapStep.run).toContain('node_modules');

    const qualityGateStep = wf.steps.find((s: any) => s.id === 'gate-quality');
    expect(qualityGateStep.type).toBe('shell');
    expect(qualityGateStep.run).toContain('check-quality-gate.sh');

    const bundleGateStep = wf.steps.find((s: any) => s.id === 'gate-bundle');
    expect(bundleGateStep.type).toBe('shell');
    expect(bundleGateStep.run).toContain('check-bundle-budget.sh');

    const contractsGateStep = wf.steps.find((s: any) => s.id === 'gate-contracts');
    expect(contractsGateStep.type).toBe('if');
    expect(contractsGateStep.condition).toContain('inputs.has_ui');
    const contractChecks = contractsGateStep.then.map((s: any) => s.id);
    expect(contractChecks).toContain('gate-contracts-check');
    expect(contractChecks).toContain('gate-visual-check');

    const auditSpecStep = wf.steps.find((s: any) => s.id === 'audit-spec');
    expect(auditSpecStep.type).toBe('prompt');
    expect(auditSpecStep.prompt).toContain('SPEC_AUDIT.md');
    expect(auditSpecStep.prompt).toContain('Acceptance Criteria');

    const verifyStep = wf.steps.find((s: any) => s.id === 'verify');
    expect(verifyStep.type).toBe('prompt');
    expect(verifyStep.prompt).toContain('VERIFICATION_REPORT.md');
    expect(verifyStep.prompt).toContain('Delta-Spec Sync');
    expect(verifyStep.prompt).toContain('Scenario Verification Matrix');
    expect(verifyStep.prompt).toContain('impeccable');

    const reviewSpecStep = wf.steps.find((s: any) => s.id === 'review-spec');
    expect(reviewSpecStep.type).toBe('if');
    expect(reviewSpecStep.condition).toContain('inputs.auto_continue');
    const reviewSpecGate = reviewSpecStep.then.find((s: any) => s.id === 'review-spec-gate');
    expect(reviewSpecGate.type).toBe('gate');
    expect(reviewSpecGate.options).toContain('approve');
    expect(reviewSpecGate.options).toContain('reject');

    const generateDesignsStep = wf.steps.find((s: any) => s.id === 'generate-designs');
    expect(generateDesignsStep.type).toBe('if');
    expect(generateDesignsStep.condition).toContain('inputs.has_ui');
    expect(generateDesignsStep.condition).toContain('inputs.enable_stitch');
    const stitchPrompt = generateDesignsStep.then.find((s: any) => s.id === 'stitch-design-generation');
    expect(stitchPrompt.prompt).toContain('Stitch');
    expect(stitchPrompt.prompt).toContain('tokens.css');
    expect(stitchPrompt.prompt).toContain('routes-manifest.json');

    const critiqueStep = wf.steps.find((s: any) => s.id === 'critique-design');
    expect(critiqueStep.type).toBe('if');
    expect(critiqueStep.condition).toContain('inputs.has_ui');
    const critiquePrompt = critiqueStep.then.find((s: any) => s.id === 'impeccable-critique');
    expect(critiquePrompt.prompt).toContain('impeccable');
    expect(critiquePrompt.prompt).toContain('DESIGN_CRITIQUE.md');

    const reviewDesignStep = wf.steps.find((s: any) => s.id === 'review-design');
    expect(reviewDesignStep.type).toBe('if');
    expect(reviewDesignStep.condition).toContain('inputs.has_ui');
    expect(reviewDesignStep.condition).toContain('inputs.auto_continue');
    const reviewDesignGate = reviewDesignStep.then.find((s: any) => s.id === 'review-design-gate');
    expect(reviewDesignGate.type).toBe('gate');
    expect(reviewDesignGate.options).toContain('approve');
    expect(reviewDesignGate.options).toContain('reject');
    expect(reviewDesignGate.on_reject).toBe('abort');

    expect(wf.inputs.spec).toBeDefined();
    expect(wf.inputs.scope).toBeDefined();
    expect(wf.inputs.scope.default).toBe('');
    expect(wf.inputs.has_ui).toBeDefined();
    expect(wf.inputs.has_ui.default).toBe(true);
    expect(wf.inputs.enable_stitch).toBeDefined();

    // Hierarchical model tiering inputs
    expect(wf.inputs.model).toBeDefined();
    expect(wf.inputs.model.default).toBe('');
    expect(wf.inputs.implement_model).toBeDefined();
    expect(wf.inputs.implement_model.default).toBe('');

    const planStep = wf.steps.find((s: any) => s.id === 'plan');
    expect(planStep.model).toContain('inputs.model');
  });

  it('should ship a guardrails policy that forbids weakening quality gates and enforces Impeccable lifecycle', () => {
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

    // Impeccable UI Craft Lifecycle
    expect(content).toContain('Impeccable UI Craft Lifecycle');
    expect(content).toContain('impeccable critique');
    expect(content).toContain('impeccable harden');
    expect(content).toContain('impeccable animate');

    // Automated Spec Quality & Completeness
    expect(content).toContain('Automated Spec Quality & Completeness');
    expect(content).toContain('audit-spec');
    expect(content).toContain('SPEC_AUDIT.md');
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
    expect(autoContinueStep.model).toContain('inputs.implement_model | default(inputs.model)');

    const pausedStep = implement.else.find((s: any) => s.id === 'implement-paused');
    expect(pausedStep.command).toBe('speckit.implement');
    expect(pausedStep.input.args).toContain('--phased');
    expect(pausedStep.input.args).toContain('--verify-gates');
    expect(pausedStep.input.args).toContain('--pause-after-phase');
    expect(pausedStep.model).toContain('inputs.implement_model | default(inputs.model)');
  });
});
