# Changelog

All notable changes to the `viteplus-stitch` Spec Kit bundle are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The installer resolves `bundle.version` from `bundle.yml`, so a release bump is a
one-file change plus this changelog.

## [Unreleased]

### Changed

- **Gate integrity: a green signal is no longer accepted as proof.** A workflow
  previously completed with zero tests, a scaffold-only implementation and ghost
  UI selectors, because several gates were green by construction.
- `check-quality-gate.sh` now counts executed tests. Zero tests (or an
  unparseable report) fail the gate; `--allow-no-tests` is an explicit human
  opt-in that records `regression_tests: skipped`. `--passWithNoTests` is gone.
- `check-quality-gate.sh` and `check-blast-radius.sh` resolve the project root and
  refuse to run when `git rev-parse --show-toplevel` points at an ancestor
  repository (the `$HOME` trap). All git scans are scoped to the project root.
- `check-contracts.sh`: `--require-ui` implies `--check-orphans` and cross-checks
  every manifest selector against `src/`; ghost selectors fail the gate.
- `verify-stitch-design.sh`: `--tokens-only` is rejected together with
  `--require-ui`, writes `stitch-design-tokens.json` (never `stitch-design.json`)
  and marks `full_visual_verification: false`. The Playwright config/spec
  templates are resolved with their `.tmpl` suffix and fail with an actionable
  error instead of a confusing "no tests found".
- Evidence is append-only: each gate also writes `<gate>.history.jsonl` and
  records `previous_status` in the current artifact.
- The previous `auto_repair` loop only looked at quality/bundle, ran once, and its
  recheck steps swallowed exit codes with `|| true`, so its condition could never
  be true. Replaced by the loops above, whose rechecks propagate real exit codes.

### Added

- Telemetry provenance: every `.specify/telemetry.jsonl` record now carries the
  workflow `step`, the AI `model`, and the `subagent` (integration process) that
  executed it, with an explicit `none` when a field does not apply.
- `emit-telemetry.sh --import-state[=<path>]` folds every workflow step from the
  active run's `state.json` into the telemetry log as `step_execution` events,
  enriched with the step's `ROLE:` line (from the run's `workflow.yml` snapshot)
  and per-step durations from `log.jsonl`. Imports are idempotent (upsert).
- `telemetry_sync` workflow step imports the full run and prints the summary at
  the end of the lifecycle; gate-failure summaries import as well.
- `check-tasks-complete.sh`: completion gate for the `tasks.md` ledger, wired as
  the `gate_tasks` workflow step.
- `check-verification-verdict.sh`: machine verdict gate. The `verify` prompt must
  now write `evidence/verification.json`, and the `gate_verdict` step fails the
  workflow on `reject`, malformed or missing verdicts.
- Installer materializes `playwright.design.config.ts` and
  `design-audit.spec.ts` from their `.tmpl` sources and warns when the project is
  not its own git repository.
- `bootstrap-project-env.sh` + `bootstrap_env` workflow step: deterministic
  `git init` with an ignored-dependency baseline commit, and idempotent
  Playwright/design-audit template materialization. Several gate failures were
  never application bugs.
- **Bounded self-healing loops**: `repair_gates` (`do-while`, 3 attempts) covers
  every deterministic gate (quality, bundle, contracts, visual, tasks) and
  re-runs them after the repair agent; `abort_unrepaired` stops the run when the
  loop is exhausted. `repair_verdict` (2 attempts) handles a rejecting audit by
  repairing the reported reasons and triggering a full re-audit.
- `gate_verdict_final` is a hard shell step (no `continue_on_error`) so the
  workflow can no longer report success with a rejecting verdict.
- `templates/auditor.md` (installed as `.specify/workflows/viteplus-stitch/AUDITOR.md`)
  holds the audit checklist and verdict contract; the `verify` prompt references
  it, so the retry audit cannot drift from the first one.

### Changed

- `emit-telemetry.sh --summary` now prints `TIMESTAMP | STEP | MODEL | SUBAGENT |
  STATUS | DURATION | EXIT` and lists every imported workflow step, not only the
  gates that emitted an event. `--step`, `--role`, `--model` and `--subagent`
  flags (plus `SPECIFY_*` env fallbacks) attribute ad-hoc events.

