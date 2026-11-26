# Quality Gate Integrity — Non-Negotiable

This workflow is defined by its gates. A green suite that was obtained by weakening a gate is a **failed** task, even if every check reports success.

## Non-UI Features Inside a Frontend Project (`has_ui: false`)

`has_ui` describes the **feature**, not the **project**. A backend, domain, or CLI
feature almost always lives inside an existing React/Vite repository, so:

- **Never remove or rewrite the project's frontend tooling**: React, `vite.config.ts`,
  `@vitejs/plugin-react`, the typed env config, or the existing `dev` script stay as
  they are. `npm run dev` keeps booting the UI dev server.
- The feature declares its own runtime in `specs/<feature>/runtime.json` (start from
  `.specify/templates/runtime.json.tmpl`):
  - `{"kind":"http","command":"npm run dev:api","port":3000,"readiness":"/health"}`
  - `{"kind":"http","command":"npm run dev","port":3000,"readiness":"/api/health"}`
  - `{"kind":"none","reason":"<why this feature has no runtime entrypoint>"}`
- Exposing HTTP depends on the framework: with a Vite bundler add a **new** script
  (`dev:api`, `start:api`) instead of repurposing `dev`; with a full-stack framework
  (Next, Nuxt, Astro, Remix, SvelteKit) the framework dev server already serves the
  endpoints, so declare it with a **specific** readiness path such as `/api/health`.
  The port comes from the typed env config, and `spec.md`, `quickstart.md`, the
  contract and the script must agree on it.
- Vite **built-ins** (`vp dev`, `vite`, `vp preview`) are rejected as the runtime: they
  always start the built-in Vite dev server and ignore `package.json` scripts
  (`https://viteplus.dev/guide/run`). A dev-server runtime with `readiness: "/"` is
  rejected too: a frontend dev server answers 200 on `/` no matter what the API does.
- `check-dev-entrypoint.sh --require-contract` is the authority: it starts the
  declared command itself, probes the declared port, and fails unless it gets HTTP
  2xx. A manual `tsx src/main.ts` that nothing declares is a red gate, not a
  workaround. Pointing the contract at the Vite dev server is a contract violation.
- `{"kind":"none"}` is legitimate (domain/CLI/library), but it is recorded as
  `skipped` with its reason so the independent auditor can confront it with the spec.

## Never modify to make a check pass

The agent MUST NOT edit, weaken, disable, skip, or delete any of the following in order to make a quality gate, test, or build pass:

- `vite.config.ts` (or any Vite/Vite+ configuration file, e.g. `vitest.config.ts`, `vite.config.*`)
- `package.json` quality scripts (creating `package.json`, managing dependencies with npm, and adding scripts during project setup is required; only weakening or deleting quality scripts to bypass a failure is forbidden)
- `.specify/scripts/bash/check-quality-gate.sh`
- `.specify/scripts/bash/check-env-config.sh`
- `.specify/scripts/bash/check-dev-entrypoint.sh`
- `.specify/scripts/bash/verify-stitch-design.sh`
- `.specify/extensions.yml` hook definitions
- test files, snapshots, fixtures, or coverage thresholds
- lint rules, complexity thresholds, `import/no-restricted-paths` zones, or `@shadcn/lint` rules

## Prohibited workarounds

- Adding `eslint-disable` / `oxlint-disable` / `ts-ignore` / `ts-expect-error` comments to silence a failure.
- Lowering `complexity`, `max-lines-per-function`, `max-depth`, or `max-params` limits (UI presentation components under `src/**/ui/**` and test files under `**/*.test.*` / `tests/**` are pre-configured with `'max-lines-per-function': 'off'` in `vite.config.ts` to accommodate accessible JSX and comprehensive `describe`/`it` test suites without artificial file fragmentation).
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

## Impeccable UI Craft Lifecycle (Mandatory when feature touches UI)

When a feature contains frontend UI components (`has_ui` is true), the agent must follow the three-stage craft lifecycle:

