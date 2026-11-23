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

- ⚡ **Vite+ (`vp`) as Quality Gate**: Blazing-fast, Rust-powered unified checks for formatting (Oxfmt), linting (Oxlint with Airbnb rules), strict typing (`typeCheck: true`), and cyclomatic complexity limits (max 10).
- 🏛️ **Clean Architecture Boundaries (including vertical slices)**: Enforced import boundaries preventing cross-layer violations across Domain, Application, Infrastructure, and UI (`no-restricted-imports` with Oxlint overrides) in `src/core/**` *and* in every vertical slice such as `src/features/<slice>/{domain,application,infrastructure,ui}/**`.
- 🔐 **Typed Environment Configuration Gate**: Blocks direct `process.env` / `import.meta.env` access in application code. Environment variables must be read, validated, typed, and exported from a single config module (`src/config/env.ts`).
- 🎨 **Zero-Config Styling (Tailwind CSS & Vanilla CSS)**: First-class support for both paradigms. In Tailwind projects, `@shadcn/lint` enforces component token contracts while dynamic utility classes bypass static CSS scans automatically. In Vanilla CSS projects, the Ghost Classes Gate ensures every class referenced in JSX is declared in stylesheets.
- 🖌️ **Optional Google Stitch MCP**: Automated creation of design systems, CSS tokens, and canonical UI screens directly from the terminal.
- ✨ **Impeccable UI Craft Lifecycle**: Full-spectrum visual craft governance for UI features (`has_ui: true`). Runs pre-implementation heuristic art direction (`impeccable critique`), mandates loading skeletons, empty states, and error boundaries in user stories (`impeccable harden`), and polishes motion (`impeccable animate`) and accessibility (`impeccable audit`).
- 👻 **Ghost Classes Quality Gate**: Static AST scanner that verifies that every CSS class referenced in JSX/TSX is declared in a project stylesheet, eliminating dead or missing styles.
- 🛑 **Interactive Visual Review Gate**: Inspect and approve UI screens and design tokens before writing product code.
- 🔬 **Strict Stitch Token Verification**: Every token declared in `tokens.css` must be present in the DOM with the exact Stitch value; drift fails the gate.
- 📊 **Structured Telemetry & Observability**: Every quality gate logs structured JSONL events (`.specify/telemetry.jsonl`) recording timestamp, phase, gate duration in ms, scope, exit codes, and circuit breaker metrics. Inspect with `emit-telemetry.sh --summary`.
- 🛡️ **Machine-Generated Evidence for Definition of Done**: Eliminates subjective agent self-reporting. Generates raw machine proof artifacts in `specs/<feature>/evidence/` (`quality-gate.json`, `bundle-budget.json`, `contracts.json`, `stitch-design.json`) required for task completion.
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

> **Windows note:** use **Git Bash** to run the installer and the `.sh` quality gates. PowerShell works for `npm test`, but if `bash` resolves to WSL (`C:\Windows\System32\bash.exe`), the test suite automatically prefers Git Bash when it is installed. Git Bash is recommended for the workflow scripts themselves.

---

## Installation in Any Project

Run inside the root directory of any repository initialized with Spec Kit (`specify init`):

### Option A: Install from a specific GitHub Release (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --release=v1.2.0
```

### Option B: Install using a downloaded Release `.zip`

If you downloaded `viteplus-stitch-1.2.0.zip` from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --zip=./viteplus-stitch-1.2.0.zip
```

*(Or unzip it and run `bash scripts/install.sh`)*