## [1.2.0] - 2026-11-20

### Added

- Blast radius gate with anti-loop circuit breaker (`check-blast-radius.sh`):
  protected tooling files and out-of-slice edits are rejected.
- Automated regression test execution inside `check-quality-gate.sh`, narrowed to
  the feature slice when one is active.
- Spec quality and completeness audit step, plus unattended gate flow.
- Application build/compilation gate, deferred to `after_implement`.
- End-to-end scope propagation through the lifecycle via `--scope` /
  `SPECIFY_SCOPE` (workflow input, hooks, gates, regression tests).
- Multi-stack style detection (Tailwind, UnoCSS, Panda CSS, Vanilla Extract, CSS
  Modules, CSS-in-JS) with closed-circuit Tailwind wiring validation.
- Brownfield bundle budgets: `.bundle-budget.json` config, `BUNDLE_*` environment
  variables, `--baseline-total-kb`, `--strict`, and legacy chunk exemptions.
- `--css-dir` in `check-ghost-classes.sh` (repeatable or comma-separated) to point
  the stylesheet declaration pool at custom roots.
- GitHub Actions CI running the full suite on every push, pull request and manual
  dispatch, on Node 20 and 22.
- `CHANGELOG.md`, and `bundle.yml` as the single source of truth for the version.

### Changed

- **Default strictness is now lower in two places** — pass `--strict`, or omit
  `--scope`, to get the previous behavior:
  - Gates run with `--scope` now audit only that slice, including the env-config
    guard, ghost-class scanning, and the `after_implement` final gate.
  - The total bundle budget is grandfathered when `dist/` already exceeds it and no
    baseline is recorded (a loud warning is printed instead of a failure).
- The ghost-class CSS declaration pool is project-wide by default, so narrowing
  `--src-dir` no longer turns globally declared classes into false positives.
- The installer resolves `bundle.version` from `bundle.yml` and reports it, so a
  release bump is a one-file change.
- Templates standardized on the native Vite+ `vp` toolchain.

### Fixed

- Scope leaks: the env-config gate and the ghost-class gate ignored `--scope` and
  scanned the whole `src/`, producing false positives in brownfield projects.
- `--css-dir` was documented in `check-ghost-classes.sh` but never parsed.
- `requires.mcp` no longer demands the Stitch MCP server, so `specify bundle
  install` succeeds on any machine; Stitch stays opt-in via `enable_stitch`.
- The release artifact no longer ships the development workspace. `specify bundle
  build` only excludes `.git`, `__pycache__` and `.DS_Store`, so building in place
  produced a 17 MB ZIP with 1261 `node_modules` files; `scripts/build-release.sh`
  now stages the shipped allow-list first (22 files, ~55 KB) and CI guards it.
- `@shadcn/lint` is wired as an oxlint `jsPlugins` string specifier, and test files
  are exempt from `max-lines-per-function`.

### Upgrading from 1.1.0

No consumer code changes are required. Review the two default relaxations above if
your pipelines relied on `--scope` auditing the whole repository or on the total
bundle budget failing unconditionally:

```bash
# previous strict behavior
bash .specify/scripts/bash/check-quality-gate.sh          # no --scope
bash .specify/scripts/bash/check-bundle-budget.sh --strict
```

## [1.1.0] - 2026-11-09

### Added

- Impeccable UI craft lifecycle integrated into the workflow: critique, harden,
  animate, and audit stages with design review gates.
- Guardrails step and constitution section forbidding agents from weakening gates,
  lint rules, or tests to make a failing check pass.
- Installer support for specific GitHub releases (`--release=<tag>`) and locally
  downloaded release archives (`--zip=<path>`), plus automatic asset download.

### Changed

- Lifecycle hooks reorganized into `after_task` and `after_implement`, with visual
  verification made deterministic and portable across platforms (Git Bash/WSL).

## [1.0.0] - 2026-10-20

### Added

- Initial public release: Vite+ (`vp`) unified quality gate, Clean Architecture
  boundary enforcement, typed environment config guard, Stitch token and visual
  verification, contract and ghost-class gates, and the phased SDD workflow.