1. **Conception (`impeccable critique`)**:
   - Before approving designs, evaluate visual hierarchy, cognitive load (Operate vs Persuade), contrast ratios (WCAG AA), typography, and Tailwind/shadcn tokens.
   - Produce `specs/<feature>/designs/DESIGN_CRITIQUE.md` with actionable adjustments before freezing golden masters.
2. **Implementation Robustness (`impeccable harden`)**:
   - In `tasks.md`, every UI user story MUST include tasks for loading skeletons, empty states with friendly CTAs, error boundaries with retry mechanisms, and edge case truncations.
   - Happy-path-only UI components are prohibited.
3. **Refinement & Polish (`impeccable animate` + `audit`)**:
   - In `tasks.md`, the final phase (`Phase Final: Polish & E2E`) MUST include:
     - `impeccable animate`: Purposeful micro-interactions (hover, active, focus-visible) with `@media (prefers-reduced-motion: reduce)` support.
     - `impeccable audit`: Accessibility (WCAG AA), responsive behavior, and performance validation before final verification.

## Automated Spec Quality & Completeness (Mandatory for Unattended Development)

Before planning, the agent must perform an automated Spec Quality Audit (`audit-spec`):
- Verify Given/When/Then acceptance criteria for all user stories.
- Verify explicit coverage for error states, network failures, empty states, and invalid inputs.
- Document assessment in `specs/<feature>/SPEC_AUDIT.md`.
- In unattended mode (`auto_continue: true`), human gate approval is automatically satisfied only if the audit score meets the quality threshold (>= 90%).

## Blast Radius & Circuit Breaker Protection (Anti-Loop Guard)

To ensure safe unattended execution:
- **Blast Radius**: The agent must NEVER modify files outside the feature slice/assigned scope. Tooling, workflows, quality scripts (`check-quality-gate.sh`, `check-blast-radius.sh`, `check-env-config.sh`, `verify-stitch-design.sh`), extensions, and templates are strictly protected against modification.
- **Circuit Breaker**: If quality gate checks fail 3 consecutive times during a task, the Circuit Breaker trips and halts execution immediately. This prevents token-draining thrashing loops. When tripped, uncommitted regressions must be reverted (`git restore .`) before resetting.
- **Repair loops are for fixing code**: the workflow's `repair_gates` (3 attempts) and `repair_verdict` (2 attempts) loops exist to fix the application. Inside them it is explicitly forbidden to silence a gate with `--allow-no-tests`, `--allow-incomplete`, `--allow-missing`, `--allow-foreign-git`, `--tokens-only`, `--skip-tests`, `--skip-build` or `--skip-orphans`, to edit gates/configs/tests/snapshots, or to hand-edit evidence. If the loop cannot fix it honestly, the run aborts — that is the correct outcome.
- **Independent audit protocol**: final verification follows `.specify/workflows/viteplus-stitch/AUDITOR.md`. The auditor re-runs the gates, rejects scaffolds, and writes the machine verdict. Never write the verdict yourself, and never soften an audit.

## Atomic Design & Component Isolation (Anti-Bloat Guard)

To eliminate LLM component-bundling antipatterns and preserve long-term maintainability:
- **Strictly One Component Per File**: Every React component must live in its own isolated file. Declaring multiple subcomponents, inline helper components, or multiple UI cards inside a single file is strictly prohibited (`react/no-multi-comp`).
- **Hierarchical Separation**: Split components cleanly into atoms, molecules, and organisms within their vertical slice (`ui/` or `components/`).
- **File Naming**: The file name must strictly match the component's primary exported identifier (e.g. `UserAvatar.tsx` exports `UserAvatar`).

## Automated Accessibility (A11y WCAG 2.1 AA) & Performance Budget

In autonomous development, code that works functionally must also be inclusive and production-ready:
- **Accessibility Standards**: Every UI route tested with Playwright is audited for WCAG 2.1 AA violations (missing alt attributes, button accessible names, form labels, and color contrast). Any critical or serious violation fails the visual gate.
- **Production Performance Budget**: The production build (`check-bundle-budget.sh`) strictly enforces asset size limits: individual chunks must not exceed 250 KB and total bundle size must not exceed 1000 KB. Agents must use code-splitting, dynamic imports, and treeshaking, and are forbidden from installing bloated libraries.