### Option C: Install latest from `main`

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash
```

> **Note on `specify bundle install`:** Use the standalone `install.sh` script for this bundle. It installs the workflow and its supporting scripts directly into `.specify/`, without requiring the bundle to be published in a Spec Kit catalog. If you later publish this bundle to a catalog, `specify bundle install` can also be used.

### What gets installed

This is a **Spec Kit workflow**, not a slash-command extension. It does not add `/speckit.*` commands to your agent; it adds a workflow that dispatches the existing `speckit.specify`, `speckit.plan`, `speckit.tasks`, and `speckit.implement` commands to the AI integration already configured in your project.

| Path | Purpose |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `.specify/workflows/viteplus-stitch/workflow.yml` | The workflow definition and phase gates |
| `.specify/extensions.yml` | Lifecycle hooks that run the quality gates after tasks/implementation |
| `.specify/scripts/bash/check-quality-gate.sh` | Vite+ + env-config + architecture quality gate |
| `.specify/scripts/bash/check-env-config.sh` | Direct env-access guard |
| `.specify/scripts/bash/verify-stitch-design.sh` | Playwright Stitch token/visual gate |
| `.specify/scripts/bash/check-blast-radius.sh` | Blast radius scope protection & circuit breaker anti-loop guard |
| `.specify/scripts/bash/check-contracts.sh` | Route manifest & orphan component contract integrity gate |
| `.specify/scripts/bash/check-ghost-classes.sh` | Ghost classes gate: scans JSX/TSX for undeclared CSS classes |
| `.specify/scripts/bash/check-bundle-budget.sh` | Production performance & bundle size budget gate |
| `.specify/scripts/bash/emit-telemetry.sh` | Structured telemetry & observability event logger |
| `.specify/templates/` | `vite.config.ts`, Playwright, env config, and design-audit templates |
| `.specify/workflows/viteplus-stitch/GUARDRAILS.md` | Non-negotiable policy: never weaken gates to pass tests |
| `.specify/memory/constitution.md` | Receives the "Quality Gate Integrity" section (read by every command) |
| `AGENTS.md` | Root workspace guidelines: Clean Architecture boundaries, env-config & quality gates for any AI agent (Gemini, Claude, Cursor, Copilot) |

The workflow uses `integration: auto` by default, which reads the integration selected when the project was initialized with `specify init` (for example Claude, Gemini, or Copilot).

---

## Step-by-Step Workflow Execution

```
[ Step 1: specify ]  ──►  [ Step 2: audit-spec ]  ──►  [ Step 3: plan ]
                                  │                               │
                          (review-spec gate)          [ Step 4: generate-designs ]
                                                                  │
                                                      [ Step 5: critique-design ]
                                                                  │
                                                          (review-design gate)
                                                                  │
[ Step 10: verify ]  ◄── [ Step 9: auto_repair ]  ◄──   [ Step 7: tasks ]
  - Scenario Matrix        (Self-Healing Loop)             │
  - Evidence Log                   ▲                       ▼
  - Delta-Spec Sync                │              [ Step 8: implement ]
                           [ Shell Gates ]                 │
                           - bootstrap_deps                ▼
                           - gate_quality      ──► [ Quality Feedback ]
                           - gate_bundle           (continue_on_error)
                           - gate_contracts
