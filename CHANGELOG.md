# Changelog

All notable changes to the `viteplus-stitch` Spec Kit bundle are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The installer resolves `bundle.version` from `bundle.yml`, so a release bump is a
one-file change plus this changelog.

## [Unreleased]

### Fixed

- **The Vite+ pins no longer install two Vite copies.** `templates/package.json.tmpl`
  aliased `vite` to `npm:@voidzero-dev/vite-plus-core@^1.3.0` while `vite-plus` floated
  on `^1.3.0`. Those two packages version independently: `vite-plus@^1.3.0` resolves to
  1.8.0 (which bundles core `8.3.8001`) while the core caret resolves to the legacy
  1.6.0, so `npm install` silently added **both**. `vp` then refuses to boot with
  `Expected @voidzero-dev/vite-plus-core@X, but found vite@Y`, and two Vite instances
  break runtime identity checks across plugins. Verified with `npm install --dry-run`:
  the old pins emit `add vite 8.3.8001` *and* `add vite 1.6.0`; the new pins emit one.
  The template now pins the exact core version, repeats the **identical** spec in
  `overrides.vite` (npm aborts with `EOVERRIDE` otherwise) and pins
  `overrides.vitest`, so dependencies and the bundled runner share one Vitest.
  `@vitejs/plugin-react` moves to `^6.3.0`, whose peer range (`vite ^8.0.0`) actually
  matches the bundled core. `tests/toolchain-pins.test.ts` guards every rule.
- **The `npx` fallback for `vp` could never work.** `check-quality-gate.sh` fell back
  to `npx vite-plus vp`, but `vite-plus` ships three bins (`vp`, `vpr`, `vpx`), so npx
  fails with `could not determine executable to run` — verified. Any machine without a
  global `vp` or `node_modules/.bin/vp` therefore aborted the gate with exit 2. It now
  uses `npx -p vite-plus vp`.
- **Provisioned `dev`/`build` scripts were wrong outside a Vite SPA.** Both
  `install.sh` and `bootstrap-project-env.sh` injected `dev: "vp dev"` and
  `build: "vp build"` whenever the scripts were missing, regardless of the runtime.
  `vp dev` always starts the built-in Vite dev server and `vp build` always runs the
  built-in Vite build, both ignoring `package.json`. For a Next/Nuxt/Astro/Remix/
  SvelteKit project that is a guaranteed failure. Framework detection is now resolved
  once (config file first, declared framework dependency as the fallback) and drives
  the scripts: `next dev`/`next build`, `nuxt dev`/`nuxt build`, and so on. The `api`
  profile gets `dev: "npm run dev:api"` plus `build: "vp pack src/main.ts"` (tsdown,
  the documented library/executable build) instead of the Vite app build. The previous
  `vp run dev:api || npm run dev:api` chain is gone: `||` re-runs the script after a
  real failure and masks the exit code.
- **The installer provisioned scripts without the packages they run.** Only the React
  starter manifest shipped dependencies, and the reconcile path never added any, so a
  project could end up with `dev: "vp dev"` and no `vite-plus` — the quality gate then
  died with `Neither Vite+ 'vp' command nor 'npx' was found`. `install.sh` and
  `bootstrap-project-env.sh` now add what the scripts need, reading every version from
  `templates/package.json.tmpl` (single source of truth): `vite-plus`, `typescript`,
  `tsx` on the `api` profile, `@shadcn/lint` + `@vitejs/plugin-react` wherever the
  provisioned `vite.config.ts` imports them, `vitest` (pinned) when the declared test
  script uses it, and a plain `vite` range is rewritten to the core alias in
  `devDependencies` (Vite is a build tool, not a runtime dependency). The reconcile is
  idempotent: a second run rewrites nothing.
- **The four reference examples were not installable.** `examples/*/package.json`
  declared only `"test": "vitest run"` with no dependencies, so `npm install` was a
  no-op and every gate failed at the first tool it needed. Each archetype now declares
  its own runtime and toolchain: React + `@vitejs/plugin-react` for the SPA, `next` for
  the full-stack example (which also makes framework detection correct from the
  manifest alone), `tsx` + `vp pack` for the API, and the shared Vite+ pins everywhere.