## Complete Styling Pipeline Integrity (Closed-Circuit Wiring)

When a project utilizes Tailwind CSS or a dynamic utility framework:
- **Never leave styling unwired**: Creating `tailwind.config.*` or installing `tailwindcss` without connecting the bundler pipeline is strictly prohibited.
- **Three-Point Connection Required**:
  1. **Bundler Integration**: Register the Tailwind plugin in `vite.config.ts` (e.g. `@tailwindcss/vite` for Tailwind v4) or configure `postcss.config.js`.
  2. **Stylesheet Directives**: Declare Tailwind in your primary stylesheet (e.g. `@import "tailwindcss";` in `src/styles/app.css` for v4, or `@tailwind base; @tailwind components; @tailwind utilities;` for v3).
  3. **Application Consumption**: Import the primary stylesheet in the application entrypoint (`src/main.tsx` or `index.html`).
- The `check-ghost-classes.sh` gate validates that all three links are active. Unwired utility classes in JSX without a functioning bundler pipeline will fail the gate immediately.

## Empirical Machine Evidence & Definition of Done (DoD)

A task or feature cannot be declared complete without deterministic machine-generated evidence:
- **Machine Proofs in `specs/<feature>/evidence/`**: Verification requires machine-generated proof files (`quality-gate.json`, `bundle-budget.json`, `contracts.json`, `tasks.json`, and `stitch-design.json`). Self-reported success without machine proof is rejected.
- **No Silent Skips**: When UI is declared (`has_ui: true`), visual verification and route contracts are mandatory. Missing design folders or manifests fail the gate instead of skipping.
- **Append-Only Evidence**: Evidence artifacts are never hand-edited. Every gate also appends to `<gate>.history.jsonl`, so previous verdicts survive later runs. Overwriting a `passed` artifact with a hand-written status is fabrication.
- **Auditability via Telemetry**: All gate executions log structured events to `.specify/telemetry.jsonl` to ensure complete observability of execution duration, gate statuses, model/subagent provenance, and circuit breaker health.

## Evidence Integrity: Green Is a Signal, Not a Proof

These rules exist because a workflow once reported success with zero executed tests, a scaffold-only implementation, and ghost UI selectors. They are non-negotiable:

- **Tests must execute**: `check-quality-gate.sh` fails when the suite runs **zero** tests or when the test report cannot be parsed. `--allow-no-tests` is a human-approved exemption; agents must never pass it on their own. A "green" suite with `No test files found` is a failure.
- **Structural checks are not visual verification**: `verify-stitch-design.sh --tokens-only` only validates `tokens.css` structure. It writes `stitch-design-tokens.json`, never `stitch-design.json`, and is rejected outright when `--require-ui` is active. Only the full Playwright gate can claim visual fidelity.
- **Selectors must exist in code**: with `--require-ui`, every selector declared in `routes-manifest.json` must be found in `src/`. A manifest that only validates against itself is a ghost contract.
- **The project must own its git repository**: if `git rev-parse --show-toplevel` resolves above the project root (the classic `$HOME` scenario), the gates fail. Run `git init` and commit a baseline. `--allow-foreign-git` is never acceptable for real work.
- **Completion is machine-verified**: `check-tasks-complete.sh` fails while `tasks.md` has unchecked tasks, and `check-verification-verdict.sh` fails the workflow unless `specs/<feature>/evidence/verification.json` says `{"verdict":"pass"}`. A prose report — however eloquent — cannot approve a feature.
- **Never bypass with flags**: `--allow-no-tests`, `--allow-incomplete`, `--allow-missing`, `--allow-foreign-git`, and `--tokens-only` all disable rigor. Passing any of them requires explicit human approval in the same conversation, exactly like modifying a gate.

## Real Execution & Mandatory Dependency Installation

