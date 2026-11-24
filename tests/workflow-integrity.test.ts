import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

/**
 * Structural integrity of the workflow definition: every script, flag, step id,
 * input and hook it references must exist, and conditions must not be able to
 * read a step that never ran (an undefined id compared with `!= 0` is TRUE).
 */
describe('workflow integrity', () => {
  const root = path.resolve(__dirname, '..');
  const workflowPath = path.join(root, 'workflows/viteplus-stitch/workflow.yml');
  const workflow = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));

  const strings: string[] = [];
  const stepIds = new Set<string>();
  const loops: any[] = [];

  const walk = (node: unknown, parent?: string): void => {
    if (typeof node === 'string') {
      strings.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, parent);
      return;
    }
    if (node && typeof node === 'object') {
      const step = node as Record<string, any>;
      if (typeof step.id === 'string') stepIds.add(step.id);
      if (step.type === 'do-while') loops.push(step);
      for (const key of ['then', 'else', 'steps']) {
        if (Array.isArray(step[key])) walk(step[key], step.id ?? parent);
      }
      for (const key of ['condition', 'run', 'prompt', 'args', 'command']) {
        if (typeof step[key] === 'string') strings.push(step[key]);
      }
    }
  };
  walk(workflow.steps);

  const scriptRefs = new Set<string>();
  const flagRefs: Array<{ script: string; flag: string }> = [];
  for (const text of strings) {
    for (const match of text.matchAll(/scripts\/bash\/([A-Za-z0-9_.-]+\.sh)([^\n]*)/g)) {
      scriptRefs.add(match[1]);
      for (const flag of match[2].matchAll(/(--[a-z][a-z0-9-]*)/g)) {
        flagRefs.push({ script: match[1], flag: flag[1] });
      }
    }
  }

  it('references only scripts that exist and are shipped by the installer', () => {
    expect(scriptRefs.size).toBeGreaterThan(5);
    const installer = fs.readFileSync(path.join(root, 'scripts/install.sh'), 'utf8');
    for (const script of scriptRefs) {
      expect(fs.existsSync(path.join(root, 'scripts', script)), `missing scripts/${script}`).toBe(true);
      expect(installer, `install.sh does not ship ${script}`).toContain(script);
    }
  });

  it('uses only flags the target script actually parses', () => {
    const unknown: string[] = [];
    for (const { script, flag } of flagRefs) {
      const body = fs.readFileSync(path.join(root, 'scripts', script), 'utf8');
      if (!body.includes(flag)) unknown.push(`${flag} -> ${script}`);
    }
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('references only step ids that exist', () => {
    const referenced = new Set<string>();
    for (const text of strings) {
      for (const match of text.matchAll(/steps\.([A-Za-z0-9_:-]+)/g)) referenced.add(match[1]);
    }
    expect(referenced.size).toBeGreaterThan(5);
    const missing = [...referenced].filter((id) => !stepIds.has(id));
    expect(missing).toEqual([]);
  });

  it('guards profile-only step references with inputs.has_ui', () => {
    // An undefined nested id compared with `!= 0` evaluates TRUE, which would send
    // a run of the other profile into the repair loop and abort it. Each profile-only
    // step id must be read behind the exact guard that makes it exist.
    const profileOnly: Array<{ id: string; guard: string }> = [
      { id: 'gate_contracts_check', guard: 'inputs.has_ui and steps.' },
      { id: 'gate_visual_check', guard: 'inputs.has_ui and steps.' },
      { id: 'recheck_contracts_check', guard: 'inputs.has_ui and steps.' },
      { id: 'recheck_visual_check', guard: 'inputs.has_ui and steps.' },
      // Non-UI runtime gate: the mirror image. `not inputs.has_ui` is the only
      // condition under which these steps run at all.
      { id: 'gate_runtime_check', guard: 'not inputs.has_ui and steps.' },
      { id: 'recheck_runtime_check', guard: 'not inputs.has_ui and steps.' },
    ];
    const unguarded: string[] = [];
    for (const text of strings) {
      for (const { id, guard } of profileOnly) {
        if (text.includes(`steps.${id}`) && !text.includes(`${guard}${id}`)) {
          unguarded.push(id);
        }
      }
    }
    expect([...new Set(unguarded)]).toEqual([]);
  });

  it('never swallows the exit code of a step a do-while condition reads', () => {
    const offenders: string[] = [];
    const collectShells = (steps: any[]): any[] => {
      const found: any[] = [];
      for (const step of steps || []) {
        if (step?.type === 'shell') found.push(step);
        for (const key of ['then', 'else', 'steps']) {
          if (Array.isArray(step?.[key])) found.push(...collectShells(step[key]));
        }
      }
      return found;
    };
    for (const loop of loops) {
      const condition = String(loop.condition || '');
      for (const shell of collectShells(loop.steps)) {
        if (condition.includes(`steps.${shell.id}.`) && /\|\|\s*true/.test(shell.run || '')) {
          offenders.push(shell.id);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('references only declared inputs', () => {
    const declared = new Set(Object.keys(workflow.inputs || {}));
    const unknown = new Set<string>();
    for (const text of strings) {
      for (const match of text.matchAll(/inputs\.([A-Za-z0-9_]+)/g)) {
        if (!declared.has(match[1])) unknown.add(match[1]);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it('keeps hooks pointing at installed scripts', () => {
    const extensions = yaml.parse(fs.readFileSync(path.join(root, 'extensions/extensions.yml'), 'utf8'));
    const missing: string[] = [];
    for (const [section, hooks] of Object.entries<any>(extensions.hooks || {})) {
      for (const hook of hooks) {
        const match = /scripts\/bash\/([A-Za-z0-9_.-]+\.sh)/.exec(hook.command || '');
        if (match && !fs.existsSync(path.join(root, 'scripts', match[1]))) {
          missing.push(`${section}/${hook.name} -> ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the schema test step list in sync with the workflow', () => {
    const schemaTest = fs.readFileSync(path.join(root, 'tests/workflow-schema.test.ts'), 'utf8');
    const start = schemaTest.indexOf('expect(stepIds).toEqual([');
    const end = schemaTest.indexOf(']);', start);
    const listed = (schemaTest.slice(start, end).match(/'([a-z0-9_-]+)'/g) || []).map((x) => x.slice(1, -1));
    expect(listed).toEqual(workflow.steps.map((step: any) => step.id));
  });
});