- **Bootstrap and installer now guarantee baseline `package.json` scripts.**
  When running in a project with an existing `package.json` that lacked standard
  scripts (`dev`, `build`, `test`, `check-quality`, `verify-design`), the quality
  gates previously failed with missing script errors (e.g. Playwright failing to launch
  local dev server, or bundle check failing to build). `bootstrap-project-env.sh` and
  `install.sh` now safely inject missing baseline scripts and required UI devDependencies
  (`@playwright/test`, `@axe-core/playwright`) without overwriting user-defined scripts.
- **Untracked `.specify/` tooling files no longer trip blast radius violations.**
  When the bundle was installed into a repository that already had commits, untracked
  tooling assets (`.specify/scripts/**`, `extensions.yml`, `memory/`, `templates/`) were
  reported as unauthorized scope modifications by `check-blast-radius.sh`.
  `bootstrap-project-env.sh` now commits untracked tooling into a baseline snapshot
  commit (`chore: baseline specify tooling snapshot`) so diff-based gates start clean.
- **Repair loop resiliency and sandbox safety for telemetry logs.**
  `workflows/viteplus-stitch/workflow.yml` now runs `bootstrap-project-env.sh` during
  the `reset_breaker` phase of `repair_gates_loop`. The `repair_agent` prompt was hardened
  to direct agents to inspect telemetry via terminal (`emit-telemetry.sh --summary`) rather
  than attempting `read_file` on git-ignored `.specify/telemetry.jsonl` or run logs.
- **Reference example `examples/2-react-vite` now ships full starter dependencies.**
  `examples/2-react-vite/package.json` was upgraded from a bare skeleton to declare its
  full React, Vite+, and Playwright dependency tree and scripts.

- **The Regression Gate no longer misreads colourised or progress-aware test
  reports.** `count_executed_tests` matched `^[[:space:]]*Tests` against the raw
  log, so a colourised summary (`\033[2m      Tests \033[22m 15 passed (15)`) or a
  line glued to the previous one by a bare `\r` produced no match and the gate
  failed with *"could not determine how many tests were executed"* even though
  the suite ran and passed. The log is now ANSI-stripped and `\r`-normalised
  before counting, with an unanchored fallback and `node --test` (`# pass N`)
  support. The fail-closed contract is unchanged: an unparseable report still
  fails, it just stops failing for reports that were perfectly parseable.