A green task cannot be simulated:
- **Mandatory Dependencies (`node_modules`)**: The agent MUST install dependencies (`vp install` or `npm install`) via terminal whenever `package.json` is created or modified. Checking tasks without a functioning `node_modules/` directory is prohibited.
- **Sandbox Boundary Safety (`node_modules/` and `.git/`)**: NEVER use `read_file`, `list_directory`, or file tools on `node_modules/` or `.git/`. In modern package managers (pnpm, npm, vite-plus), `node_modules` contains symlinks pointing outside the workspace sandbox, which triggers fatal environment errors; `.git/` accesses violate workspace security policies. Manage packages and git exclusively via terminal commands (`npm ls`, `npm install`, `vp check`, `git status`, `git diff`).
- **Build File Security Policy (`package.json`)**: NEVER use `replace` or `write_file` on `package.json` (blocked by security policy for build configuration files). To update scripts or configuration, use terminal commands: `npm pkg set scripts.<name>="..."`.
- **Two kinds of task, two owners.** `tasks.md` mixes implementation work with verification work, and they must not be treated the same.
- **Implementation tasks (untagged) are yours, and you mark them with a script — never by editing `tasks.md`.** After finishing one, run `.specify/scripts/bash/check-quality-gate.sh` (add `--scope=<your slice>` when the run declares a scope: that narrows the regression suite to your slice and is what makes a mid-feature pass reachable at all). Then run `bash .specify/scripts/bash/mark-task-done.sh --id=T001`. It refuses unless the gate passed AND the pass postdates your last edit, and it records the tick in `evidence/task-ticks.jsonl`. Hand-editing a checkbox is a fatal violation of Quality Gate Integrity: it leaves no audit record and cannot be told apart from a fabricated claim.
- **Verification tasks (`[verify:<gate>]`) are NOT yours.** Never tick and never un-tick them, by hand or in bulk. Their checkbox is derived by the workflow from the evidence the gate itself wrote: `reconcile-task-ledger.sh` ticks `[verify:quality]`, `[verify:contracts]`, `[verify:design]`, `[verify:bundle]` and `[verify:runtime]` when that gate reports `status: "passed"`, and un-ticks them when it regresses. Editing one by hand only makes the ledger disagree with the gates it is supposed to mirror.
- **Tag new verification tasks when you write them.** Any task whose completion *is* a gate result must carry the tag, or it becomes meaningless agent-asserted work. When you refine `tasks.md`, add `[verify:quality]` to "run the full suite", `[verify:design]` to "verify contrast/accessibility", `[verify:bundle]` to "keep the bundle in budget", and so on. An unknown tag is a hard error, not a silent no-op.
- **Expect the full gate to be red until the end.** It runs the whole suite and the build, so unimplemented tasks guarantee failure. That is your progress signal, not a reason to stop. A feature that is finished but unticked still fails `gate_tasks`; if you reach that point with untagged work left unmarked, tick what is demonstrably done and print `task id -> justification` for each.
- **Imperative Pipeline Enforcement**: The Spec Kit workflow runs automated quality gates (`gate_quality`, `gate_bundle`, `gate_contracts`, `gate_tasks`, `gate_verdict`) as non-agent shell steps with an automated self-healing repair window. Shell gates can fail the workflow; prompt prose cannot.

## Subagent-Driven Execution Architecture (Anti-Context Drift)

To prevent cognitive degradation, context drift, sycophancy, and timeouts on large feature sets:
- **Ephemeral Subagent Delegation**: When executing multi-task phases in `tasks.md`, the orchestrating agent MUST dispatch individual tasks to fresh, isolated worker subagents (e.g. `@generalist`).
- **Context Isolation**: Each worker subagent receives ONLY the task description, the target file path, and relevant domain contracts. It does NOT inherit the entire conversation history.
- **Mandatory Quality Gate per Task**: The worker subagent MUST execute `bash .specify/scripts/bash/check-quality-gate.sh` via terminal and verify exit code 0 before concluding.
- **Single-Turn Lifecycle**: Upon task completion and gate verification, the subagent returns a concise 3-line status to the orchestrator and its context is disposed of immediately.

