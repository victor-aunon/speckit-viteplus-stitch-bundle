import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'yaml';

/**
 * The Spec Kit workflow expression engine is NOT a Jinja2 environment. It only
 * registers these filters (see specify_cli/workflows/expressions.py):
 *   default, join, map, contains, from_json
 *
 * Using anything else (e.g. `replace`) parses fine at authoring time and only
 * explodes at runtime, mid-run, when the step prompt is rendered. That is how
 * `inputs.stitch_project_id | replace('projects/', '')` broke the workflow
 * during `generate-designs`.
 */
const ALLOWED_FILTERS = new Set(['default', 'join', 'map', 'contains', 'from_json']);

const workflowPath = path.resolve(__dirname, '../workflows/viteplus-stitch/workflow.yml');

function collectTemplates(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node.includes('{{') || node.includes('{%')) acc.push(node);
  } else if (Array.isArray(node)) {
    for (const value of node) collectTemplates(value, acc);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectTemplates(value, acc);
    }
  }
  return acc;
}

/** Filter names used inside `{{ ... }}` blocks (never inside shell pipelines). */
function filtersIn(template: string): string[] {
  const names: string[] = [];
  for (const block of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    for (const match of block[1].matchAll(/\|\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
      names.push(match[1]);
    }
  }
  return names;
}

describe('workflow expressions', () => {
  const templates = collectTemplates(yaml.parse(fs.readFileSync(workflowPath, 'utf8')));

  it('should collect the workflow templates it is about to check', () => {
    // Guard against a silently empty scan (wrong path / parser change).
    expect(templates.length).toBeGreaterThan(20);
  });

  it('only uses filters the Spec Kit expression engine registers', () => {
    const unsupported: string[] = [];
    for (const template of templates) {
      for (const filter of filtersIn(template)) {
        if (!ALLOWED_FILTERS.has(filter)) unsupported.push(filter);
      }
    }
    expect([...new Set(unsupported)]).toEqual([]);
  });

  it('detects unsupported filters (negative control for the scanner)', () => {
    const probe = `{{ inputs.stitch_project_id | replace('projects/', '') }}`;
    const found = filtersIn(probe);
    expect(found).toContain('replace');
    expect(found.some((filter) => !ALLOWED_FILTERS.has(filter))).toBe(true);
    // And it must not treat a shell pipeline outside `{{ }}` as a filter.
    expect(filtersIn('run: grep -E "x" | head -n 1')).toEqual([]);
  });

  // `specify_cli` lives in the CLI's own tool venv, not in the system python.
  // Resolve the interpreter from the `specify` launcher shebang.
  const specifyPython = ((): string | null => {
    const located = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['specify'], {
      encoding: 'utf8'
    });
    if (located.status !== 0) return null;
    const launcher = located.stdout.trim().split(/\r?\n/)[0];
    try {
      const shebang = fs.readFileSync(launcher, 'utf8').split('\n')[0];
      const match = /^#!\s*(\S+)/.exec(shebang);
      if (match && fs.existsSync(match[1])) return match[1];
    } catch {
      return null;
    }
    return null;
  })();

  const cliAvailable =
    specifyPython !== null &&
    spawnSync(specifyPython, ['-c', 'import specify_cli'], { encoding: 'utf8' }).status === 0;

  it.skipIf(!cliAvailable)('renders every template with the real Spec Kit evaluator', () => {
    const inputs = {
      spec: 'build a billing feature',
      scope: 'src/features/billing',
      skip_specify: false,
      has_ui: true,
      enable_stitch: true,
      stitch_project_id: 'projects/123456',
      integration: 'pi',
      implement_integration: '',
      auto_continue: false,
      model: '',
      implement_model: ''
    };

    const script = `
import json, sys
from specify_cli.workflows.expressions import evaluate_expression

class Ctx:
    def __init__(self, inputs):
        self.inputs = inputs
        self.steps = {}
        self.run_id = "probe"
        self.workflow_dir = "/tmp"

payload = json.load(sys.stdin)
failures = []
for variant in ("with_stitch_id", "without_stitch_id", "stitch_disabled", "no_ui", "with_skip_specify"):
    inputs = dict(payload["inputs"])
    if variant == "without_stitch_id":
        inputs["stitch_project_id"] = ""
    if variant == "stitch_disabled":
        inputs["enable_stitch"] = False
    if variant == "no_ui":
        inputs["has_ui"] = False
    if variant == "with_skip_specify":
        inputs["skip_specify"] = True
    for item in payload["templates"]:
        try:
            evaluate_expression(item["text"], Ctx(inputs))
        except Exception as exc:
            failures.append(f'{variant} {item["path"]}: {type(exc).__name__}: {exc}')
print(json.dumps(failures))
`;

    const result = spawnSync(specifyPython as string, ['-c', script], {
      input: JSON.stringify({ inputs, templates: templates.map((text, index) => ({ path: `t${index}`, text })) }),
      encoding: 'utf8'
    });

    expect(result.status, result.stderr).toBe(0);
    const failures = JSON.parse(result.stdout.trim() || '[]');
    expect(failures).toEqual([]);
  });

  // The expression engine has NO grouping support: it splits on top-level
  // ` or `, then ` and `, then comparisons, and a bracketed sub-expression falls
  // through to identifier resolution and evaluates to False. Every UI-only and
  // runtime-only gate was therefore invisible to `repair_gates` and
  // `fail_after_repair` for as long as those conditions wrapped the profile
  // guards in `( )` — a failing contracts/visual gate never entered the repair
  // window and never aborted the run. Syntax-level assertions cannot see that,
  // so this evaluates the real conditions against the real evaluator.
  it('keeps every gate condition parenthesis-free', () => {
    const wf = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));
    const offenders: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, index) => walk(child, `${at}[${index}]`));
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'condition' && typeof value === 'string' && /[()]/.test(value)) {
          offenders.push(`${at}.condition: ${value}`);
        }
        walk(value, `${at}.${key}`);
      }
    };
    walk(wf, 'workflow');
    expect(offenders).toEqual([]);
  });

  it.skipIf(!cliAvailable)('evaluates every gate condition for both profiles', () => {
    const script = `
import json, sys, yaml
from specify_cli.workflows.expressions import evaluate_condition

payload = json.load(sys.stdin)
wf = yaml.safe_load(open(payload["workflow_path"]))

def find(node, sid):
    if isinstance(node, dict):
        if node.get("id") == sid:
            return node
        for value in node.values():
            found = find(value, sid)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = find(value, sid)
            if found:
                return found
    return None

class Ctx:
    def __init__(self, steps, has_ui):
        self.steps = steps
        self.inputs = {"has_ui": has_ui}
        self.run_id = "probe"
        self.workflow_dir = "/tmp"

ALL = ["gate_quality", "gate_bundle", "gate_runtime_check", "gate_contracts_check",
       "gate_visual_check", "gate_tasks", "recheck_quality", "recheck_bundle",
       "recheck_runtime_check", "recheck_contracts_check", "recheck_visual_check",
       "recheck_tasks"]

def steps(**overrides):
    base = {key: {"output": {"exit_code": 0}} for key in ALL}
    for key, value in overrides.items():
        base[key] = {"output": {"exit_code": value}}
    return base

repair_gates = find(wf, "repair_gates")["condition"]
fail_after = find(wf, "fail_after_repair")["condition"]

failures = []
def check(label, condition, expected, has_ui, **overrides):
    got = evaluate_condition(condition, Ctx(steps(**overrides), has_ui))
    if got != expected:
        failures.append(f"{label} has_ui={has_ui} -> {got} (expected {expected})")

for has_ui in (True, False):
    # Any always-on gate failure must open the repair window and abort if unfixed.
    for gate in ("gate_quality", "gate_bundle", "gate_tasks"):
        check(f"repair_gates:{gate}", repair_gates, True, has_ui, **{gate: 1})
    for gate in ("recheck_quality", "recheck_bundle", "recheck_tasks"):
        check(f"fail_after:{gate}", fail_after, True, has_ui, **{gate: 1})
    # Profile-only gates: only the profile that owns them may react.
    for gate in ("gate_contracts_check", "gate_visual_check"):
        check(f"repair_gates:{gate}", repair_gates, has_ui, has_ui, **{gate: 1})
    for gate in ("recheck_contracts_check", "recheck_visual_check"):
        check(f"fail_after:{gate}", fail_after, has_ui, has_ui, **{gate: 1})
    check("repair_gates:runtime", repair_gates, not has_ui, has_ui, gate_runtime_check=1)
    check("fail_after:runtime", fail_after, not has_ui, has_ui, recheck_runtime_check=1)

    # Everything green: neither the loop nor the abort may fire.
    check("fail_after:green", fail_after, False, has_ui)

print(json.dumps(failures))
`;

    const result = spawnSync(specifyPython as string, ['-c', script], {
      input: JSON.stringify({ workflow_path: workflowPath }),
      encoding: 'utf8'
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim() || '[]')).toEqual([]);
  });
});
