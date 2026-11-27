import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

/**
 * The workflow engine substitutes `{{ ... }}` and nothing else. `{% if %}` /
 * `{% else %}` / `{% endif %}` are NOT evaluated: they are delivered to the
 * consumer as literal text, and the block is always included.
 *
 * This is not a style preference. Captured argv from a real run:
 *
 *     {% if inputs.scope %}
 *     FEATURE SCOPE RESTRICTION: All work is restricted to slice ''.
 *     ...
 *     {% endif %}
 *
 *     /speckit.plan A dialog {% if inputs.scope %}--scope={% endif %} --with-viteplus ...
 *
 * and captured bash argv from a gate step:
 *
 *     bash check-quality-gate.sh {% if inputs.scope %}--scope={% endif %}
 *
 * That last one is the quiet one: bash passes `{%`, `if`, `inputs.scope`,
 * `%}--scope={%`, `endif`, `%}` as six literal arguments, the gate scripts ignore
 * unknown arguments, and the run continues *unscoped*. The blast radius then
 * relies on auto-detection from `git status` instead of the declared slice.
 *
 * Conditional text has to be computed by a step and interpolated with
 * `{{ steps.<id>.output.stdout }}`. Spec Kit does support conditional branching —
 * as a `type: if` step with `condition` / `then` / `else` — but that chooses
 * between steps; it cannot wrap a paragraph inside one.
 */

const workflowPath = path.resolve(__dirname, '../workflows/viteplus-stitch/workflow.yml');

/** Fields the engine interpolates. Anything else is data the engine never reads. */
const INTERPOLATED_FIELDS = ['prompt', 'run', 'args'] as const;

type Found = { where: string; text: string };

function collect(node: unknown, into: Found[] = []): Found[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, into);
    return into;
  }
  if (!node || typeof node !== 'object') return into;

  const record = node as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '(anonymous)';
  for (const field of INTERPOLATED_FIELDS) {
    const value = record[field];
    if (typeof value === 'string') into.push({ where: `${id}.${field}`, text: value });
  }
  for (const [key, value] of Object.entries(record)) {
    if ((INTERPOLATED_FIELDS as readonly string[]).includes(key)) continue;
    collect(value, into);
  }
  return into;
}

describe('workflow templates', () => {
  const definition = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));
  const texts = collect(definition.steps);

  it('finds the interpolated text it is supposed to guard', () => {
    // Without this, renaming `steps` or the fields would make every assertion
    // below pass over an empty list.
    expect(texts.length).toBeGreaterThanOrEqual(15);
    expect(texts.some(({ where }) => where.endsWith('.prompt'))).toBe(true);
    expect(texts.some(({ where }) => where.endsWith('.run'))).toBe(true);
    expect(texts.some(({ where }) => where.endsWith('.args'))).toBe(true);
  });

  it('never ships a {% tag %} to a prompt, a shell or a command', () => {
    const offenders = texts.filter(({ text }) => text.includes('{%')).map(({ where }) => where);
    expect(offenders).toEqual([]);
  });

  it('never ships both branches of a conditional section', () => {
    // `{% else %}` is the worst case: with no evaluation BOTH branches are
    // delivered, so the consumer gets contradictory instructions.
    const offenders = texts
      .filter(({ text }) => /\{%\s*(else|elif)\b/.test(text))
      .map(({ where }) => where);
    expect(offenders).toEqual([]);
  });

  it('interpolates the scope flag instead of inlining a conditional', () => {
    // The one flag every gate and every slash command shares. Computing it once
    // is also why the six gate `run:` bodies and the four `args` cannot drift.
    expect(texts.some(({ text }) => text.includes('steps.flag_scope.output.stdout'))).toBe(true);
  });
});
