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
      'bootstrap_env_early',
      'specify',
      'audit-spec',
      'review-spec',
      'plan',
      'generate-designs',
      'critique-design',
      'review-design',
      'tasks',
      'implement',
      'bootstrap_deps',
      'bootstrap_env',
      'gate_quality',
      'gate_bundle',
      'gate_runtime',
      'gate_contracts',
      'gate_tasks',
      'repair_gates',
      'verify',
      'gate_verdict',
      'repair_verdict',
      'telemetry_sync',
      'gate_verdict_final'
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

    // Imperative shell quality gates executed by the workflow engine with continue_on_error
    const bootstrapStep = wf.steps.find((s: any) => s.id === 'bootstrap_deps');
    expect(bootstrapStep.type).toBe('shell');
    expect(bootstrapStep.continue_on_error).toBe(true);
    expect(bootstrapStep.run).toContain('package.json');
    expect(bootstrapStep.run).toContain('node_modules');

    const qualityGateStep = wf.steps.find((s: any) => s.id === 'gate_quality');
    expect(qualityGateStep.type).toBe('shell');
    expect(qualityGateStep.continue_on_error).toBe(true);
    expect(qualityGateStep.run).toContain('check-quality-gate.sh');

    const bundleGateStep = wf.steps.find((s: any) => s.id === 'gate_bundle');
    expect(bundleGateStep.type).toBe('shell');
    expect(bundleGateStep.continue_on_error).toBe(true);
    expect(bundleGateStep.run).toContain('check-bundle-budget.sh');

    // Non-UI features must prove their declared runtime serves HTTP. The gate is
    // the mirror image of the UI branch: it only runs when has_ui is false.
    const runtimeGateStep = wf.steps.find((s: any) => s.id === 'gate_runtime');
    expect(runtimeGateStep.type).toBe('if');
    expect(runtimeGateStep.condition).toContain('not inputs.has_ui');
    expect(JSON.stringify(runtimeGateStep)).toContain('check-dev-entrypoint.sh');
    expect(JSON.stringify(runtimeGateStep)).toContain('--require-contract');

    const contractsGateStep = wf.steps.find((s: any) => s.id === 'gate_contracts');
    expect(contractsGateStep.type).toBe('if');
    expect(contractsGateStep.condition).toContain('inputs.has_ui');
    const contractChecks = contractsGateStep.then.map((s: any) => s.id);
    expect(contractChecks).toContain('gate_contracts_check');
    expect(contractChecks).toContain('gate_visual_check');

    // Deterministic bootstrap: git ownership + Playwright asset materialization
    const bootstrapEnv = wf.steps.find((s: any) => s.id === 'bootstrap_env');
    expect(bootstrapEnv.type).toBe('shell');
    expect(bootstrapEnv.continue_on_error).toBe(true);
    expect(bootstrapEnv.run).toContain('bootstrap-project-env.sh');

    // It must also run BEFORE the first agent step; otherwise every diff-based
    // gate audits an ancestor repository ($HOME) while spec/plan/design run.
    const stepOrder = wf.steps.map((s: any) => s.id);
    const earlyIndex = stepOrder.indexOf('bootstrap_env_early');
    expect(earlyIndex).toBeGreaterThan(stepOrder.indexOf('guardrails'));
    expect(earlyIndex).toBeLessThan(stepOrder.indexOf('specify'));
    expect(earlyIndex).toBeLessThan(stepOrder.indexOf('tasks'));

    // Bounded self-healing loop: every deterministic gate is repaired and re-run
    const repairGates = wf.steps.find((s: any) => s.id === 'repair_gates');
    expect(repairGates.type).toBe('if');
    expect(repairGates.condition).toContain('steps.gate_quality.output.exit_code != 0');
    expect(repairGates.condition).toContain('steps.gate_tasks.output.exit_code != 0');
    expect(repairGates.condition).toContain('steps.gate_visual_check.output.exit_code != 0');

    const repairLoop = repairGates.then.find((s: any) => s.id === 'repair_gates_loop');
    expect(repairLoop.type).toBe('do-while');
    expect(repairLoop.max_iterations).toBeGreaterThan(1);
    expect(repairLoop.condition).toContain('steps.recheck_quality.output.exit_code != 0');
    expect(repairLoop.condition).toContain('steps.recheck_tasks.output.exit_code != 0');

    // Each iteration resets the circuit breaker: otherwise attempt 3 is spent on
    // "CIRCUIT BREAKER TRIPPED" and a resumed run starts blocked.
    const repairStepIds = repairLoop.steps.map((s: any) => s.id);
    expect(repairStepIds[0]).toBe('reset_breaker');
    const resetStep = repairLoop.steps[0];
    expect(resetStep.type).toBe('shell');
    expect(resetStep.run).toContain('check-blast-radius.sh --reset');
    expect(repairStepIds).toContain('repair_agent');
    expect(repairStepIds).toContain('recheck_quality');
    expect(repairStepIds).toContain('recheck_bundle');
    expect(repairStepIds).toContain('recheck_contracts');
    expect(repairStepIds).toContain('recheck_tasks');

    // UI rechecks are nested under a has_ui guard, mirroring the gate structure
    const recheckContracts = repairLoop.steps.find((s: any) => s.id === 'recheck_contracts');
    expect(recheckContracts.type).toBe('if');
    expect(recheckContracts.condition).toContain('inputs.has_ui');
    expect(recheckContracts.then.map((s: any) => s.id)).toEqual([
      'recheck_contracts_check',
      'recheck_visual_check'
    ]);

    const repairAgent = repairLoop.steps.find((s: any) => s.id === 'repair_agent');
    expect(repairAgent.type).toBe('prompt');
    expect(repairAgent.prompt).toContain('AUTONOMOUS REPAIR');
    expect(repairAgent.prompt).toContain('--allow-no-tests');
    expect(repairAgent.prompt).toContain('NEVER edit');
    // A UI gate failure caused by missing designs must be repaired by producing
    // the artifacts, not by disabling the gate.
    expect(repairAgent.prompt).toContain('MISSING DESIGN ARTIFACTS');
    expect(repairAgent.prompt).toContain('wireframe HTML');

    // Recheck steps must propagate their exit code, otherwise the loop condition
    // can never observe a failure (the bug in the previous single-pass loop).
    for (const stepId of ['recheck_quality', 'recheck_bundle', 'recheck_tasks']) {
      const step = repairLoop.steps.find((s: any) => s.id === stepId);
      expect(step.continue_on_error).toBe(true);
      expect(step.run).not.toContain('|| true');
    }

    // Exhausted repair aborts the workflow instead of shipping a broken feature
    const failAfterRepair = repairGates.then.find((s: any) => s.id === 'fail_after_repair');
    expect(failAfterRepair.type).toBe('if');
    const abortStep = failAfterRepair.then.find((s: any) => s.id === 'abort_unrepaired');
    expect(abortStep.type).toBe('shell');
    expect(abortStep.run).toContain('exit 1');

    // Verdict repair loop: a rejecting audit triggers repair + re-audit
    const repairVerdict = wf.steps.find((s: any) => s.id === 'repair_verdict');
    expect(repairVerdict.type).toBe('if');
    expect(repairVerdict.condition).toContain('steps.gate_verdict.output.exit_code != 0');
    const verdictLoop = repairVerdict.then.find((s: any) => s.id === 'repair_verdict_loop');
    expect(verdictLoop.type).toBe('do-while');
    expect(verdictLoop.condition).toContain('steps.gate_verdict_retry.output.exit_code != 0');
    expect(verdictLoop.steps.map((s: any) => s.id)).toEqual([
      'reset_breaker_verdict',
      'verdict_repair_agent',
      'verify_retry',
      'gate_verdict_retry',
      'assess_verdict_progress'
    ]);
    expect(verdictLoop.steps[0].run).toContain('check-blast-radius.sh --reset');

    // Progress guard: a repair window that changed nothing reproduces the same
    // failure, so the loop must be able to observe that and stop early instead
    // of spending its remaining 30/45-minute attempts.
    expect(repairLoop.condition).toContain('steps.assess_repair_progress.output.exit_code == 0');
    expect(verdictLoop.condition).toContain('steps.assess_verdict_progress.output.exit_code == 0');
    expect(repairStepIds[repairStepIds.length - 1]).toBe('assess_repair_progress');

    // The baseline is captured in reset_breaker, AFTER the environment bootstrap,
    // so the guard measures the agent's work and not the environment's.
    expect(resetStep.run).toContain('repair-loop-guard.sh --snapshot');
    expect(resetStep.run.indexOf('bootstrap-project-env.sh'))
      .toBeLessThan(resetStep.run.indexOf('repair-loop-guard.sh --snapshot'));

    // The guard's exit code IS the loop verdict: swallowing it would make the
    // condition always true and the detector dead code.
    for (const guardId of ['assess_repair_progress', 'assess_verdict_progress']) {
      const guard = [...repairLoop.steps, ...verdictLoop.steps].find((s: any) => s.id === guardId);
      expect(guard.type).toBe('shell');
      expect(guard.continue_on_error).toBe(true);
      expect(guard.run).toContain('repair-loop-guard.sh --assess');
      expect(guard.run).not.toContain('|| true');
    }

    // Regression guard: an undefined step id evaluates `!= 0` as TRUE, so a
    // non-UI feature would otherwise enter the repair loop and abort a healthy
    // run. Every UI check reference must be gated behind inputs.has_ui.
    for (const condition of [repairGates.condition, repairLoop.condition, failAfterRepair.condition]) {
      expect(condition).toContain('inputs.has_ui and steps.');
    }

    // The final gate has no continue_on_error: a rejecting verdict fails the run.
    const finalVerdict = wf.steps.find((s: any) => s.id === 'gate_verdict_final');
    expect(finalVerdict.type).toBe('shell');
    expect(finalVerdict.continue_on_error).toBeUndefined();
    expect(finalVerdict.run).toContain('check-verification-verdict.sh');

    const auditSpecStep = wf.steps.find((s: any) => s.id === 'audit-spec');
    expect(auditSpecStep.type).toBe('prompt');
    expect(auditSpecStep.prompt).toContain('SPEC_AUDIT.md');
    expect(auditSpecStep.prompt).toContain('Acceptance Criteria');

    const verifyStep = wf.steps.find((s: any) => s.id === 'verify');
    expect(verifyStep.type).toBe('prompt');
    expect(verifyStep.prompt).toContain('LEAD ADVERSARIAL QUALITY AUDITOR');
    expect(verifyStep.prompt).toContain('AUDITOR.md');
    expect(verifyStep.prompt).toContain('verification.json');
    expect(verifyStep.prompt).toContain('VERIFICATION_REPORT.md');

    // The audit checklist lives in one place and is installed by the bundle
    const auditorPath = path.resolve(__dirname, '../templates/auditor.md');
    expect(fs.existsSync(auditorPath)).toBe(true);
    const auditor = fs.readFileSync(auditorPath, 'utf8');
    expect(auditor).toContain('Delta-Spec Sync');
    expect(auditor).toContain('Scenario');
    expect(auditor).toContain('impeccable');
    expect(auditor).toContain('--tokens-only');
    expect(auditor).toContain('"verdict": "pass"');

    const reviewSpecStep = wf.steps.find((s: any) => s.id === 'review-spec');
    expect(reviewSpecStep.type).toBe('if');
    expect(reviewSpecStep.condition).toContain('inputs.auto_continue');
    const reviewSpecGate = reviewSpecStep.then.find((s: any) => s.id === 'review-spec-gate');
    expect(reviewSpecGate.type).toBe('gate');
    expect(reviewSpecGate.options).toContain('approve');
    expect(reviewSpecGate.options).toContain('reject');

    const generateDesignsStep = wf.steps.find((s: any) => s.id === 'generate-designs');
    expect(generateDesignsStep.type).toBe('if');
    // Any UI feature needs design artifacts. Gating the step on enable_stitch
    // skipped it entirely when Stitch was disabled, and the --require-ui gates
    // then failed with nothing on disk.
    expect(generateDesignsStep.condition).toContain('inputs.has_ui');
    expect(generateDesignsStep.condition).not.toContain('inputs.enable_stitch');
    const designPrompt = generateDesignsStep.then.find((s: any) => s.id === 'design-assets');
    expect(designPrompt.prompt).toContain('Stitch');
    expect(designPrompt.prompt).toContain('LOCAL WIREFRAME PATH');
    expect(designPrompt.prompt).toContain('enable_stitch=false');
    expect(designPrompt.prompt).toContain('tokens.css');
    // The DOM must expose the tokens, not just the design file.
    expect(designPrompt.prompt).toContain('getComputedStyle(document.documentElement)');
    expect(designPrompt.prompt).toContain('routes-manifest.json');
    expect(designPrompt.prompt).toContain('stitch_project_id');
    expect(designPrompt.prompt).toContain('list_screens');
    expect(designPrompt.prompt).toContain('fixtures');

    // A prompt can complete without writing files: a deterministic gate must
    // fail in seconds instead of after implementation.
    const designIds = generateDesignsStep.then.map((s: any) => s.id);
    expect(designIds).toEqual(['design-assets', 'design_artifacts']);
    const designGate = generateDesignsStep.then.find((s: any) => s.id === 'design_artifacts');
    expect(designGate.type).toBe('shell');
    expect(designGate.continue_on_error).toBeUndefined();
    expect(designGate.run).toContain('check-design-artifacts.sh');

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
    expect(wf.inputs.skip_specify).toBeDefined();
    expect(wf.inputs.skip_specify.type).toBe('boolean');
    expect(wf.inputs.skip_specify.default).toBe(false);
    expect(wf.inputs.has_ui).toBeDefined();
    expect(wf.inputs.has_ui.default).toBe(true);
    expect(wf.inputs.enable_stitch).toBeDefined();
    expect(wf.inputs.stitch_project_id).toBeDefined();
    expect(wf.inputs.stitch_project_id.default).toBe('');

    // Conditional specify step
    const specifyStep = wf.steps.find((s: any) => s.id === 'specify');
    expect(specifyStep.type).toBe('if');
    expect(specifyStep.condition).toContain('inputs.skip_specify');
    const runSpecifyStep = specifyStep.then.find((s: any) => s.id === 'run-specify');
    expect(runSpecifyStep.command).toBe('speckit.specify');
    expect(runSpecifyStep.input.args).toContain('inputs.spec');

    // Hierarchical model tiering inputs
    expect(wf.inputs.model).toBeDefined();
    expect(wf.inputs.model.default).toBe('');
    expect(wf.inputs.implement_model).toBeDefined();
    expect(wf.inputs.implement_model.default).toBe('');

    // Multi-agent hybrid integration inputs
    expect(wf.inputs.implement_integration).toBeDefined();
    expect(wf.inputs.implement_integration.default).toBe('');

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
    expect(content).toContain('Subagent-Driven Execution Architecture');
    expect(content).toContain('Ephemeral Subagent Delegation');

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
    expect(autoContinueStep.integration).toContain('inputs.implement_integration | default(inputs.integration)');

    const pausedStep = implement.else.find((s: any) => s.id === 'implement-paused');
    expect(pausedStep.command).toBe('speckit.implement');
    expect(pausedStep.input.args).toContain('--phased');
    expect(pausedStep.input.args).toContain('--verify-gates');
    expect(pausedStep.input.args).toContain('--pause-after-phase');
    expect(pausedStep.model).toContain('inputs.implement_model | default(inputs.model)');
    expect(pausedStep.integration).toContain('inputs.implement_integration | default(inputs.integration)');
  });
});
