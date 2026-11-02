# Quality Gate Integrity — Non-Negotiable

This workflow is defined by its gates. A green suite that was obtained by weakening a gate is a **failed** task, even if every check reports success.

## Never modify to make a check pass

The agent MUST NOT edit, weaken, disable, skip, or delete any of the following in order to make a quality gate, test, or build pass:

- `vite.config.ts` (or any Vite/Vite+ configuration file, e.g. `vitest.config.ts`, `vite.config.*`)
- `package.json` quality scripts (`test`, `check-quality`, `check-env`, `verify-design`, and any lint/type/test script)
- `.specify/scripts/bash/check-quality-gate.sh`
- `.specify/scripts/bash/check-env-config.sh`
- `.specify/scripts/bash/verify-stitch-design.sh`
- `.specify/extensions.yml` hook definitions
- test files, snapshots, fixtures, or coverage thresholds
- lint rules, complexity thresholds, `import/no-restricted-paths` zones, or `@shadcn/lint` rules

## Prohibited workarounds

- Adding `eslint-disable` / `oxlint-disable` / `ts-ignore` / `ts-expect-error` comments to silence a failure.
- Lowering `complexity`, `max-lines-per-function`, `max-depth`, or `max-params` limits.
- Deleting or `skip`-ing assertions, test cases, or whole spec files.
- Updating Playwright golden screenshots or Stitch token assertions to match a broken UI.
- Adding files or paths to ignore/exclude lists so a violation stops being reported.

## Correct behavior when a gate fails

1. Read the failure and fix the **application code** or the **product behavior**.
2. Re-run the gate until it passes honestly.
3. If the gate itself is genuinely wrong (false positive, outdated rule, missing environment), **STOP** and ask the human for explicit approval before changing any gate configuration. Explain the evidence and the proposed change.
4. Any approved change to gate configuration must be a separate, explicit commit, never bundled with a feature fix.

## Ownership

Gate configuration is owned by the human. Changes to it require explicit approval in the same conversation. Silence, a passing test, or an expired checkpoint is **not** approval.