```

### Step 1: Start a New Feature
Trigger the cycle with a prompt describing what you want to build:
```bash
specify workflow run viteplus-stitch --input spec="Create a credit card management module with list, details, and fee calculations"
```

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
- The agent explicitly invokes **Google Stitch MCP** (`create_project`, `create_design_system`, `generate_screen_from_text`).
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

### Step 7: Phase-by-Phase Task Breakdown (`speckit.tasks`)
Generates `tasks.md` split into strictly ordered phases:
- `Phase 1: Setup` (Vite+ configuration, dependencies, CSS tokens)
- `Phase 2: Core & Domain` (Entities, Value Objects, Repository Ports)
- `Phase 3..N: User Stories` (TDD, application services, atomic components)
- `Phase Final: Polish & Verification` (Impeccable animate, audit, and E2E)

### Step 8: Phased Implementation with Automated Quality Gates
The agent executes tasks phase by phase. After each phase completes, deterministic quality gates run:
1. **Static Gate (`vp check`)**:
   - Validates types (`tsc`), formatting (Oxfmt), and linting (Oxlint with Airbnb rules).
   - Enforces cyclomatic complexity 10 and 50 lines max per function for business logic (`domain`, `application`, `infrastructure`). UI presentation components (`src/**/ui/**`) are exempted (`max-lines-per-function: 'off'`) to prevent artificial component fragmentation ("ravioli code") in accessible JSX components with ARIA attributes and variants.
   - Enforces Clean Architecture: Domain cannot import Application, Infrastructure, or UI.
   - Centralized typed env config: fails if application code reads `process.env` or `import.meta.env` directly outside `src/config/env.ts`.
2. **Visual Playwright Gate (`verify-stitch-design.sh`)**:
   - Compares DOM `:root` computed tokens against `tokens.css`.
   - Runs WCAG 2.1 AA accessibility checks on all declared routes.
   - When golden screenshot masters exist, runs snapshot comparison with tolerance `0.05`. If no golden screenshot is present, screenshot diffing is skipped gracefully while token and A11y checks pass. If no `designs/` directory exists (`enable_stitch=false` or `has_ui=false`), the gate self-skips cleanly with exit code 0.

### Step 9: Verification & Delta-Spec Sync (`verify`)
Once implementation completes, the workflow executes the final certification:
1. **Accessibility & Craft Audit**: When `has_ui: true`, activates `impeccable` to audit WCAG 2.1 AA compliance, keyboard navigation (`:focus-visible`), touch targets (44px), and reduced-motion support (`impeccable audit` + `impeccable animate`).
2. **Scenario Verification Matrix**: Cross-checks each Given/When/Then scenario against automated test proof.
3. **Verification Report (`VERIFICATION_REPORT.md`)**: Generates full evidence log with test runs, gate outputs, and bundle budget metrics.
4. **Delta-Spec Sync**: Documents any architectural refinements or domain clarifications discovered during implementation.

---

## Workflow CLI Parameters & Inputs Reference

When running `specify workflow run viteplus-stitch`, you can configure the behavior using `--input <key>=<value>` (or `-i <key>=<value>`):

| Input Parameter | Type | Default | Required? | Description & Usage |
|---|:---:|:---:|:---:|---|
| **`spec`** | `string` | — | **Yes** | Natural language description or feature prompt detailing what to build. |
| **`scope`** | `string` | `""` | No | Restricts all code changes, test executions, and blast radius checks to a specific feature slice (e.g. `src/features/billing`). When empty, auto-detects from git status or targets the full project. |
| **`has_ui`** | `boolean` | `true` | No | Controls UI-specific phases. When `false`, completely skips Google Stitch, Impeccable critique, Playwright visual gates, route contracts, and ghost classes check. Ideal for backend, domain, or CLI features. |
| **`enable_stitch`** | `boolean` | `true` | No | When `has_ui: true`, toggles whether to use Google Stitch MCP for automated design generation (`true`) or use component wireframes defined directly in `plan.md` (`false`). |
| **`auto_continue`** | `boolean` | `false` | No | Enables **Unattended Mode**. When `true`, automatically bypasses human approval gates (`review-spec`, `review-design`, and phase-by-phase pauses) once automated quality gates pass. When `false` (default), pauses for human confirmation. |
| **`integration`** | `string` | `auto` | No | Selects the AI runner integration (e.g. `claude`, `gemini`, `copilot`, `auto`). |
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
```

---

## Standalone Quality Scripts CLI Reference

> **💡 Mental Model Note:** You do **not** need to run these scripts manually during the normal SDD workflow. Spec Kit invokes them automatically inside lifecycle hooks (`after_task` and `after_implement`). This reference is provided for running manual checks in your local terminal or integrating them into CI/CD pipelines (e.g. GitHub Actions).

All quality gates installed in `.specify/scripts/bash/` can be executed independently in local development or in CI/CD pipelines:

### 1. `check-quality-gate.sh` (Core Deterministic Gate)
Runs formatting (Oxfmt Airbnb), linting (Oxlint with complexity limits), TypeScript strict types, Clean Architecture boundary checks, centralized env guard, regression test suite, and application compilation/build verification.

```bash
# Run all deterministic checks (including tests and compilation)
bash .specify/scripts/bash/check-quality-gate.sh

# Target a specific feature slice: scopes blast-radius, env-config audit, and regression tests
bash .specify/scripts/bash/check-quality-gate.sh --scope=src/features/billing

# Automatically format code issues via Oxfmt / Vite+
bash .specify/scripts/bash/check-quality-gate.sh --fix

# Skip regression tests
bash .specify/scripts/bash/check-quality-gate.sh --skip-tests

# Skip application compilation/build (used during intermediate after_task checks)
bash .specify/scripts/bash/check-quality-gate.sh --skip-build

# Report violations without exiting with error code
bash .specify/scripts/bash/check-quality-gate.sh --dry-run

# Reset circuit breaker counter to 0 after repeated failures
bash .specify/scripts/bash/check-quality-gate.sh --reset-breaker
```

### 2. `check-contracts.sh` (Route & Component Contract Gate)
Validates that routes in `routes-manifest.json` match application screens, fixtures exist, no unconsumed/orphan components exist in `src/`, and Atomic Design (1 component per file) is enforced. Automatically invokes `check-ghost-classes.sh`.

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

### 3. `check-ghost-classes.sh` (Ghost Classes Gate & Multi-Engine Styling Support)
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

### 4. `verify-stitch-design.sh` (Stitch Token & Visual Gate)
Compares design tokens in `tokens.css` against DOM `:root` computed styles, followed by Playwright visual snapshot regression testing and route contract validation.

> **💡 Graceful Degradation / Auto-Bypass:** If `specs/<feature>/designs` does not exist (e.g. backend features run with `has_ui=false` or UI features run with `enable_stitch=false`), this script automatically **skips execution and exits with code 0**, keeping CI/CD pipelines green. If `tokens.css` is present but golden `.png` screenshots are omitted (text-only HTML assets), token verification and WCAG AA accessibility tests run while screenshot diffing is gracefully bypassed.

```bash
# Fast token validation only (runs in <1s without starting Playwright)
bash .specify/scripts/bash/verify-stitch-design.sh --tokens-only

# Full visual regression comparison against Stitch golden screenshots
bash .specify/scripts/bash/verify-stitch-design.sh --feature-dir=specs/001-feature

# Skip orphan UI component detection during intermediate design checks
bash .specify/scripts/bash/verify-stitch-design.sh --skip-orphans
```

### 5. `check-bundle-budget.sh` (Production Performance Gate)
Executes `vp build` (Rolldown engine) and inspects production bundle sizes against defined budgets.

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

### 6. `check-env-config.sh` (Direct Environment Access Guard)
Ensures that no application file accesses `process.env` or `import.meta.env` directly outside the designated typed module.

```bash
bash .specify/scripts/bash/check-env-config.sh --env-config=src/config/env.ts
```

### 7. `check-blast-radius.sh` (Scope & Circuit Breaker Guard)
Prevents autonomous agents from modifying protected quality scripts, workflows, or files outside the feature scope.

```bash
bash .specify/scripts/bash/check-blast-radius.sh --scope=src/features/billing
```

### 8. `emit-telemetry.sh` (Structured Telemetry & Observability Emitter)
Logs structured JSONL execution events across all quality gates to `.specify/telemetry.jsonl`. Tracks execution durations in milliseconds, exit codes, feature scopes, and circuit breaker trip events.

```bash
# Display formatted summary table of recent gate executions
bash .specify/scripts/bash/emit-telemetry.sh --summary

# Emit a custom telemetry event
bash .specify/scripts/bash/emit-telemetry.sh \
  --gate=check-quality-gate \
  --status=passed \
  --duration-ms=1450 \
  --scope=src/features/billing
```

---

## Greenfield & Brownfield Compatibility

Every quality gate works in two modes:

| Mode | Behavior |
|---|---|
| **Unscoped** (no `--scope`) | Full rigor: the gate audits all of `src/`. Ideal for greenfield projects and final full-project verification. |
| **Scoped** (`--scope=src/features/<slice>`) | The agent is accountable only for what it touches: env-config audit, ghost-class scanning, orphan/atomic scans, blast radius, and regression tests are narrowed to the slice. Inherited debt elsewhere never blocks the feature. |

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
| **`impeccable critique`** | Step 4 (`critique-design`) | Heuristic visual hierarchy, contrast (WCAG AA), typography rhythm, and cognitive load assessment. | `specs/<feature>/designs/DESIGN_CRITIQUE.md` |
| **`impeccable harden`** | Step 6 & 7 (Tasks & Implementation) | Production robustness: loading skeletons to prevent CLS, empty states with clear CTAs, error boundaries, and input recovery. | Handled in component tests & UI layer |
| **`impeccable animate`** | Step 7 (UI Polish Phase) | GPU-accelerated micro-interactions (`transform`, `opacity`), feedback curves (`cubic-bezier(0.16, 1, 0.3, 1)`), and mandatory `@media (prefers-reduced-motion: reduce)`. | Zero layout thrashing verified by `detect.mjs` |
| **`impeccable audit`** | Step 8 (`verify`) | Accessibility verification (WCAG 2.1 AA), keyboard navigation (`tabIndex`, `:focus-visible`), touch targets (min 44x44px), and responsive layout audit. | Recorded in `VERIFICATION_REPORT.md` |

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

When a gate fails, the model must fix the application code. If a gate is genuinely wrong, it must stop and request explicit human approval before changing it.

---

## Local Development & CI

The repository ships its own regression suite (Vitest, 90+ specs covering every gate script, the installer, the manifest schema, and the workflow schema).

```bash
npm ci                # Install dev dependencies
npm test              # Run the full suite (vitest run)
npm run test:watch
npm run build-release # Build the distributable ZIP (shipped files only)
```

`scripts/build-release.sh` stages only what the installer consumes (`bundle.yml`, `README.md`, `package.json`, `workflows/`, `scripts/`, `templates/`, `extensions/`) and then packs it. Do **not** call `specify bundle build` in a working copy: the packager only skips `.git`, `__pycache__` and `.DS_Store`, so a bare build ships `node_modules/` and `tests/` (17 MB instead of ~55 KB).

GitHub Actions runs `npm ci` + bash syntax validation + manifest validation + `npm test` + a release artifact build with an artifact-hygiene guard on **every push**, every pull request and manually via **workflow_dispatch**, on Node 20 and 22 (`.github/workflows/ci.yml`).

> Tests that need external tooling degrade gracefully: the ZIP installer E2E self-skips unless both `unzip` and the Spec Kit CLI (`specify`) are available.
