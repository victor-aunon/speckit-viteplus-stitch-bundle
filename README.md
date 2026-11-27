# Vite+ & Stitch Quality Workflow for Spec Kit

Deterministic Spec-Driven Development (SDD) workflow for high-fidelity web applications with strict architectural, performance, and visual quality gates.

## 🚀 30-Second Quickstart

Get started in any repository initialized with Spec Kit (`specify init`):

```bash
# 1. Install the workflow bundle
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash

# 2. Run the workflow with your feature prompt
specify workflow run viteplus-stitch -i spec="Create a Daily Habit & Streak Tracker with weekly analytics"
```

The workflow will autonomously execute specification audits, UI critiques, atomic task breakdowns, and phased implementation with strict Clean Architecture and visual quality gates.

---

## Key Features

- 🤖 **Multi-Agent Hybrid Orchestration**: Combine high-reasoning models (Gemini Pro, Claude Sonnet) for architecture, specifications, design critique, and adversarial verification with specialized high-speed agents (Pi, Claude Haiku) for task implementation via `implement_integration`.
- ⚡ **Subagent-Driven Execution Architecture**: Prevents context drift, memory saturation, and timeouts by delegating individual tasks in `tasks.md` to isolated, ephemeral subagents (`@generalist`) with single-turn lifecycles.
- 🎨 **Native Stitch Studio Integration**: Import authored designs, screens, and design tokens directly from your Google Stitch Studio projects via `stitch_project_id` without re-generating from scratch.
- ⚡ **Vite+ (`vp`) as Quality Gate**: Blazing-fast, Rust-powered unified checks for formatting (Oxfmt), linting (Oxlint with Airbnb rules), strict typing (`typeCheck: true`), and cyclomatic complexity limits (max 10).
- 🏛️ **Clean Architecture Boundaries (including vertical slices)**: Enforced import boundaries preventing cross-layer violations across Domain, Application, Infrastructure, and UI (`no-restricted-imports` with Oxlint overrides) in `src/core/**` *and* in every vertical slice such as `src/features/<slice>/{domain,application,infrastructure,ui}/**`.
- 🔐 **Typed Environment Configuration Gate**: Blocks direct `process.env` / `import.meta.env` access in application code. Environment variables must be read, validated, typed, and exported from a single config module (`src/config/env.ts`).
- 🎨 **Zero-Config Styling (Tailwind CSS & Vanilla CSS)**: First-class support for both paradigms. In Tailwind projects, `@shadcn/lint` enforces component token contracts while dynamic utility classes bypass static CSS scans automatically. In Vanilla CSS projects, the Ghost Classes Gate ensures every class referenced in JSX is declared in stylesheets.
- 🖌️ **Optional Google Stitch MCP**: Automated creation of design systems, CSS tokens, and canonical UI screens directly from the terminal.
- ✨ **Impeccable UI Craft Lifecycle**: Full-spectrum visual craft governance for UI features (`has_ui: true`). Runs pre-implementation heuristic art direction (`impeccable critique`), mandates loading skeletons, empty states, and error boundaries in user stories (`impeccable harden`), and polishes motion (`impeccable animate`) and accessibility (`impeccable audit`).
- 👻 **Ghost Classes Quality Gate**: Static AST scanner that verifies that every CSS class referenced in JSX/TSX is declared in a project stylesheet, eliminating dead or missing styles.
- 🧪 **Runtime Entrypoint Contract Gate**: Non-UI features (`has_ui: false`) declare their runtime in `specs/<feature>/runtime.json`; the gate starts that command itself, probes the declared port and fails unless it answers HTTP 2xx. A backend feature can no longer pass every gate while `npm run dev` boots the UI dev server and the API only exists behind a manual `tsx src/main.ts`.
- 🛑 **Interactive Visual Review Gate**: Inspect and approve UI screens and design tokens before writing product code.
- 🔬 **Strict Stitch Token Verification**: Every token declared in `tokens.css` must be present in the DOM with the exact Stitch value; drift fails the gate. `var(--other-token)` references are resolved exactly as the browser does before comparing, so token aliases are legitimate instead of forcing a de-reference of the design source.
- 📊 **Structured Telemetry & Observability**: Every quality gate logs structured JSONL events (`.specify/telemetry.jsonl`) recording timestamp, step, model, subagent (integration process), role, gate duration in ms, scope, exit codes, and circuit breaker metrics. `--import-state` folds every workflow step from the active run's `state.json` into the log. Inspect with `emit-telemetry.sh --summary`.
- 🛡️ **Machine-Generated Evidence for Definition of Done**: Eliminates subjective agent self-reporting. Generates raw machine proof artifacts in `specs/<feature>/evidence/` (`quality-gate.json`, `bundle-budget.json`, `contracts.json`, `design-artifacts.json`, `tasks.json`, `verification.json`, `stitch-design.json`) required for task completion. Evidence is append-only: every **state change** also appends a line to `<gate>.history.jsonl` (identical consecutive outcomes are not duplicated; execution frequency lives in `.specify/telemetry.jsonl`).
- 🚦 **Gate Integrity (no lying green)**: A test suite that executes **zero tests** fails. `--tokens-only` can never satisfy a `--require-ui` claim and writes a separate structural artifact. `--require-ui` cross-checks every manifest selector against `src/`. The project must own its git repository, or anti-tampering/blast radius refuse to run. `check-tasks-complete.sh` blocks completion while `tasks.md` has unchecked items, and `check-verification-verdict.sh` fails the workflow unless the auditor wrote `{"verdict":"pass"}`.
- 🩹 **Bounded Self-Healing (fix, don't just fail)**: `repair_gates` (`do-while`, 3 attempts) repairs and re-runs **every** deterministic gate (quality, bundle, contracts, visual, tasks); `repair_verdict` (2 attempts) handles a rejecting audit by fixing the reported reasons and triggering a full re-audit. Deterministic problems are fixed without an LLM (`bootstrap-project-env.sh`: `git init` + baseline commit + Playwright assets). If it cannot fix something honestly, the run aborts with the evidence instead of shipping green.
- 🔄 **Phased Implementation with Checkpoints**: Playwright and Vite+ validate every phase, then the workflow pauses for approval before the next phase. Use `--auto-continue` to run all phases without pausing.

---

## Prerequisites

1. **Spec Kit CLI** installed on your system:
   ```bash
   which specify
   ```
2. **Vite+ (`vp`)** installed globally or available via `npx`:
   ```bash
   curl -fsSL https://vite.plus | bash
   ```
3. **Google Stitch MCP** configured in your AI agent environment (**fully optional**). The bundle no longer declares Stitch under `requires.mcp`, so `specify bundle install` works on any machine; without the MCP server the workflow degrades to local wireframe HTML + `routes-manifest.json` (see `enable_stitch`).
4. **Playwright** installed in the project (`npx playwright install --with-deps chromium`).
5. **Git** in the project root. The anti-tampering and blast-radius gates audit the project's own repository; the workflow's first step (`bootstrap_env_early`) runs `git init` + a baseline commit before any agent work, and the gates refuse to run when `git rev-parse --show-toplevel` points at an ancestor (for example `$HOME`).

> **Windows note:** use **Git Bash** to run the installer and the `.sh` quality gates. PowerShell works for `npm test`, but if `bash` resolves to WSL (`C:\Windows\System32\bash.exe`), the test suite automatically prefers Git Bash when it is installed. Git Bash is recommended for the workflow scripts themselves.

---

## Installation in Any Project

Run inside the root directory of any repository initialized with Spec Kit (`specify init`):

### Option A: Install from a specific GitHub Release (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --release=v2.0.0
```

### Option B: Install using a downloaded Release `.zip`

If you downloaded `viteplus-stitch-2.0.0.zip` from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --zip=./viteplus-stitch-2.0.0.zip
```

*(Or unzip it and run `bash scripts/install.sh`)*

### Option C: Install latest from `main`

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash
```

> **Note on `specify bundle install`:** Use the standalone `install.sh` script for this bundle. It installs the workflow and its supporting scripts directly into `.specify/`, without requiring the bundle to be published in a Spec Kit catalog. If you later publish this bundle to a catalog, `specify bundle install` can also be used.

### Installer options

| Flag | What it does |
|---|---|
| `--target-dir=<path>` | Project root to install into (default: current directory) |
| `--profile=<name>` | `react` \| `vanilla` \| `api` \| `fullstack`. Declares the project archetype **before** any file exists. Default: auto-detected from the framework config, the framework dependency, or a `src/features` + `index.html` heuristic; falls back to `react`. |
| `--release=<tag>` | Install from a specific GitHub Release tag (e.g. `v2.0.0`) |
| `--zip=<path>` | Install from a locally downloaded release `.zip` |
| `--allow-toolchain-downgrade` | Move `vite` back to the bundle pin even when the project already runs a **newer** core. Default: keep the newer one and warn (see [Upgrading](#upgrading-a-project-that-already-installed-this-bundle)). |
| `--help` | Usage |

`--profile` matters most when the project does not exist yet (see below): it decides
which manifest seed, which `vite.config.ts` and which `AGENTS.md` you get.

```bash
# Starting from scratch: say what you are building, not what exists.
bash scripts/install.sh --target-dir=. --profile=api
bash scripts/install.sh --target-dir=. --profile=fullstack
```

### Starting from scratch (no `package.json` yet)

The starter manifest in `templates/package.json.tmpl` is React-shaped, so the installer
treats a freshly seeded `package.json` as **bundle-owned** and rewrites it to match the
declared profile instead of leaving you a React manifest with non-React config:

| You ask for | Scripts you get | React surface | `vite.config.ts` |
|---|---|---|---|
| `--profile=react` (or nothing) | `dev: vp dev`, `build: vp build`, `test: vp test` | React + plugin-react + shadcn + Playwright | React plugin |
| `--profile=vanilla` | `dev: vp dev`, `build: vp build`, `test: vp test` | **pruned**, Playwright kept (it has a UI) | vanilla (no plugin) |
| `--profile=api` | `dev: npm run dev:api`, `dev:api: tsx watch src/main.ts`, `build: vp pack src/main.ts` | **pruned**, Playwright pruned, `tsx` added | agnostic |
| `--profile=fullstack` | `<framework> dev` / `<framework> build` once the framework is detected | depends on the framework | agnostic |

A spec that turns out to be Next.js **after** the install is handled too: a script still
holding a bundle default (`vp dev`, `vp build`, `npm run dev:api`, `vp pack …`, `vp test`)
is corrected when the detected technology changes, because the bundle wrote it. A script
**you** wrote is never touched.

```text
~ script dev "vp dev" -> "next dev" (bundle default, technology changed)
+ script dev = vp dev                          ← your own script? never rewritten
```

### What gets installed

This is a **Spec Kit workflow**, not a slash-command extension. It does not add `/speckit.*` commands to your agent; it adds a workflow that dispatches the existing `speckit.specify`, `speckit.plan`, `speckit.tasks`, and `speckit.implement` commands to the AI integration already configured in your project.

| Path | Purpose |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `.specify/workflows/viteplus-stitch/workflow.yml` | The workflow definition and phase gates |
| `.specify/extensions.yml` | Lifecycle hooks that run the quality gates after tasks/implementation |
| `.specify/scripts/bash/check-quality-gate.sh` | Vite+ + env-config + architecture quality gate |
| `.specify/scripts/bash/check-env-config.sh` | Direct env-access guard |
| `.specify/scripts/bash/verify-stitch-design.sh` | Playwright Stitch token/visual gate |
| `.specify/scripts/bash/mark-task-done.sh` | Only legitimate writer of an untagged task tick (requires a fresh green gate) |
| `.specify/scripts/bash/reconcile-task-ledger.sh` | Derives `[verify:*]` ticks from gate evidence |
| `.specify/scripts/bash/check-bundle-preflight.sh` | Install-completeness check: fails in seconds, not after three repair windows |
| `.specify/scripts/bash/check-blast-radius.sh` | Blast radius scope protection & circuit breaker anti-loop guard |
| `.specify/scripts/bash/check-contracts.sh` | Route manifest & orphan component contract integrity gate |
| `.specify/scripts/bash/check-ghost-classes.sh` | Ghost classes gate: scans JSX/TSX for undeclared CSS classes |
| `.specify/scripts/bash/check-bundle-budget.sh` | Production performance & bundle size budget gate |
| `.specify/scripts/bash/bootstrap-project-env.sh` | Deterministic bootstrap: `git init` + baseline commit, Playwright config/audit-spec materialization |
| `.specify/scripts/bash/check-design-artifacts.sh` | Design-artifact gate: fails before implementation if screens, tokens or manifest are missing |
| `.specify/scripts/bash/check-tasks-complete.sh` | Task-ledger completion gate (fails on unchecked tasks) |
| `.specify/scripts/bash/reconcile-package-manifest.mjs` | Idempotent `package.json` reconciler (baseline scripts + the dependencies they execute); used by the installer and the bootstrap |
| `.specify/scripts/bash/check-verification-verdict.sh` | Machine verdict gate (fails unless `verification.json` says `pass`) |
| `.specify/scripts/bash/design-seal.sh` | Content seal of the design master, so the visual gate cannot grade against a reference that moved |
| `.specify/scripts/bash/emit-telemetry.sh` | Structured telemetry & observability event logger |
| `.specify/templates/` | `vite.config.ts`, Playwright config, env config, and design-audit templates |
| `vite.config.ts` (project root, only when absent) | Vite+ config with the React plugin registered (`plugins: [react()]`) so Fast Refresh works |
| `.specify/templates/auditor.md` (installed as `.specify/workflows/viteplus-stitch/AUDITOR.md`) | Independent audit protocol: evidence rules, re-execution commands, machine verdict contract |
| `.specify/workflows/viteplus-stitch/GUARDRAILS.md` | Non-negotiable policy: never weaken gates to pass tests |
| `.specify/memory/constitution.md` | Receives the "Quality Gate Integrity" section (read by every command) |
| `AGENTS.md` | Root workspace guidelines: Clean Architecture boundaries, env-config & quality gates for any AI agent (Gemini, Claude, Cursor, Copilot) |

The workflow uses `integration: auto` by default, which reads the integration selected when the project was initialized with `specify init` (for example Claude, Gemini, or Copilot).

---

## Step-by-Step Workflow Execution

```
[ guardrails ] ──► [ 1. specify ] ──► [ 2. audit-spec ] ──► ( review-spec gate )
                                                                    │
                                                                    ▼
                                                            [ 3. plan ]
                                                                    │
                                    ┌───────────────────────────────┘
                                    │ (if has_ui: true)
                                    ▼
                          [ 4. generate-designs ]
                          (Stitch UI & tokens.css)
                                    │
                                    ▼
                          [ 5. critique-design ]
                          (Impeccable craft audit)
                                    │
                                    ▼
                          ( review-design gate )
                                    │
    ┌───────────────────────────────┘
    │
    ▼
[ 6. tasks ] ──► [ 7. implement ] ──► [ 8. Shell Quality Gates ]
                                      - bootstrap_deps (install)
                                      - bootstrap_env  (git init + Playwright assets)
                                      - gate_quality   (vp check + executed tests > 0)
                                      - gate_bundle    (Rolldown)
                                      - gate_contracts (selectors must exist in src/)
                                      - gate_tasks     (tasks.md fully checked)
                                                    │
                                    ┌───────────────┴───────────────┐
                                    ▼ (if issues detected)          ▼ (if clean exit 0)
                     [ 9. repair_gates loop ]                       │
                     do-while, max_iterations: 3                    │
                     - repair_agent (application code only)         │
                     - recheck_quality / bundle / contracts /       │
                       visual / tasks (exit codes propagated)       │
                     - assess_repair_progress (stall detection)     │
                     - abort_unrepaired (hard exit 1) if red        │
                                    │                               │
                                    └───────────────┬───────────────┘
                                                    │
                                                    ▼
                                            [ 10. verify ]
                                            - AUDITOR.md protocol (read it)
                                            - evidence/verification.json (machine verdict)
                                            - VERIFICATION_REPORT.md
                                                    │
                                    ┌───────────────┴───────────────┐
                                    ▼ (verdict = reject)            ▼ (verdict = pass)
                     [ repair_verdict loop ]                        │
                     do-while, max_iterations: 2                    │
                     - verdict_repair_agent (reason-driven)         │
                     - verify_retry (full re-audit)                 │
                     - gate_verdict_retry                           │
                     - assess_verdict_progress (stall detection)    │
                                    │                               │
                                    └───────────────┬───────────────┘
                                                    ▼
                                    [ gate_verdict_final ]
                                    fails the run unless the machine
                                    verdict is "pass"
```

### Self-healing, not just failing
Two bounded loops fix what they can instead of dumping failures on you:

1. **`repair_gates` (3 attempts)** — covers *every* deterministic gate (quality, bundle, contracts, visual, tasks), not just two. Each iteration starts by resetting the circuit breaker, so an attempt is never consumed by `CIRCUIT BREAKER TRIPPED` and a resumed run does not start blocked. Each attempt dispatches a repair agent with the failing evidence, then re-runs all gates. Recheck steps propagate their real exit codes (the previous loop used `|| true`, so its condition could never fire — it was decorative). If the loop exhausts its attempts, `abort_unrepaired` stops the run with the telemetry summary instead of shipping a broken feature. Each iteration is bracketed by `repair-loop-guard.sh`: `--snapshot` in `reset_breaker` and `--assess` in a final `assess_repair_progress` step. A window that leaves the working tree byte-identical cannot produce a different outcome, so the loop ends there instead of spending its remaining 30-minute attempts — the common case where the offending file is inside the blast-radius protected set and no legal repair exists.
2. **`repair_verdict` (2 attempts)** — if the independent auditor returns `reject`, a repair agent works through the verdict's `reasons`, and the auditor re-audits **from scratch**. `gate_verdict_final` then fails the run unless the fresh verdict is `pass`. The same `repair-loop-guard.sh` snapshot/assess pair (`assess_verdict_progress`) stops the loop after a repair window that changed nothing, rather than spending the second 45-minute attempt.

Deterministic problems are not delegated to an LLM: `bootstrap_env` runs `bootstrap-project-env.sh`, which does `git init` + a baseline commit (with `node_modules/` ignored) and materializes the Playwright config and design-audit spec when designs exist.

Repair agents are explicitly forbidden from using `--allow-no-tests`, `--allow-incomplete`, `--allow-missing`, `--allow-foreign-git`, `--tokens-only`, `--skip-tests`, `--skip-build`, or `--skip-orphans`, and from editing gates, configs, tests, snapshots or evidence. Silencing a gate is never a repair.

> **When editing `condition:` values, never use parentheses.** The Spec Kit expression engine is a hand-rolled splitter, not a Jinja/Python parser: it splits on top-level ` or `, then ` and `, then comparisons, and it has **no grouping support**. A bracketed sub-expression never reaches a comparison operator, so it resolves as an unknown identifier and evaluates to `False` — silently, with no validation error. `a or b and c` correctly means `a or (b and c)`, so write the flat chain and lean on that precedence. `tests/workflow-expressions.test.ts` guards this: it rejects any `condition` containing brackets and evaluates the three gate conditions against the real evaluator for every gate × profile × progress combination.

### Reading a Failed Run

When `repair_gates` exhausts its attempts, `abort_unrepaired` prints the reason, the telemetry summary and the resume commands. Two of that summary's conventions are easy to misread, and both were misread in practice.

**`failure_recorded` is not a failing gate.** It is the circuit breaker logging one failure against its budget (`details.max_failures`, default `3`). The gate that emitted it may have passed. A real run printed `check-blast-radius ... failure_…` six times beside a quality-gate evidence file that said `"blast_radius": "passed"`. Chase the evidence, not the breaker line: the breaker is a counter, not a verdict.

**The evidence names the gate — and, for the quality gate, what broke.** Each evidence file records where a gate stopped (`failed_step`) and which of its checks passed. `quality-gate.json` additionally carries a `failure` block: `step`, `exit_code`, `output` (the tail of the tool output, up to 120 lines) and `output_file`, which points at the untruncated `quality-gate.log` written beside it. The other gates still record only their status, so for those, re-running the gate remains the only way to see the detailed violation.

`failure.output` is deliberately excluded from the `<gate>.history.jsonl` state comparison: its content drifts on every run (paths, line numbers, counts) without the gate's *state* changing, and including it would append a history line per execution.

| Gate | Evidence (`specs/<feature>/evidence/`) | Re-run (`.specify/scripts/bash/`) |
| --- | --- | --- |
| `check-quality-gate` | `quality-gate.json` | `check-quality-gate.sh --fix` |
| `check-bundle-budget` | `bundle-budget.json` | `check-bundle-budget.sh` |
| `check-contracts` | `contracts.json` | `check-contracts.sh --require-ui` |
| `verify-stitch-design` | `stitch-design.json` | `verify-stitch-design.sh --require-ui` |
| `check-tasks-complete` | `tasks.json` | `check-tasks-complete.sh` |
| `check-design-artifacts` | `design-artifacts.json` | `check-design-artifacts.sh` |

The `checks` map inside `quality-gate.json` is ordered, and it is the shortest path to the blocker: the first entry marked `failed` is the gate that stopped the run, and everything after it is `unreached`. `regression_tests: unreached` therefore means the suite has **not run** — it is not a test failure, and `tests_executed: 0` is not a count of passing tests. Do not go hunting for a broken test that was never executed.

`.specify/telemetry.jsonl` is the execution journal, not the verdict: it tells you how often each gate ran and how long each repair window took (`bash .specify/scripts/bash/emit-telemetry.sh --summary`). Only the evidence files are authoritative, which is what the auditor re-executes.

### Recovering from an Aborted Run

`abort_unrepaired` exits `1` and prints the commands below, because the blocking cause is often not in the application code:

```bash
# 1. Reproduce the failing gate for real (see the table above)
bash .specify/scripts/bash/check-quality-gate.sh --fix

# 2. Clear the circuit breaker, then resume
bash .specify/scripts/bash/check-blast-radius.sh --reset --source=human
specify workflow resume
```

Keep `--source=human` when you do this by hand. A workflow iteration, the operator following this section and an agent retrying are the *same command* in the *same* work tree, so the origin is not inferable from anything else. A reset logged as `unspecified` is the only signal that something other than the documented paths performed it.

If the loop stopped with `[REPAIR LOOP STALLED]` rather than exhausted, re-running will reproduce the result: the guard saw no change to the working tree and committed nothing. The diagnosis is printed above the abort *and* written to `.specify/.repair-loop/reason.txt`. The fingerprint deliberately excludes `.specify/**` and `specs/*/evidence/**`, so a window that only rewrote the tooling or the evidence artifacts counts as **no** progress by design. The most common reason in practice is that the offending file sits inside the blast-radius protected set, where no legal repair exists — the fix belongs in the supporting configuration, or with a human.

### Step 1: Start a New Feature (`specify`)
Trigger the cycle with a prompt describing what you want to build:
```bash
specify workflow run viteplus-stitch --input spec="Create a credit card management module with list, details, and fee calculations"
```

> **Pre-existing Specification (`skip_specify`)**: If you have already written your specification (e.g. running `specify` and refining it interactively with `clarify` beforehand), pass `-i skip_specify=true`. The workflow will skip re-running `speckit.specify` and proceed directly to `audit-spec` to audit and validate your existing `spec.md`.

### Step 2: Specification Audit & Approval (`audit-spec` & `review-spec`)
Spec Kit generates the functional technical specification (`specs/<feature>/spec.md`):
1. **Automated Spec Quality Audit (`audit-spec`)**:
   - The agent evaluates the specification against strict SDD criteria: user stories with clear business value, testable Given/When/Then Gherkin acceptance criteria, error handling, network failure recovery, empty states, and architecture boundaries.
   - Generates `specs/<feature>/SPEC_AUDIT.md` with an executive quality score (0-100%, threshold: 90%), scenario matrix, and auto-remediations.
2. **Review Gate (`review-spec`)**:
   - In **interactive mode** (`auto_continue: false`): pauses for human review. Select **`[approve]`** to proceed or **`[reject]`** to adjust.
   - In **unattended mode** (`auto_continue: true`): bypassed automatically once the automated audit confirms the quality threshold.

### Step 3: Implementation Architecture Plan (`plan`)
The workflow generates the architectural plan (`plan.md`):
- Establishes vertical slices under `src/features/<slice>/` (domain, application, infrastructure, ui).
- Defines domain entities, value objects, application ports, and dependency boundaries.
- Specifies component contracts and route hierarchies.

### Step 4: Stitch UI Screen & Token Generation (`generate-designs`)
When `has_ui: true` and `enable_stitch: true`:
- **Existing Stitch Studio Project (`stitch_project_id`)**: If you designed screens in Stitch Studio (`stitch.withgoogle.com`), pass `-i stitch_project_id="<project-id>"`. The workflow automatically calls `list_screens`, downloads your authored HTML screens to `specs/<feature>/designs/<screen-id>.html`, and extracts your design tokens to `tokens.css` without generating new screens from scratch.
- **Automated Generation from Scratch**: If `stitch_project_id` is empty, the agent explicitly invokes **Google Stitch MCP** (`create_project`, `create_design_system`, `generate_screen_from_text`) based on the specification.
- Downloads canonical HTML code to `specs/<feature>/designs/<screen-id>.html` as the visual design master (text-only assets protocol to prevent CLI agent binary codec errors).
- Extracts and generates canonical design tokens in `specs/<feature>/designs/tokens.css` (defining `--color-*`, `--radius-*`, `--font-*`, and `--space-*`).
- Generates `specs/<feature>/designs/routes-manifest.json` and fixture mock data in `specs/<feature>/designs/fixtures/`.
- If Stitch MCP is disabled or offline, generates clean fallback wireframes and token definitions to keep visual gates passing.

> **💡 Operating without Google Stitch (`enable_stitch=false` or offline fallback):**
> - **Explicitly disabling Stitch**: Pass `-i enable_stitch=false` (e.g. `specify workflow run viteplus-stitch -i enable_stitch=false`). The workflow skips the Stitch step entirely and bases the design critique and implementation directly on the component contracts and wireframes established in `plan.md`.
> - **Automatic Gate Bypass**: When Stitch designs are omitted (`enable_stitch=false` or `has_ui=false`), both `verify-stitch-design.sh` and `check-contracts.sh` detect the absence of the `designs/` directory and automatically **pass with exit code 0 (`SKIPPED`)**, keeping the test suite green.
> - **Offline / Fallback Resilience**: If `enable_stitch=true` but the Stitch MCP server is unconfigured, unreachable, or rate-limited, the agent activates fallback resilience: it autonomously generates standard wireframe HTML files (`<screen-id>.html`), `tokens.css`, and `routes-manifest.json` without failing or stalling the workflow.

### Step 5: Impeccable Design Critique (`critique-design`)
When `has_ui: true`:
- The agent activates the **`impeccable`** skill to evaluate the generated UI proposal:
  - If Stitch was enabled: inspects screens in `specs/<feature>/designs/*.html` and `tokens.css`.
  - If Stitch was NOT enabled: inspects UI wireframes, component contracts, and design tokens specified in `plan.md`.
- Audits visual hierarchy (Operate vs Persuade), contrast ratios (WCAG AA), typography, and spacing rhythm.
- Generates `specs/<feature>/designs/DESIGN_CRITIQUE.md` with heuristic findings and actionable recommendations.
- Outputs a concise 5-line summary in the terminal.

### Step 6: Visual Design Review Gate (`review-design`)
When `has_ui: true`:
- In **interactive mode** (`auto_continue: false`): pauses for visual inspection:
  - Review screens and `DESIGN_CRITIQUE.md`.
  - **If approved**: Select **`[approve]`**. Designs and tokens are frozen as canonical masters.
  - **If changes needed**: Select **`[reject]`** to abort or refine screens before planning.
- In **unattended mode** (`auto_continue: true`): bypassed automatically, freezing audited designs and progressing to tasks.

### Step 7: Phase-by-Phase Task Breakdown (`tasks`)
Generates `tasks.md` split into strictly ordered phases:
- `Phase 1: Setup` (Vite+ configuration, dependencies, CSS tokens)
- `Phase 2: Core & Domain` (Entities, Value Objects, Repository Ports)
- `Phase 3..N: User Stories` (TDD, application services, atomic components)
- `Phase Final: Polish & Verification` (Impeccable animate, audit, and E2E)

### Step 8: Phased Implementation (`implement`)
The agent executes tasks phase by phase.
- In **interactive mode** (`auto_continue: false`): pauses after each phase for human review.
- In **unattended mode** (`auto_continue: true`): executes all implementation phases continuously.

### Step 9: Imperative Shell Quality Gates & Self-Healing (`bootstrap_env`, `gate_*`, `repair_gates`)
Once tasks are complete, the workflow engine executes deterministic shell gates in the host OS with `continue_on_error: true`:
1. **`bootstrap_deps`**: Ensures `node_modules` exists via `vp install` or `npm install`.
2. **`bootstrap_env`**: Runs `bootstrap-project-env.sh` — deterministic, idempotent `git init` + baseline commit and Playwright config/design-audit materialization. Machine-local state (`.specify/.repair-loop/**`, `.specify/.circuit-breaker-state`, `.specify/telemetry.jsonl`, `.specify/workflows/runs/**`) is excluded from the commit by explicit pathspec, because it is rewritten on every run and committing it turns the history into a log of the loop's own bookkeeping — see [The tooling baseline commit](#9-bootstrap-project-envsh-deterministic-project-bootstrap). The same script also runs first, as `bootstrap_env_early`, before any agent step. No LLM involved: these were never application bugs. It also runs **first** (`bootstrap_env_early`, right after `guardrails` and before any agent step), so no gate ever audits an ancestor repository — the `$HOME` trap — while spec, plan or designs are being written. The baseline commit uses `--allow-empty`, so a project with nothing to stage still gets a `HEAD` for `git diff HEAD`.
3. **`gate_quality`**: Runs `check-quality-gate.sh` (Vite+ / Oxfmt / Oxlint / Clean Architecture boundaries / executed-test count / compilation).
4. **`gate_bundle`**: Runs `check-bundle-budget.sh` (production asset limits <250KB per chunk, <1000KB total).
5. **`gate_runtime`** (when `has_ui: false`): Runs `check-dev-entrypoint.sh --require-contract` — starts the command declared in `specs/<feature>/runtime.json`, probes its port/readiness path, and fails without HTTP 2xx. Treats an already-occupied port as an error instead of grading a process it did not start.
6. **`gate_contracts`** (when `has_ui: true`): Runs `check-contracts.sh --require-ui` (selectors must exist in `src/`) and `verify-stitch-design.sh --require-ui` (full Playwright).
7. **`gate_tasks`**: Runs `check-tasks-complete.sh`; unchecked items in `tasks.md` fail the gate.

**Self-healing (`repair_gates`, `do-while`, `max_iterations: 3`)**:
   - If every gate exits `0`, the loop body never runs and the workflow proceeds to verification.
   - If any gate fails, `repair_agent` reproduces the failure from the evidence, fixes the **application code**, and all gates are re-run. The loop condition reads the re-executed exit codes, so it exits as soon as everything is genuinely green.
   - **Stall detection.** `reset_breaker` records a working-tree fingerprint (`repair-loop-guard.sh --snapshot`) and a final `assess_repair_progress` step compares it (`--assess`). If the repair window changed nothing, the loop condition turns false and the run stops after that one attempt: repeating an identical window would only reproduce an identical failure. Evidence artifacts (`specs/*/evidence/**`) are excluded from the fingerprint because every gate run rewrites them, while generated designs (`specs/*/designs/**`) count as real progress. Outside a git work tree the guard steps aside, so it can never be what blocks a run.
   - **Every window is measured.** `assess_repair_progress` also emits a `repair_window` telemetry event with the elapsed time, labelled `repair_agent` (or `verdict_repair_agent` for the verdict loop). This exists because the engine never emits a step event for `repair_agent`: a real run spent nearly three hours in repair with *zero* attribution, so "the window is too long" and "there are too many windows" were indistinguishable. `bash .specify/scripts/bash/emit-telemetry.sh --summary` now answers that.
   - If the three attempts are exhausted (or the loop stalled), `abort_unrepaired` prints the reason, the telemetry summary and the resume instructions, and stops the run. Silencing a gate (`--allow-no-tests`, `--allow-incomplete`, `--allow-missing`, `--allow-foreign-git`, `--tokens-only`, `--skip-*`) or editing a gate/config/test/evidence artifact is explicitly forbidden inside the repair window.

> **Resetting the breaker: always pass `--source=`.** A workflow iteration, an operator following the abort message and an agent retrying are the *same* command in the *same* work tree, so the origin is not inferable from anything else. `abort_unrepaired` prints `--reset --source=human`; the loops call it with `--source=workflow`. A reset logged as `unspecified` therefore means it came from something other than the workflow and the documented operator path — which is the only way to tell an agent retry apart. This is instrumentation, not enforcement: nothing forbids a reset today, because measuring first is the point.

### Step 10: Independent Verification & Machine Verdict (`verify`, `gate_verdict`, `repair_verdict`)
The workflow executes final empirical certification against raw machine evidence. The auditor follows `.specify/workflows/viteplus-stitch/AUDITOR.md` (one canonical protocol, shared by the first audit and any re-audit):
1. **Re-execute the machine**: runs the gates itself and inspects outputs, instead of trusting the dashboard or the agent's summary.
2. **Evidence audit**: `quality-gate.json` (with `tests_executed > 0`), `bundle-budget.json`, `runtime-entrypoint.json` (non-UI features), `contracts.json`, `tasks.json`, `stitch-design.json` (with `full_visual_verification: true`), and `.specify/telemetry.jsonl`. Structural-only artifacts (`stitch-design-tokens.json`) never satisfy a UI claim.
3. **Accessibility & Craft Audit**: When `has_ui: true`, activates `impeccable` to audit WCAG 2.1 AA compliance, keyboard navigation (`:focus-visible`), touch targets (44px), and reduced-motion support (`impeccable audit` + `impeccable animate`).
4. **Scenario Verification Matrix**: Cross-checks each Given/When/Then scenario against executable proof.
5. **Machine verdict**: writes `specs/<feature>/evidence/verification.json` with `verdict: "pass" | "reject"`, severity counters, scenario ratio and blocking `reasons`.
6. **Verification Report (`VERIFICATION_REPORT.md`)**: its `VERDICT:` line must match the JSON.

**Enforcement and repair**:
- `gate_verdict` reads the JSON. On `reject`, `repair_verdict` (`do-while`, `max_iterations: 2`) dispatches a reason-driven repair agent and then re-audits **from scratch** (`verify_retry`).
- `gate_verdict_final` is a hard shell step (no `continue_on_error`): the run cannot end "completed" without an approving machine verdict. Prose can no longer approve a feature.
- **Delta-Spec Sync**: documents any architectural refinements discovered during implementation.

---

## Workflow CLI Parameters & Inputs Reference

When running `specify workflow run viteplus-stitch`, you can configure the behavior using `--input <key>=<value>` (or `-i <key>=<value>`):

| Input Parameter | Type | Default | Required? | Description & Usage |
|---|:---:|:---:|:---:|---|
| **`spec`** | `string` | — | **Yes** | Natural language description or feature prompt detailing what to build. |
| **`scope`** | `string` | `""` | No | Restricts all code changes, test executions, and blast radius checks to a specific feature slice (e.g. `src/features/billing`). When empty, auto-detects from git status or targets the full project. |
| **`skip_specify`** | `boolean` | `false` | No | When `true`, skips specification generation (`speckit.specify`) and starts directly at `audit-spec`. Ideal when you have already run `specify` and `clarify` beforehand. |
| **`has_ui`** | `boolean` | `true` | No | Controls UI-specific phases. When `false`, skips Google Stitch, Impeccable critique, Playwright visual gates, route contracts and ghost classes, **and** activates the non-UI runtime contract (`gate_runtime` + `runtime.json`, see below). It does **not** remove React/Vite from the project: a backend feature inside a React app keeps its UI tooling and its `dev` script. |
| **`enable_stitch`** | `boolean` | `true` | No | When `has_ui: true`, toggles whether to use Google Stitch MCP for automated design generation (`true`) or use component wireframes defined directly in `plan.md` (`false`). |
| **`stitch_project_id`** | `string` | `""` | No | ID of an existing Google Stitch Studio project (e.g. `4044680601076201931`). When provided, imports your authored screens directly via `list_screens` instead of generating new ones with AI. |
| **`auto_continue`** | `boolean` | `false` | No | Enables **Unattended Mode**. When `true`, automatically bypasses human approval gates (`review-spec`, `review-design`, and phase-by-phase pauses) once automated quality gates pass. When `false` (default), pauses for human confirmation. |
| **`integration`** | `string` | `auto` | No | Primary AI runner integration for architecture, specification, design critique, and adversarial verification (e.g. `gemini`, `claude`, `copilot`, `auto`). |
| **`implement_integration`** | `string` | `""` | No | AI runner integration specifically for task implementation (e.g. `pi`, `claude`, `gemini`). Defaults to `integration` when empty, enabling hybrid multi-agent orchestration. |
| **`model`** | `string` | `""` | No | Primary AI model for high-reasoning phases: architecture, specification, design critique, and verification (e.g. `claude-3-7-sonnet`, `gemini-2.5-pro`). When empty, uses integration default. |
| **`implement_model`** | `string` | `""` | No | Fast/cost-effective AI model for task implementation (e.g. `claude-3-5-haiku`, `gemini-2.5-flash`). Defaults to `model` when empty. |

### Common CLI Invocation Examples

```bash
# 1. Interactive Full UI Workflow (Default): Pauses for human review at design & phases
specify workflow run viteplus-stitch \
  -i spec="Create a Daily Habit & Streak Tracker with weekly analytics"

# 2. Scoped Feature Workflow: Constrains changes and regression tests to a single slice
specify workflow run viteplus-stitch \
  -i spec="Add weekly streak chart" \
  -i scope="src/features/habits"

# 3. Unattended Full UI Workflow: Runs all phases autonomously until completion
specify workflow run viteplus-stitch \
  -i spec="Create a Daily Habit & Streak Tracker" \
  -i auto_continue=true

# 4. Non-UI / Backend Feature: Skips visual design and UI gates entirely
specify workflow run viteplus-stitch \
  -i spec="Add JWT authentication middleware and token refresher" \
  -i has_ui=false

# 5. UI Feature without Google Stitch: Uses local wireframes and Impeccable craft
specify workflow run viteplus-stitch \
  -i spec="Add billing plans selector" \
  -i enable_stitch=false

# 6. Force specific AI model runner
specify workflow run viteplus-stitch \
  -i spec="Implement user settings profile" \
  -i integration=gemini

# 7. Hierarchical Model Tiering: High-reasoning model for architecture/specs, fast model for coding
specify workflow run viteplus-stitch \
  -i spec="Implement Stripe usage-based billing dashboard" \
  -i model="claude-3-7-sonnet" \
  -i implement_model="claude-3-5-haiku"

# 8. Multi-Agent Hybrid Orchestration: Gemini for Architecture/Verify + Pi for Implementation
specify workflow run viteplus-stitch \
  -i spec="Add credit card management module" \
  -i integration=gemini \
  -i implement_integration=pi

# 9. Import Existing Stitch Studio Project: Uses screens and tokens you crafted in Studio
specify workflow run viteplus-stitch \
  -i spec="Implement checkout and billing flow" \
  -i stitch_project_id="4044680601076201931" \
  -i integration=gemini \
  -i implement_integration=pi

# 10. Pre-existing Specification: Skip specify step when spec was refined via specify + clarify
specify workflow run viteplus-stitch \
  -i spec="billing" \
  -i skip_specify=true
```

---

## 📂 Reference Architecture Examples & High-Leverage Specs

The repository includes 4 self-contained reference archetypes in `examples/` demonstrating how to structure high-leverage `spec-input` prompts across different project types:

| Archetype | Focus | UI Mode | Reference Folder | Quick Invocation |
|---|---|:---:|---|---|
| **1. API Service** | Backend / REST API | `has_ui=false` | [`examples/1-api-service/`](./examples/1-api-service/) | `specify workflow run viteplus-stitch -i spec="$(cat examples/1-api-service/spec.input.txt)" -i scope="src/features/auth" -i has_ui=false` |
| **2. React + Vite+** | Client SPA | `has_ui=true` | [`examples/2-react-vite/`](./examples/2-react-vite/) | `specify workflow run viteplus-stitch -i spec="$(cat examples/2-react-vite/spec.input.txt)" -i scope="src/features/habits" -i has_ui=true` |
| **3. Next.js App** | Fullstack App Router | `has_ui=true` | [`examples/3-nextjs-app/`](./examples/3-nextjs-app/) | `specify workflow run viteplus-stitch -i spec="$(cat examples/3-nextjs-app/spec.input.txt)" -i scope="src/app/pricing" -i has_ui=true` |
| **4. Vanilla Web** | Raw HTML + CSS + JS | `has_ui=true` | [`examples/4-vanilla-web/`](./examples/4-vanilla-web/) | `specify workflow run viteplus-stitch -i spec="$(cat examples/4-vanilla-web/spec.input.txt)" -i scope="src/features/dialog" -i has_ui=true` |

Each example contains a pre-engineered `spec.input.txt` following the 5-block SDD structure:
1. **Context & Purpose**: Business problem and user persona.
2. **Domain Entities & Value Objects**: Immutable models and core data contracts.
3. **Endpoints / UI Components**: Routing manifest, views, and ports/adapters.
4. **Key Acceptance Criteria**: Formal Given/When/Then Gherkin scenarios with edge cases.
5. **Technical & Quality Constraints**: Layer boundaries, env config, and performance budgets.

---

## Non-UI Features (`has_ui: false`) — The Runtime Contract

### Architectural Distinction: Repository Profile vs. Feature Scope

A fundamental architectural principle of this bundle is the strict separation between **Repository Architecture** and **Feature Scope**:

| Architectural Level | Scope & Authority | Handled By | Examples |
|---|---|---|---|
| **Repository Profile** | Delivery platform, framework, and application-wide lifecycle (`react`, `fullstack`, `api`, `vanilla`). | `install.sh` & `bootstrap-project-env.sh` | Main `dev` script (`next dev`, `vp dev`, `npm run dev:api`), production build (`vp build`, `next build`, `vp pack`), test runner. |
| **Feature Scope** | Target business functionality and requirements of the active specification (`has_ui=true` or `has_ui=false`). | Agent Implementer (`speckit.implement`) | Vertical slice code under `src/features/<slice>`, domain models, API routes, or UI components. |
| **Feature Runtime Bridge** | When a non-UI feature introduces an HTTP entrypoint inside a UI repository. | `runtime.json` & dedicated scripts | Exposing `"dev:api": "tsx watch src/main.ts"` without mutating the app's primary `"dev": "vp dev"`. |

- **Autonomous Dependency Installation (`bootstrap_deps`)**: You never need to manually install tooling before running the workflow. If `package.json` lacks installed packages, or if a UI feature requires `@playwright/test` in `node_modules/`, `bootstrap_deps` automatically invokes `npm install` (or `vp install`) before gates run.
- **Mandatory Toolchain Dependencies**: `install.sh` and `bootstrap-project-env.sh` do not only add scripts, they add the packages those scripts execute. A project missing `vite-plus` gets it (plus `typescript`, and `tsx` on the `api` profile); the `@shadcn/lint` and `@vitejs/plugin-react` packages are added wherever the provisioned `vite.config.ts` imports them; a declared `vitest` test script gets `vitest` pinned to the version `vp` bundles. Without this the quality gate aborts with `Neither Vite+ 'vp' command nor 'npx' was found`.
- **Non-Destructive Script Provisioning**: The workflow and bootstrap scripts never overwrite your custom build or dev commands; they only supply defaults for missing baseline commands (`dev`, `build`, `test`, `check-quality`) required by the quality gates.

`has_ui` describes the **feature**, not the **project**. The common case is a backend,
domain or CLI feature living inside an existing React/Vite repository, so the bundle
**never** removes React, `vite.config.ts`, or the project's own `dev` script.

The feature declares how it runs in `specs/<feature>/runtime.json` (start from
`.specify/templates/runtime.json.tmpl`):

```json
{ "kind": "http", "command": "npm run dev:api", "port": 3000, "readiness": "/health" }
{ "kind": "none", "reason": "domain-only: pure calculations, no entrypoint" }
```

The API entrypoint is a **new** package.json script, never a rewrite of `dev`:

```json
{
  "scripts": {
    "dev": "vp dev",
    "dev:api": "tsx watch src/main.ts",
    "start:api": "tsx src/main.ts"
  }
}
```

**The exception is a full-stack framework**, which already serves its own endpoints
from its dev server (`app/api/<route>/route.ts` in Next, `server/api/**` in Nuxt).
There you declare the framework's own command and a **specific** readiness path
instead of inventing a second server:

```json
{ "kind": "http", "command": "npm run dev", "port": 3000, "readiness": "/api/health" }
```

`gate_runtime` then does the part no LLM can fake: it starts `command` in its own
process group, polls `port` + `readiness` until 2xx or timeout, tears it down, and
records `evidence/runtime-entrypoint.json`. After the run you reproduce it with:

```bash
npm run dev:api
curl -i localhost:3000/health
```

Rules worth knowing before you get bitten:

- **A port already answering is exit 2, not a pass.** The gate refuses to grade a
  server it did not start, so a stale process cannot produce a false green.
- **Vite built-ins are rejected as the runtime.** `vp dev`, `vite` and `vp preview`
  always start the built-in Vite dev server and ignore `package.json` scripts
  ([built-ins vs scripts](https://viteplus.dev/guide/run)), so they can never be the
  API of a non-Vite project. Framework dev servers (`next dev`, `nuxt dev`,
  `astro dev`, `remix dev`, `svelte-kit dev`, `vp run dev`) are accepted.
- **`readiness: "/"` is rejected for a dev-server runtime.** A frontend dev server
  answers 200 on `/` no matter what the API does, so the probe would pass without
  proving anything. Declare `/health` or `/api/health`.
- **`kind: none` needs a `reason`** and is recorded as `skipped`, so the independent
  auditor can check the declaration against the spec instead of trusting silence.
- **Ports are declared, never guessed.** `runtime.json` must carry the same `port`
  your typed env config exports; the gate probes exactly that. If the two drift,
  nothing answers and the gate fails — which is the drift detector working. Use
  `--port=<N>` only for ad-hoc verifications.
- **The env module must read BOTH runtimes.** The shipped
  `.specify/templates/env.config.ts.tmpl` reads the Vite surface
  (`import.meta.env`, browser) and the Node surface (`globalThis.process?.env`, API)
  behind explicit guards. Reading only `import.meta.env` is `undefined` under Node
  and crashes the API on boot; reading only `process.env` breaks the browser bundle.
  Server keys (`PORT`, secrets) stay unprefixed on purpose so they never leak into
  the client bundle.

## Toolchain Pins (version alignment)

Vite+ ships as two packages that must move **together**: `vite-plus` (the `vp` CLI and
the bundled toolchain) and `@voidzero-dev/vite-plus-core` (the Vite engine, published
under the `vite` name through an npm alias). They version independently, so a caret
range on both installs **two Vite copies** and `vp` refuses to boot with
`Expected @voidzero-dev/vite-plus-core@X, but found vite@Y`.

`templates/package.json.tmpl` is the single source of truth for those pins, and the
installer copies them into every manifest it touches:

```json
"devDependencies": {
  "vite": "npm:@voidzero-dev/vite-plus-core@8.3.8001",
  "vite-plus": "1.8.0"
},
"overrides": {
  "vite": "npm:@voidzero-dev/vite-plus-core@8.3.8001",
  "vitest": "5.1.1"
}
```

Why each line exists ([docs](https://viteplus.dev/guide/local-cli)):

- **`devDependencies.vite` and `overrides.vite` must be byte-identical.** npm aborts
  with `EOVERRIDE` when a direct dependency and its override disagree.
- **The alias must be an exact version.** The core version encodes the bundled Vite
  version (`8.3.8001` → Vite `8.3.8001`, where the patch is the Vite patch ×1000 plus a
  release counter), so a range silently allows a different engine. The legacy `1.x`
  core line also fails every plugin peer check.
- **`overrides.vitest` must be exact.** Without it a dependency can pull a different
  Vitest than the bundled runner, splitting mocks, `expect` and runner state.

### Upgrading a project that already installed this bundle

Two different things, two different answers.

**Everything with a caret is yours.** `typescript`, `@vitejs/plugin-react`,
`@playwright/test`, `@axe-core/playwright`, `@shadcn/lint`, `@types/node` — the
reconciler only adds those when they are missing and never corrects a version you
chose. `npm install -D <pkg>@latest` and move on.

The **toolchain** is bundle-owned and moves as a unit: `vite` (the
`@voidzero-dev/vite-plus-core` alias), its matching `overrides.vite`, `vite-plus`
itself, and `overrides.vitest`. A reinstall **no longer downgrades you**: if your
core is newer than the pin shipped in `templates/package.json.tmpl`, the
reconciler keeps yours and prints

```
! vite 8.4.0 is newer than the bundle pin 8.3.8001; kept it. Run
  `vp toolchain vite-plus-core` and align `vite-plus` with the result,
  or pass --allow-toolchain-downgrade to pin it back.
```

**If you keep the newer core, run `vp toolchain` — this is not optional.** The CLI
and the engine are published separately, so a core that is ahead of `vite-plus`
makes `vp` refuse to boot at all, and `vp` is the engine behind every gate:

```bash
vp toolchain vite-plus-core   # the core version your installed vite-plus expects
vp toolchain vitest           # the Vitest your installed vite-plus bundles
```

Read both, then set `vite` / `overrides.vite` to the first and `overrides.vitest`
to the second. Getting them wrong does not fail a gate with a readable message; it
fails with `Expected @voidzero-dev/vite-plus-core@X, but found vite@Y` and nothing
runs.

To deliberately move **backwards** to the bundle pin, say so:

```bash
bash scripts/install.sh --target-dir=<project> --allow-toolchain-downgrade
```

Finally: `package-lock.json` is committed on purpose. Editing `package.json` alone
changes nothing until `npm install` runs, and carets do not float once the lock
exists — `npm update <pkg>` or `npm install <pkg>@<version>` is what actually moves
a resolution.

### Bumping the toolchain (bundle maintainers)

Never bump one package alone. After `npm install -D vite-plus@<version>`:

```bash
vp toolchain vite-plus-core   # → 8.3.8001  (paste into BOTH vite entries)
vp toolchain vitest           # → 5.1.1     (paste into overrides.vitest)
```

Then update `templates/package.json.tmpl` and the four `examples/*/package.json`;
`tests/toolchain-pins.test.ts` fails if they drift apart or if a range creeps back in.

### Which build command per archetype

| Archetype | `build` | Why |
|---|---|---|
| React SPA / vanilla | `vp build` | Built-in Vite production build |
| Next / Nuxt / Astro / Remix / SvelteKit | `<framework> build` | Their bundler is their own; `vp build` would run Vite instead |
| API service / library | `vp pack src/main.ts` | tsdown packaging for Node; `vp build` expects a web app with `index.html` |

### Which `vite.config.ts` per profile

The installer provisions exactly one shape, and adds only the dependencies that
shape imports:

| Profile | Template | Loads without `node_modules` | Bundler plugins |
|---|---|:---:|---|
| `react` | `vite.config.ts.tmpl` | no (`defineConfig` from `vite`) | `@vitejs/plugin-react`, `@shadcn/lint` |
| `vanilla` | `vite.config.vanilla.ts.tmpl` | yes (plain object) | none |
| `api` | `vite.config.agnostic.ts.tmpl` | yes (plain object) | none |
| `fullstack` (Next/Nuxt/Astro/Remix/SvelteKit) | `vite.config.agnostic.ts.tmpl` | yes (plain object) | none |

A vanilla project is bundled by Vite, so `vp dev` / `vp build` are correct there, but it
has no React runtime and no shadcn component library: the dedicated template keeps the
complexity limits, `typeCheck` and the Clean Architecture boundaries while dropping the
React plugin and the component contract that do not apply.

## Non-Vite Frameworks (Next.js, Nuxt, Astro, Remix, SvelteKit)

Vite+ is a **toolchain**, not a bundler requirement. `vite.config.ts` is its single
configuration container (`lint`, `fmt`, `check`, `test`, `run`) even when the app is
built by Next or Nuxt, so the bundle works there too — with three rules:

1. **Built-ins vs scripts.** `vp dev` / `vp build` / `vp test` always run the built-in
   Vite dev server, Vite build and Vitest. `vp run <name>` / `vpr <name>` run your
   `package.json` scripts ([docs](https://viteplus.dev/guide/run)). The gates therefore
   delegate: `vp run build` when the project declares `build` (so `next build` is what
   runs), the declared `test` script (`vp run test`, or `npm test --` when `vp` is not
   on PATH) whenever one exists, and `vp run dev` for the visual gate. The built-in
   `vp test --run` is reserved for projects that declare `vite-plus` in
   `package.json` — vp's own criterion — with `vite.config.ts` / `vitest.config.*`
   only as a last-resort fallback; `CI=1` is exported for the run, so a
   `"test": "vp test"` script cannot hang the gate in watch mode.
2. **The installer does not inject Vite UI tooling.** When it detects a framework
   config it provisions `vite.config.ts` from
   `templates/vite.config.agnostic.ts.tmpl`: no React plugin, no shadcn/Tailwind
   rules, no UI layer boundaries — but the same complexity limits, `typeCheck` and
   Clean Architecture boundaries. It is exported as a **plain object** so it loads
   even when `vite-plus` is not installed locally.
3. **The visual gate follows the project.** Playwright now launches
   `vp run dev || npm run dev` and derives the base URL from `PLAYWRIGHT_TEST_BASE_URL`,
   then `PLAYWRIGHT_PORT`, then `PORT` — instead of hardcoding 5173.

```bash
# Existing Next.js project
bash scripts/install.sh --target-dir=.
# → ~ Detected next: initialized vite.config.ts (Vite+ lint/fmt/boundaries only)
```

> **Honest scope:** `has_ui: false` in a Next project is exercised end to end
> (quality + runtime gates, including `next dev` serving `/api/health`). A full UI
> feature in Next — Stitch tokens, route contracts, Playwright goldens — is
> URL-based and expected to work, but has not been validated against a real
> `create-next-app` project yet. Do not read this section as a promise.

## Standalone Quality Scripts CLI Reference

> **💡 Mental Model Note:** You do **not** need to run these scripts manually during the normal SDD workflow. Spec Kit invokes them automatically inside lifecycle hooks (`after_task` and `after_implement`). This reference is provided for running manual checks in your local terminal or integrating them into CI/CD pipelines (e.g. GitHub Actions).

All quality gates installed in `.specify/scripts/bash/` can be executed independently in local development or in CI/CD pipelines:

### 1. `check-quality-gate.sh` (Core Deterministic Gate)

The regression gate counts what actually ran: **zero executed tests fail the gate**, and an unparseable test report fails too. Colourised and progress-aware reports (`\033[2m      Tests \033[22m 15 passed`, or a summary glued to the previous line by a `\r`) are normalised before counting instead of being declared unparseable. The runner is the one vp recognises as the project's: the built-in `vp test --run` when `vite-plus` is declared in `package.json`, otherwise the declared `test` script (`vp run test` / `npm test --`), with the built-in as a fallback when no script exists. `--allow-no-tests` is a human-owned escape hatch that records `regression_tests: skipped` in evidence instead of faking a pass. The project root must own its git repository; if `git rev-parse --show-toplevel` resolves above it (the `$HOME` trap), the gate stops instead of auditing the ancestor repo.
Runs formatting (Oxfmt Airbnb), linting (Oxlint with complexity limits), TypeScript strict types, Clean Architecture boundary checks, centralized env guard, regression test suite, and application compilation/build verification.

```bash
# Run all deterministic checks (including tests and compilation)
bash .specify/scripts/bash/check-quality-gate.sh

# Target a specific feature slice: scopes blast-radius, env-config audit, and regression tests
bash .specify/scripts/bash/check-quality-gate.sh --scope=src/features/billing

# Automatically format code issues via Oxfmt / Vite+
bash .specify/scripts/bash/check-quality-gate.sh --fix

# Skip regression tests (evidence records regression_tests: skipped)
bash .specify/scripts/bash/check-quality-gate.sh --skip-tests

# Human-approved exemption for a project that intentionally has no test suite
bash .specify/scripts/bash/check-quality-gate.sh --allow-no-tests

# Require the project root to own its git repository / opt out of that check
bash .specify/scripts/bash/check-quality-gate.sh --require-git
bash .specify/scripts/bash/check-quality-gate.sh --allow-foreign-git

# Skip application compilation/build (used during intermediate after_task checks)
bash .specify/scripts/bash/check-quality-gate.sh --skip-build

# Verify tooling availability without running lint, tests or the build
bash .specify/scripts/bash/check-quality-gate.sh --dry-run

# Reset circuit breaker counter to 0 after repeated failures
bash .specify/scripts/bash/check-quality-gate.sh --reset-breaker
```

### 2. `check-contracts.sh` (Route & Component Contract Gate)
Validates that routes in `routes-manifest.json` match application screens, fixtures exist, no unconsumed/orphan components exist in `src/`, and Atomic Design (1 component per file) is enforced. Automatically invokes `check-ghost-classes.sh`.

**With `--require-ui`** the gate stops being a manifest self-check: it implies `--check-orphans`, requires renderable sources in `src/`, and verifies that **every declared selector actually exists in the code** (`[data-testid="x"]`, `#id`, `.class` or a tag). A manifest whose selectors are not in `src/` fails as a ghost contract.

```bash
# Standard contract verification
bash .specify/scripts/bash/check-contracts.sh

# Target specific manifest and enable orphan & atomic checks
bash .specify/scripts/bash/check-contracts.sh \
  --manifest=specs/001-feature/designs/routes-manifest.json \
  --check-orphans \
  --check-atomic

# Audit a single feature slice (inherited ghost classes elsewhere are ignored)
bash .specify/scripts/bash/check-contracts.sh --manifest=specs/001-feature/designs/routes-manifest.json --scope=src/features/billing
```

### 3. `check-dev-entrypoint.sh` (Runtime Entrypoint Contract Gate — non-UI features)
Verifies that a non-UI feature's declared runtime really starts and serves. It reads `specs/<feature>/runtime.json`, starts the declared command in its own process group, polls the declared port/readiness path until HTTP 2xx or timeout, then tears the process down and writes `evidence/runtime-entrypoint.json`.

```bash
# Default: verify the newest feature's contract (skips cleanly when none is declared)
bash .specify/scripts/bash/check-dev-entrypoint.sh

# Non-UI feature: the contract is mandatory (used by gate_runtime)
bash .specify/scripts/bash/check-dev-entrypoint.sh --require-contract

# Point at a specific feature / override the probe without editing the contract
bash .specify/scripts/bash/check-dev-entrypoint.sh --feature-dir=specs/003-shortener --port=4000 --path=/health

# Resolve the contract without starting anything
bash .specify/scripts/bash/check-dev-entrypoint.sh --dry-run
```

> **Integrity guarantees:** a port already answering before the gate starts is an **error (exit 2)**, not a pass — grading a process the gate did not start would certify nothing. Vite built-ins (`vp dev`, `vite`, `vp preview`) are a contract violation because they ignore `package.json` scripts, while framework dev servers (`next dev`, `nuxt dev`, `vp run dev`, …) are accepted as long as the readiness path is specific. `{"kind":"none"}` is allowed for domain/CLI features but must carry a `reason`, and it is recorded as `skipped` so the independent auditor can confront it with the spec. `--dry-run` validates the whole contract without starting anything.

### 4. `check-ghost-classes.sh` (Ghost Classes Gate & Multi-Engine Styling Support)
Scans all JSX/TSX files for class names in `className` attributes and verifies that each referenced class exists in at least one stylesheet (`src/**/*.css`, `tokens.css`).

**Multi-Engine Style Auto-Detection:** Automatically detects if the project uses a dynamic or scoped CSS solution:
- **Tailwind CSS:** `tailwind.config.*`, `@tailwindcss` in `package.json`, `@import "tailwindcss"`, `@theme`, `@tailwind`.
- **UnoCSS:** `uno.config.*`, `unocss.config.*`, `unocss` dependencies.
- **Panda CSS:** `panda.config.*`, `@pandacss/dev` dependencies.
- **Vanilla Extract:** `*.css.ts` files, `@vanilla-extract/css` dependencies.
- **CSS Modules:** `*.module.css` / `*.module.scss` files.
- **CSS-in-JS:** `styled-components`, `@emotion/react`, `@stylexjs/stylex`.

When a dynamic/scoped engine is active, static class declaration checks are automatically skipped. You can pass `--force` or `--style-engine=css` to mandate static CSS declarations, or `--style-engine=<engine>` to explicitly set the style engine.

```bash
# Check for ghost classes in src/ (auto-detects style engine)
bash .specify/scripts/bash/check-ghost-classes.sh

# Explicitly declare style engine (tailwind, css-modules, unocss, panda, vanilla-extract, styled-components, emotion, css)
bash .specify/scripts/bash/check-ghost-classes.sh --style-engine=css-modules

# Custom source directory (the CSS declaration pool stays project-wide)
bash .specify/scripts/bash/check-ghost-classes.sh --src-dir=src/features/billing

# Restrict the stylesheet pool too (repeatable or comma-separated)
bash .specify/scripts/bash/check-ghost-classes.sh --src-dir=src/features/billing --css-dir=src/styles,specs

# Force static CSS verification even if a dynamic engine is present
bash .specify/scripts/bash/check-ghost-classes.sh --force

# Dry run mode
bash .specify/scripts/bash/check-ghost-classes.sh --dry-run
```

### 5. `verify-stitch-design.sh` (Stitch Token & Visual Gate)
Runs route/component contracts, verifies `tokens.css` against DOM `:root` computed styles, and then Playwright visual snapshot regression.

> **💡 Graceful Degradation / Auto-Bypass:** If `specs/<feature>/designs` does not exist (e.g. backend features run with `has_ui=false` or UI features run with `enable_stitch=false`), this script automatically **skips execution and exits with code 0**.
>
> **🖼️ Where the golden screenshots come from.** The design phase forbids shipping binary screenshots and declares `designs/<screen-id>.html` the master (that is what Stitch returns). `scripts/render-design-goldens.mjs` therefore derives the goldens from that HTML on every run — same browser, same viewport from the manifest, same deterministic render CSS, same masks — into `tests/design/__snapshots__/`, which is **git-ignored**. The HTML is the committed source of truth; the PNGs are build output. A missing golden is a hard failure (`updateSnapshots: 'none'`), never a silent pass: the previous `continue` on a missing `designs/<id>.png` made the pixel test report success while comparing nothing.

> **🔒 The design master is sealed.** Because the goldens are derived from
> `designs/<screen-id>.html` on every run, a reference that can change between
> runs makes this gate grade the implementation against itself. `check-design-artifacts.sh`
> records a content seal of `designs/` in `design-artifacts.json`; this gate
> recomputes it and **fails** if the master moved, naming
> `check-design-artifacts.sh` as the deliberate way to re-seal. A real run added
> `min-height: 2.75rem` to a screen mid-repair and passed the visual check five
> minutes later, which is exactly the failure this closes. `designs/` is not a
> blast-radius protected path — the design phase legitimately writes it — so the
> seal, not a permission, is what keeps the reference honest.

> **⚠️ Structural vs visual:** `--tokens-only` only validates `tokens.css` structure. It writes `stitch-design-tokens.json` (never `stitch-design.json`), sets `full_visual_verification: false`, and is **rejected with exit 2 when combined with `--require-ui`**. The Playwright config and design-audit spec are resolved from the project root or `.specify/templates/` (including the `.tmpl` sources); if neither exists the gate exits 2 with the actionable path instead of failing with a cryptic "no tests found".

```bash
# Structural token check only: no Playwright, no rendering claim
bash .specify/scripts/bash/verify-stitch-design.sh --tokens-only

# Measure the real per-screen diff ratio without failing: choose the tolerance
# from data instead of inheriting 0.05
bash .specify/scripts/bash/verify-stitch-design.sh --feature-dir=specs/001-feature --calibrate

# Full visual regression comparison against the design master
bash .specify/scripts/bash/verify-stitch-design.sh --feature-dir=specs/001-feature

# Skip orphan UI component detection during intermediate design checks
bash .specify/scripts/bash/verify-stitch-design.sh --skip-orphans
```

### 6. `check-bundle-budget.sh` (Production Performance Gate)
Executes the project's production build (`vp run build` when `package.json` declares
`build`, otherwise the built-in `vp build`, Rolldown engine) and inspects the emitted
bundle sizes against the defined budgets.

```bash
# Validate against default budget (max chunk 250KB, total bundle 1000KB)
bash .specify/scripts/bash/check-bundle-budget.sh

# Custom budget thresholds
bash .specify/scripts/bash/check-bundle-budget.sh --max-chunk-kb=180 --max-total-kb=800

# Brownfield: grandfather the inherited total and enforce no growth from now on
bash .specify/scripts/bash/check-bundle-budget.sh --baseline-total-kb=1450

# Brownfield: exempt legacy vendor chunks from the per-chunk budget
BUNDLE_IGNORE_CHUNKS="vendor-three-*.js,vendor-charts-*.js" bash .specify/scripts/bash/check-bundle-budget.sh

# Always enforce the total budget (greenfield / strict CI)
bash .specify/scripts/bash/check-bundle-budget.sh --strict
```

**Budget resolution order:** CLI flags → environment variables → `.bundle-budget.json` → built-in defaults.

| Setting | CLI flag | Env var | Config key | Default |
|---|---|---|---|---|
| Per-chunk budget | `--max-chunk-kb` | `BUNDLE_MAX_CHUNK_KB` | `maxChunkKb` | `250` |
| Total budget | `--max-total-kb` | `BUNDLE_MAX_TOTAL_KB` | `maxTotalKb` | `1000` |
| Inherited total | `--baseline-total-kb` | `BUNDLE_BASELINE_TOTAL_KB` | `baselineTotalKb` | _unset_ |
| Allowed growth | — | `BUNDLE_TOLERANCE_KB` | `toleranceKb` | `25` |
| Legacy chunk globs | — | `BUNDLE_IGNORE_CHUNKS` | `ignoreChunks` | `[]` |
| Strict total gate | `--strict` | `BUNDLE_STRICT` | `strict` | `false` |

**Brownfield grandfathering:** the *total* budget never blocks on inherited weight. If `dist/` already exceeds the total budget and no baseline is recorded, the gate passes with a `[BROWNFIELD BUDGET]` warning and prints the exact command to record the baseline. Once a baseline exists, any growth beyond `baseline + tolerance` fails. Per-chunk budgets stay enforced (except for `ignoreChunks` matches), so an agent-authored heavy chunk is still blocked.

### 7. `check-env-config.sh` (Direct Environment Access Guard)
Ensures that no application file accesses `process.env` or `import.meta.env` directly outside the designated typed module.

```bash
bash .specify/scripts/bash/check-env-config.sh --env-config=src/config/env.ts
```

### 8. `check-blast-radius.sh` (Scope & Circuit Breaker Guard)
Prevents autonomous agents from modifying protected quality scripts, workflows, or files outside the feature scope.

The project root must own its git repository. If `git rev-parse --show-toplevel` resolves to an ancestor (the `$HOME` trap), the gate **fails** instead of reporting that ancestor's modified files as your blast radius. All `git status` scans are scoped to the project root.

```bash
bash .specify/scripts/bash/check-blast-radius.sh --scope=src/features/billing

# Fail when no git repository exists at the project root
bash .specify/scripts/bash/check-blast-radius.sh --require-git

# Dangerous: audit an ancestor repository instead of this project
bash .specify/scripts/bash/check-blast-radius.sh --allow-foreign-git
```

### 9. `bootstrap-project-env.sh` (Deterministic Project Bootstrap)
Resolves environment, tooling, and configuration prerequisites deterministically and idempotently, eliminating issues that were never application bugs:

1. **Git Repository Ownership & Clean Baseline Snapshot**:
   - Creates `.git` when the project root has none and records an initial baseline commit so diff-based gates (`anti_tampering`, `blast_radius`) have a `HEAD`.
   - `.gitignore` is populated with `node_modules/`, `dist/`, `.specify/workflows/runs/` and `.specify/telemetry.jsonl` (run state contains prompt transcripts, so it must never enter the snapshot).
   - In pre-existing git repositories, commits untracked tooling assets (`.specify/scripts/**`, `extensions.yml`, `memory/`, `templates/`) into a tooling baseline snapshot (`chore: baseline specify tooling snapshot`), ensuring `check-blast-radius.sh` starts clean and avoids false-positive scope violations.

     **This commit can fire more than once — expect one per repair iteration.** `reset_breaker` re-runs this script, so a run that repairs three times leaves three of these commits. They are machine bookkeeping, not work: the author is `spec-kit bootstrap`, the message is fixed, and they are safe to squash.

     **What it does and does not capture.** Machine-local state (`.specify/.repair-loop/**`, `.specify/.circuit-breaker-state`, `.specify/telemetry.jsonl`, `.specify/workflows/runs/**`) is excluded by pathspec, and `.specify/.gitignore` carries a managed block for the same paths, because the CLI-provided file covers only `feature.json` and the extension overrides. `repair-loop-guard.sh` additionally writes its own `.gitignore` inside `.specify/.repair-loop/`, so that directory stays untracked even if the block is lost.

     **The snapshot also stages pending edits to `.gitignore`, `AGENTS.md`, `playwright.design.config.ts` and `tests/design/`.** Those are real content changes, and folding them into a commit titled `chore: baseline …` hides them from every diff-based gate — blast radius and anti-tampering included. If one of those paths has a meaningful edit in flight, commit it yourself with an honest message before the next bootstrap run.
2. **`package.json` Quality Scripts & UI Dependencies**:
   - Provisions a starter `package.json` if absent.
   - If `package.json` exists, non-destructively guarantees missing baseline scripts (`dev`, `build`, `test`, `check-quality`, `verify-design`) based on the detected project profile (`react`, `fullstack`, `api`, `vanilla`). User-defined scripts are never overwritten; only a value the bundle itself wrote (a bundle default) is retargeted when the detected technology changes or the manifest is a fresh seed.
   - For UI projects (`has_ui != false`), ensures `@playwright/test` and `@axe-core/playwright` are declared in `devDependencies` so visual gates can run.
3. **Playwright Asset Materialization**:
   - Copies `playwright.design.config.ts` to the project root and `design-audit.spec.ts` to `tests/design/` from `.specify/templates/` when the feature declares designs.
4. **Profile-Tailored `AGENTS.md`**:
   - Materializes the appropriate `AGENTS.md` profile guidelines (`AGENTS.api.md`, `AGENTS.react.md`, etc.) for LLM agent instruction.

Nothing in existing application code or custom scripts is ever overwritten, and the script always exits 0: the gates remain the authority.

```bash
# Bootstrap the current project (default root: $PWD)
bash .specify/scripts/bash/bootstrap-project-env.sh

# Explicit root / designs directory, or opt out of a step
bash .specify/scripts/bash/bootstrap-project-env.sh --root=. --designs-dir=specs/001-feature/designs
bash .specify/scripts/bash/bootstrap-project-env.sh --no-git
bash .specify/scripts/bash/bootstrap-project-env.sh --no-templates
```

### 10. `check-design-artifacts.sh` (Design-Artifact Gate)
`generate-designs` is a prompt, and a prompt can finish without writing a single file. This gate makes that failure cheap: it runs immediately after the design step and fails in seconds, before any implementation tokens are spent.

Requires, for a UI feature:

- `designs/tokens.css` non-empty and declaring at least one `--token: value`.
- `designs/routes-manifest.json` valid, with at least one screen that has `id`, `route` and `selector`, and every declared fixture present.
- At least one screen HTML file (`designs/<screen>.html`). Local wireframes are valid when Stitch is disabled.

```bash
bash .specify/scripts/bash/check-design-artifacts.sh
bash .specify/scripts/bash/check-design-artifacts.sh --feature-dir=specs/001-feature

# Explicit opt-out for a feature that declares UI but genuinely has no designs
bash .specify/scripts/bash/check-design-artifacts.sh --allow-missing
```

### 11. `check-tasks-complete.sh` (Task Completion Gate)
Completion cannot be proven by a scaffold. Fails while `tasks.md` still contains unchecked items and prints the first pending tasks.

> **Two owners, one ledger.** `tasks.md` mixes implementation work with verification work, and the checkbox used to be a hand-maintained mirror of both. An untagged task is the agent's, but the tick is written by `mark-task-done.sh --id=T001`, which refuses unless the **scoped** gate (`check-quality-gate.sh --scope=<slice>`) passed AND that pass postdates the last edit — a green gate from before your edit proves nothing. Hand-editing a checkbox leaves no `task-ticks.jsonl` record, which is how a fabricated tick becomes visible. A task tagged `[verify:quality|contracts|design|bundle|runtime]` belongs to the workflow: `reconcile-task-ledger.sh` ticks **and un-ticks** it from the evidence that gate wrote, and it runs before `gate_tasks` and before `recheck_tasks`, because judging an unreconciled ledger is what made a finished feature report as incomplete. `skipped` evidence counts as not passed, an unknown tag is a hard error, and untagged lines are never touched. The gate now reports pending work split by owner (`implementation: N, gate-derived: M`), so an unchecked `[verify:*]` sends you to the red gate instead of to code that already exists. `tests/task-ledger-protocol.test.ts` keeps all seven copies of the rules in sync.

```bash
# Fails when any task is unchecked (default: newest feature under specs/)
bash .specify/scripts/bash/check-tasks-complete.sh

# Human-approved override (never pass this on your own)
bash .specify/scripts/bash/check-tasks-complete.sh --allow-incomplete
```

### 12. `check-verification-verdict.sh` (Machine Verdict Gate)
The final verification step is a prompt, and a prompt cannot fail a workflow. This gate reads the machine-readable verdict the auditor must write and turns it into an exit code. A prose `VERIFICATION_REPORT.md` alone is not evidence.

```bash
# Fails unless <feature>/evidence/verification.json contains {"verdict":"pass"}
bash .specify/scripts/bash/check-verification-verdict.sh

# Human-approved override for non-verifiable runs (never pass this on your own)
bash .specify/scripts/bash/check-verification-verdict.sh --allow-missing
```

```json
{
  "verdict": "reject",
  "critical": 4,
  "high": 3,
  "medium": 3,
  "scenarios_passed": 0,
  "scenarios_total": 22,
  "reasons": ["zero tests executed", "ghost selectors", "no project git repository"],
  "auditor": "independent-qc"
}
```

### 13. `emit-telemetry.sh` (Structured Telemetry & Observability Emitter)
Logs structured JSONL execution events across all quality gates to `.specify/telemetry.jsonl`. Tracks execution durations in milliseconds, exit codes, feature scopes, circuit breaker trip events, and **provenance**: which workflow step ran, which AI model executed it, and which subagent/integration process was launched (`none` when not applicable).

The summary renders `TIMESTAMP | STEP | AGENT | MODEL | SUBAGENT | STATUS | DURATION`:

- **`agent`** is the integration process that ran the step (`pi`, `claude`, `antigravity`, ...).
- **`model`** is the AI model (`sonnet`, `gemini-2.8-flash`, ...). It shows `integration-default` when no `-i model=...` was passed: the integration picks the model, so claiming a name would be a lie. Unresolved engine placeholders (`{{ inputs.model }}`) are never recorded as model names.
- **`subagent`** is the role/persona assigned to the step, taken from its `ROLE:` line in the run's `workflow.yml` snapshot (including `yaml.safe_dump`-style snapshots).
- Shell gates (quality, bundle, contracts, visual, tasks) and the per-task hooks are executed by bash, so they carry no executor of their own. Instead of a bare `none`, they inherit the **project default**: the integration chosen at initialization (`.specify/integration.json`) and the concrete model the active run recorded (never an unresolved `{{ inputs.model }}`), falling back to `integration-default`. `none` now means "no integration is declared at all".
- Imported `step_execution` rows keep their exact provenance: a shell or control-flow step stays `none`; only prompt/command steps report an agent, model and role.

```bash
# Display formatted summary table of recent steps and gate executions
bash .specify/scripts/bash/emit-telemetry.sh --summary

# Merge every step of the active workflow run (agent, model, role, duration)
bash .specify/scripts/bash/emit-telemetry.sh --import-state

# Import + summarize in one shot (used at the end of the workflow)
bash .specify/scripts/bash/emit-telemetry.sh --import-state --summary

# Emit a custom telemetry event with provenance
bash .specify/scripts/bash/emit-telemetry.sh \
  --gate=check-quality-gate \
  --step=gate_quality \
  --agent=pi \
  --model=gemini-2.8-pro \
  --subagent=LEAD ADVERSARIAL QUALITY AUDITOR \
  --status=passed \
  --duration-ms=1450 \
  --scope=src/features/billing
```

`--import-state` resolves the run from `--state=<path>`, `SPECIFY_RUN_ID`/`SPECKIT_RUN_ID`, or the most recently updated run under `.specify/workflows/runs/`. It reads `state.json` (`model`, `integration` -> agent), `log.jsonl` (per-step durations) and the run's `workflow.yml` snapshot (the step's `ROLE:` line), and upserts one `step_execution` record per step without duplicating prior imports. The workflow calls it on every gate failure (via `--summary`) and once at the end in the `telemetry_sync` step, so `.specify/telemetry.jsonl` reflects the full pipeline, not only the gates that happened to emit an event.

---

## Greenfield & Brownfield Compatibility

Every quality gate works in two modes:

| Mode | Behavior |
|---|---|
| **Unscoped** (no `--scope`) | Full rigor: the gate audits all of `src/`. Ideal for greenfield projects and final full-project verification. |
| **Scoped** (`--scope=src/features/<slice>`) | The agent is accountable only for what it touches: env-config audit, ghost-class scanning, orphan/atomic scans, blast radius, and regression tests are narrowed to the slice. Inherited debt elsewhere never blocks the feature. |

**Shared paths are always allowed in a scoped run**, because the gates themselves require them: `src/config/*` (the canonical typed env module), `src/shared/*`, `src/common/*`, `src/styles/*`, `src/main.*`, `src/App.*`, `src/index.*`. Without those exemptions `check-env-config.sh` and `check-blast-radius.sh` would contradict each other: the only way to pass both would be moving `env.ts` out of its canonical path.

Scope flows end-to-end without manual wiring:

```text
workflow input `scope`  →  SPECIFY_SCOPE env var  →  check-quality-gate.sh --scope
                                                    ├─ check-blast-radius.sh --scope
                                                    ├─ check-env-config.sh --path=<scope>
                                                    └─ scoped test execution
SPECIFY_SCOPE           →  verify-stitch-design.sh --scope
                                                    └─ check-contracts.sh --scope
                                                         └─ check-ghost-classes.sh --src-dir=<scope>
```

Strictness applies in **both** modes: a scoped run still fails on zero executed tests, ghost selectors, unchecked tasks, or a missing machine verdict. Scope narrows *what* is audited, never *whether* it is proven — and the `--allow-*` escape hatches are human-owned.

Key brownfield guarantees:

1. **Env guard is scoped**: `check-env-config.sh --path=<scope>` only flags direct `process.env` / `import.meta.env` access inside the slice.
2. **Ghost classes are scoped**: JSX scanning is narrowed to the slice, while the CSS declaration pool stays project-wide so global stylesheets never produce false-positive ghosts.
3. **Bundle budgets are grandfathered**: see `check-bundle-budget.sh` above (baseline + tolerated growth + `ignoreChunks`).
4. **No hard MCP requirement**: Stitch is opt-in via `enable_stitch`, never a `requires.mcp` install blocker.

---

## Impeccable UI Craft Lifecycle Matrix

When building UI features (`has_ui: true`), the workflow integrates the **Impeccable** craft lifecycle across distinct stages:

| Impeccable Sub-Command | Workflow Stage | Target Scope | Output Artifact |
|---|:---:|---|---|
| **`impeccable critique`** | `critique-design` | Heuristic visual hierarchy, contrast (WCAG AA), typography rhythm, and cognitive load assessment. | `specs/<feature>/designs/DESIGN_CRITIQUE.md` |
| **`impeccable harden`** | `tasks` + `implement` | Production robustness: loading skeletons to prevent CLS, empty states with clear CTAs, error boundaries, and input recovery. | Handled in component tests & UI layer |
| **`impeccable animate`** | `implement` (UI polish phase) | GPU-accelerated micro-interactions (`transform`, `opacity`), feedback curves (`cubic-bezier(0.16, 1, 0.3, 1)`), and mandatory `@media (prefers-reduced-motion: reduce)`. | Zero layout thrashing verified by `detect.mjs` |
| **`impeccable audit`** | `verify` | Accessibility verification (WCAG 2.1 AA), keyboard navigation (`tabIndex`, `:focus-visible`), touch targets (min 44x44px), and responsive layout audit. | Recorded in `VERIFICATION_REPORT.md` |

---

## Quality Gate Integrity (Guardrails)

The workflow instructs the model, before any other step, that **gate configuration is human-owned**. The bundle installs three layers of instruction:

1. A `guardrails` prompt step at the start of `workflow.yml`.
2. A `Quality Gate Integrity (NON-NEGOTIABLE)` section in `.specify/memory/constitution.md` (read by Spec Kit commands).
3. A root `AGENTS.md` in the project workspace (read by any IDE agent: Cursor, Gemini CLI, Claude Code, Copilot).

The rule strictly forbids modifying:
- `vite.config.ts`, `vitest.config.ts`, and any quality tooling
- `.specify/scripts/bash/*` quality scripts
- `.specify/extensions.yml` hooks
- Test files, assertions, fixtures, or coverage thresholds to make a failing test pass
- Lint rules, complexity limits, or architecture boundary overrides
- Suppressions like `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`

An **Evidence Integrity** section is installed alongside it: tasks must be checked, the machine verdict must be `pass`, structural-only checks never count as visual proof, `--allow-*` flags require explicit approval, evidence artifacts are append-only, and the project must own its git repository.

When a gate fails, the model must fix the application code. If a gate is genuinely wrong, it must stop and request explicit human approval before changing it. Inside the repair loops (`repair_gates`, `repair_verdict`) silencing a gate is never an acceptable fix. Final verification follows `.specify/workflows/viteplus-stitch/AUDITOR.md`, which the auditor must read and execute; the workflow, not the prose, decides the outcome.

---

## Local Development & CI

The repository ships its own regression suite (Vitest, 210+ tests covering every gate script, the installer, the manifest schema, the workflow schema, and the gate-integrity contract). The suite spawns real bash gates, so `vitest.config.ts` caps `maxWorkers` at 2 to avoid starving workers.

```bash
npm ci                # Install dev dependencies
npm test              # Run the full suite (vitest run)
npm run test:watch
npm run build-release # Build the distributable ZIP (shipped files only)
```

`scripts/build-release.sh` stages only what the installer consumes (`bundle.yml`, `README.md`, `package.json`, `workflows/`, `scripts/`, `templates/`, `extensions/`) and then packs it. Do **not** call `specify bundle build` in a working copy: the packager only skips `.git`, `__pycache__` and `.DS_Store`, so a bare build ships `node_modules/` and `tests/` (17 MB instead of ~55 KB).

GitHub Actions runs `npm ci` + bash syntax validation + manifest validation + `npm test` + a release artifact build with an artifact-hygiene guard on **every push**, every pull request and manually via **workflow_dispatch**, on Node 20 and 22 (`.github/workflows/ci.yml`).

> Tests that need external tooling degrade gracefully: the ZIP installer E2E self-skips unless both `unzip` and the Spec Kit CLI (`specify`) are available.