- **The Regression Gate picks the right runner for API-only profiles.**
  `vite-plus` in `package.json` is now the criterion for using the built-in
  `vp test --run`, superseding the 2.0.0 heuristic that keyed the built-in on the
  absence of a framework config. A declared `test` script wins otherwise
  (`vp run test`, or `npm test --` without vp), and `vite.config.ts` is only a
  last-resort fallback.
  Previously the installer-provisioned `vite.config.ts` made every project look
  like a Vite app, so a plain `vite`/`vitest` API (the `has_ui=false` profile)
  was graded with `vp test`, which warns *"This project does not use vite-plus"*
  and is not the project's contract. Test runs also export `CI=1`, so a `"test":
  "vp test"` script (watch mode) can no longer hang the gate.

## [2.0.0] - 2026-11-24

### Changed — BREAKING

- **Non-UI features must declare a runtime contract.** With `has_ui=false`,
  `gate_runtime` runs `check-dev-entrypoint.sh --require-contract` and the run
  fails when `specs/<feature>/runtime.json` is missing. Domain/CLI features keep
  working by declaring `{"kind":"none","reason":"..."}`; they are not silently
  skipped anymore, they are recorded as `skipped` with their reason.
- **`templates/env.config.ts.tmpl` is now dual-runtime.** It used to read only
  `import.meta.env` (Vite/browser), which is `undefined` under Node, so a non-UI
  feature booting with `tsx src/main.ts` crashed on its first env read. It now
  reads the Vite surface and the Node surface behind explicit guards and
  normalises both into one typed object. Projects that copied the old template
  into an API must merge the Node branch (`globalThis.process?.env`).
- **The quality gates delegate to the declared scripts.** `vp build`, `vp test`
  and `vp dev` are Vite+ built-ins: they run the built-in Vite/Vitest commands and
  ignore `package.json`. Following the Vite+ rule (*check `package.json` and
  `vite.config.ts`, use `vp run <name>` when the project defines a script*), the
  Build Gate and the bundle-budget gate now use `vp run build` when a `build`
  script exists, and the Regression Gate uses `vp run test` when the project is not
  a Vite app. Previously a Next/Nuxt/Astro project was graded with `vite build`.

### Added

- `check-dev-entrypoint.sh` + `gate_runtime`: a non-UI feature must now prove its
  runtime actually starts and serves HTTP. The gate reads the feature's
  `specs/<feature>/runtime.json`, starts the declared command itself, probes the
  declared port and readiness path, and fails unless it gets a 2xx. A manual
  `tsx src/main.ts` that no contract declares is a red gate, not a workaround.
  Template: `.specify/templates/runtime.json.tmpl`.
- `gate_runtime` is wired into `repair_gates` (3 attempts) and `recheck_runtime`,
  and re-executed by the independent auditor (`AUDITOR.md`).
- `templates/vite.config.agnostic.ts.tmpl`: the installer now detects
  `next`/`nuxt`/`astro`/`remix`/`svelte` config files and provisions a Vite+ config
  without the React plugin, shadcn rules or UI layer boundaries. It is a plain
  object export so it loads without a local `vite-plus` install.
- Full-stack framework dev servers are valid runtimes: `next dev`, `nuxt dev`,
  `astro dev`, `remix dev`, `svelte-kit dev` and `vp run dev` are accepted when the
  readiness path is specific (`/api/health`), because those frameworks serve their
  own endpoints from the same dev server.

### Fixed

- `has_ui=false` no longer silently inherits the frontend `dev` script. Before
  this change a backend feature could pass every gate while `npm run dev` still
  booted Vite on 5173 and the API only lived behind a manual `tsx src/main.ts`.
  The workflow now instructs the agent to declare the API entrypoint as a NEW
  script (`dev:api`, `start:api`) and to record the contract in `runtime.json`,
  because `has_ui` describes the FEATURE, not the project: React, Vite and the
  project's own `dev` script stay untouched.
- The runtime gate requires an explicit `port` in `runtime.json` and never
  regex-guesses it from the typed env module: parsing `PORT` lines out of source
  code matched the `65535` of a validation message and probed the wrong port.
  Drift between `runtime.json` and `src/config/env.ts` now surfaces as a failed
  probe instead of a silent wrong-port success.
- `templates/playwright.design.config.ts.tmpl` hardcoded `localhost:5173` and
  `vp dev || npm run dev`. It now derives the port from `PLAYWRIGHT_TEST_BASE_URL`,
  then `PLAYWRIGHT_PORT`, then `PORT`, and launches `vp run dev || npm run dev`, so
  a Next/Nuxt/Astro app is audited on its real port.
- A project that merely *owns* a `vite.config.ts` is no longer assumed to run
  Vitest: the installer provisions that file for non-Vite frameworks too, so the
  Regression Gate keys the built-in `vp test` on the absence of a framework config
  instead. Otherwise a Next + Jest project would have run Vitest after installing.
- `bootstrap_env_early` now runs first, right after `guardrails`, instead of
  before `tasks`: until the project owns its repository every diff-based gate
  audits an ancestor repository, so waiting until mid-run left spec/plan/design
  exposed. The baseline commit uses `--allow-empty`, guaranteeing a `HEAD` for
  `git diff HEAD` even when nothing is staged.
- Each repair iteration now resets the circuit breaker before the agent runs, so
  attempt 3 is not consumed by `CIRCUIT BREAKER TRIPPED` and a resumed run does not
  start blocked. The breaker still stops runaway loops inside a task.
- The baseline commit no longer includes `.specify/workflows/runs/` or
  `.specify/telemetry.jsonl`: `state.json` stores the stdout/stderr of every
  prompt/command step, so the snapshot could commit agent transcripts.
- `has_ui=true` with `enable_stitch=false` skipped `generate-designs` entirely
  (its condition was `has_ui and enable_stitch`), so `critique-design` ran on
  nothing and the `--require-ui` gates failed with no artifacts. The step now
  runs for every UI feature and, without Stitch, generates local wireframes +
  `tokens.css` + `routes-manifest.json` + fixtures, which the workflow already
  allowed as fallback but never requested.
- The starter `package.json` did not declare `@axe-core/playwright`, so the WCAG
  test silently degraded to a DOM scan that does not check contrast. It now ships
  (`^4.14.0`) alongside `@playwright/test`.
- The starter `package.json` did not declare `@playwright/test`, so the visual gate
  could only run by letting `npx` fetch it. The dependency now ships with the
  template (`^1.65.1`); existing projects need `npm i -D @playwright/test` plus
  `npx playwright install --with-deps chromium`.
- The visual audit compared raw `tokens.css` declarations against DOM computed
  values, so any token alias (`--layout-gutter: var(--space-6)` -> `2rem`) could
  never match and the only way to pass was de-referencing the design source.
  `parseDesignTokens` now resolves `var()` chains (including fallbacks and cyclic
  guards) exactly like the browser.
- Telemetry provenance lied twice: `state.json` stores `step_config.model`
  verbatim when the resolved value is empty, so `"{{ inputs.model }}"` was
  recorded as a model name (now reported as `integration-default`, or `none` for
  shell steps), and roles were invisible because the run snapshot is written by
  `yaml.safe_dump` (`prompt: 'ROLE: ...'` / escaped newlines), which a
  line-oriented parser cannot read. Roles are now matched by character offset.
- `--summary` shows a `ROLE` column; `--state=<path>` implies `--import-state`.
- Scoped runs rejected the canonical env module: `check-env-config.sh` mandates
  `src/config/env.ts`, while `check-blast-radius.sh --scope` only exempted
  `src/shared` and `src/common`. Shared app-shell paths (`src/config`, `src/styles`,
  `src/main.*`, `src/App.*`, `src/index.*`) are now exempt, so the two gates no
  longer contradict each other.
- Untracked directories were reported by `git status` as a single collapsed entry
  (`?? src/features/`) and flagged as out-of-slice; both gates now scan with
  `--untracked-files=all`.
- The `vite.config.ts` template shipped `@vitejs/plugin-react` as a dependency but
  never registered it, so React Fast Refresh was dead. The plugin is now wired
  (`plugins: [react()]`) and the installer provisions `vite.config.ts` when the
  project has none (never overwriting an existing one).
- `bootstrap_env` only ran after `implement`, so per-task hooks could audit an
  ancestor repository during implementation. A new `bootstrap_env_early` step runs
  it before `tasks`.
- `install.sh` only injected hooks into an `extensions.yml` that had no gate
  hooks at all, so upgraded projects silently missed newly introduced hooks
  (`project-bootstrap`, `tasks-completion-gate`). Missing hooks are now inserted
  under their existing section, without duplicating YAML keys.
- `generate-designs` crashed mid-run with `unknown filter 'replace'` for features
  importing an existing Stitch project. The workflow expression engine only
  registers `default`, `join`, `map`, `contains` and `from_json`; project-ID
  normalization is now an instruction to the agent instead of a non-existent
  filter. A new suite (`tests/workflow-expressions.test.ts`) rejects unsupported
  filters statically and renders every workflow template with the real Spec Kit
  evaluator.

### Changed

- Telemetry provenance schema: `agent` is the integration process (`pi`, `claude`,
  `antigravity`), `model` is the AI model, and `subagent` is now the **assigned
  role/persona** (previously it held the integration). The `role` field is gone,
  `--agent` was added and `--role` is an alias of `--subagent`. Update any consumer
  that read `subagent` as the integration.
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
- Evidence is append-only on state changes: each gate writes `<gate>.json` with
  the latest snapshot and appends to `<gate>.history.jsonl` only when the
  outcome changes (timestamp/`previous_status` excluded), so repeated identical
  runs no longer duplicate entries. Run frequency stays in `.specify/telemetry.jsonl`.
- The previous `auto_repair` loop only looked at quality/bundle, ran once, and its
  recheck steps swallowed exit codes with `|| true`, so its condition could never
  be true. Replaced by the loops above, whose rechecks propagate real exit codes.

### Added

- Shell gate events inherit the project default provenance instead of a bare
  `none`: the integration chosen at initialization (`.specify/integration.json`)
  and the concrete model recorded by the active run, falling back to
  `integration-default`. Explicit flags still win, and imported `step_execution`
  rows keep their exact values (shell/if steps remain `none`).
- `check-design-artifacts.sh` + `design_artifacts` step: a deterministic gate right
  after `generate-designs`. A prompt could "complete" without writing screens,
  `tokens.css` or the manifest, and the failure only appeared after implementation.
  It now fails in seconds with the exact missing list (`tokens.css`, `no_tokens`,
  `screens_html`, `routes-manifest.json:invalid`, missing fixtures).
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
