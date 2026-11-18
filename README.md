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
3. **Google Stitch MCP** configured in your AI agent environment (optional, only needed for UI features).
4. **Playwright** installed in the project (`npx playwright install --with-deps chromium`).

> **Windows note:** use **Git Bash** to run the installer and the `.sh` quality gates. PowerShell works for `npm test`, but if `bash` resolves to WSL (`C:\Windows\System32\bash.exe`), the test suite automatically prefers Git Bash when it is installed. Git Bash is recommended for the workflow scripts themselves.

---

## Installation in Any Project

Run inside the root directory of any repository initialized with Spec Kit (`specify init`):

### Option A: Install from a specific GitHub Release (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --release=v1.1.0
```

### Option B: Install using a downloaded Release `.zip`

If you downloaded `viteplus-stitch-1.1.0.zip` from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --zip=./viteplus-stitch-1.1.0.zip
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
| `.specify/templates/` | `vite.config.ts`, Playwright, env config, and design-audit templates |
| `.specify/workflows/viteplus-stitch/GUARDRAILS.md` | Non-negotiable policy: never weaken gates to pass tests |
| `.specify/memory/constitution.md` | Receives the "Quality Gate Integrity" section (read by every command) |

The workflow uses `integration: auto` by default, which reads the integration selected when the project was initialized with `specify init` (for example Claude, Gemini, or Copilot).

---

## Step-by-Step Workflow Execution

```
[ Step 1: specify ]  ──►  [ Step 2: audit-spec ]  ──►  [ Step 3: plan + stitch ]
                                  │                               │
                          (review-spec gate)              [ Step 4: critique-design ]
                                                                  │
                                                          (review-design gate)
                                                                  │
[ Step 7: verify ]   ◄──  [ Step 6: implement ]   ◄──  [ Step 5: tasks ]
  - Scenario Matrix         - after_task: quality + tokens
  - Evidence Log            - after_implement: contracts + budget + visual
  - Delta-Spec Sync
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

### Step 3: Planning, CSS Tokens, and Stitch Screens
The workflow generates the implementation plan (`plan.md`):
- If `has_ui: true` and `enable_stitch: true`, the agent invokes Google Stitch MCP to generate design systems and screens.
- Downloads reference screenshots to `specs/<feature>/designs/<screen-id>.png` and tokens to `specs/<feature>/designs/tokens.css`.
- Creates `routes-manifest.json` mapping screens to local dev routes.
- If `enable_stitch: false`, wireframes and component contracts are specified directly in `plan.md`.

### Step 4: Impeccable Design Critique (`critique-design`)
When `has_ui: true`:
- The agent activates the **`impeccable`** skill to evaluate the UI proposal.
- Audits visual hierarchy (Operate vs Persuade), contrast ratios (WCAG AA), typography, and spacing rhythm.
- Generates `specs/<feature>/designs/DESIGN_CRITIQUE.md` with heuristic findings and actionable recommendations.
- Outputs a concise 5-line summary in the terminal.

### Step 5: Visual Design Review Gate (`review-design`)
When `has_ui: true`:
- In **interactive mode** (`auto_continue: false`): pauses for visual inspection:
  - Review screens and `DESIGN_CRITIQUE.md`.
  - **If approved**: Select **`[approve]`**. Designs and tokens are frozen as canonical masters.
  - **If changes needed**: Select **`[reject]`** to abort or refine screens before planning.
- In **unattended mode** (`auto_continue: true`): bypassed automatically, freezing audited designs and progressing to tasks.

### Step 6: Phase-by-Phase Task Breakdown (`speckit.tasks`)
Generates `tasks.md` split into strictly ordered phases:
- `Phase 1: Setup` (Vite+ configuration, dependencies, CSS tokens)
- `Phase 2: Core & Domain` (Entities, Value Objects, Repository Ports)
- `Phase 3..N: User Stories` (TDD, application services, atomic components)
- `Phase Final: Polish & Verification` (Impeccable animate, audit, and E2E)

### Step 7: Phased Implementation with Automated Quality Gates
The agent executes tasks phase by phase. After each phase completes, deterministic quality gates run:
1. **Static Gate (`vp check`)**:
   - Validates types (`tsc`), formatting (Oxfmt), and linting (Oxlint with Airbnb rules).
   - Enforces cyclomatic complexity 10 and 50 lines max per function for business logic (`domain`, `application`, `infrastructure`). UI presentation components (`src/**/ui/**`) are exempted (`max-lines-per-function: 'off'`) to prevent artificial component fragmentation ("ravioli code") in accessible JSX components with ARIA attributes and variants.
   - Enforces Clean Architecture: Domain cannot import Application, Infrastructure, or UI.
   - Centralized typed env config: fails if application code reads `process.env` or `import.meta.env` directly outside `src/config/env.ts`.
2. **Visual Playwright Gate**:
   - Compares DOM `:root` computed tokens against `tokens.css`.
   - Runs snapshot comparison against the Stitch golden master with tolerance `0.05`.

### Step 8: Verification & Delta-Spec Sync (`verify`)
Once implementation completes, the workflow executes the final certification:
1. **Scenario Verification Matrix**: Cross-checks each Given/When/Then scenario against automated test proof.
2. **Verification Report (`VERIFICATION_REPORT.md`)**: Generates full evidence log with test runs, gate outputs, and bundle budget metrics.
3. **Delta-Spec Sync**: Documents any architectural refinements or domain clarifications discovered during implementation.

---

## Workflow CLI Parameters & Inputs Reference

When running `specify workflow run viteplus-stitch`, you can configure the behavior using `--input <key>=<value>` (or `-i <key>=<value>`):

| Input Parameter | Type | Default | Required? | Description & Usage |
|---|:---:|:---:|:---:|---|
| **`spec`** | `string` | — | **Yes** | Natural language description or feature prompt detailing what to build. |
| **`has_ui`** | `boolean` | `true` | No | Controls UI-specific phases. When `false`, completely skips Google Stitch, Impeccable critique, Playwright visual gates, route contracts, and ghost classes check. Ideal for backend, domain, or CLI features. |
| **`enable_stitch`** | `boolean` | `true` | No | When `has_ui: true`, toggles whether to use Google Stitch MCP for automated design generation (`true`) or use component wireframes defined directly in `plan.md` (`false`). |
| **`auto_continue`** | `boolean` | `false` | No | Enables **Unattended Mode**. When `true`, automatically bypasses human approval gates (`review-spec`, `review-design`, and phase-by-phase pauses) once automated quality gates pass. When `false` (default), pauses for human confirmation. |
| **`integration`** | `string` | `auto` | No | Selects the AI runner integration (e.g. `claude`, `gemini`, `copilot`, `auto`). |

### Common CLI Invocation Examples

```bash
# 1. Interactive Full UI Workflow (Default): Pauses for human review at design & phases
specify workflow run viteplus-stitch \
  -i spec="Create a Daily Habit & Streak Tracker with weekly analytics"

# 2. Unattended Full UI Workflow: Runs all phases autonomously until completion
specify workflow run viteplus-stitch \
  -i spec="Create a Daily Habit & Streak Tracker" \
  -i auto_continue=true

# 3. Non-UI / Backend Feature: Skips visual design and UI gates entirely
specify workflow run viteplus-stitch \
  -i spec="Add JWT authentication middleware and token refresher" \
  -i has_ui=false

# 4. UI Feature without Google Stitch: Uses local wireframes and Impeccable craft
specify workflow run viteplus-stitch \
  -i spec="Add billing plans selector" \
  -i enable_stitch=false

# 5. Force specific AI model runner
specify workflow run viteplus-stitch \
  -i spec="Implement user settings profile" \
  -i integration=gemini
```

---

## Standalone Quality Scripts CLI Reference

> **💡 Mental Model Note:** You do **not** need to run these scripts manually during the normal SDD workflow. Spec Kit invokes them automatically inside lifecycle hooks (`after_task` and `after_implement`). This reference is provided for running manual checks in your local terminal or integrating them into CI/CD pipelines (e.g. GitHub Actions).

All quality gates installed in `.specify/scripts/bash/` can be executed independently in local development or in CI/CD pipelines:

### 1. `check-quality-gate.sh` (Core Deterministic Gate)
Runs formatting (Oxfmt Airbnb), linting (Oxlint with complexity limits), TypeScript strict types, Clean Architecture boundary checks, centralized env guard, and the regression test suite.

```bash
# Run all deterministic checks
bash .specify/scripts/bash/check-quality-gate.sh

# Automatically format code issues via Oxfmt / Vite+
bash .specify/scripts/bash/check-quality-gate.sh --fix

# Skip regression tests (lint, types, env, and architecture only)
bash .specify/scripts/bash/check-quality-gate.sh --skip-tests

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
```

### 3. `check-ghost-classes.sh` (Ghost Classes Gate & Tailwind Auto-Detection)
Scans all JSX/TSX files for class names in `className` attributes and verifies that each referenced class exists in at least one stylesheet (`src/**/*.css`, `tokens.css`).

**Tailwind CSS Compatibility:** Automatically detects if the project uses Tailwind CSS (`tailwind.config.*`, `@tailwindcss` in `package.json`, or `@import "tailwindcss"` in stylesheets). When Tailwind is active, dynamic utility classes are generated on demand, so static CSS class checks are automatically skipped. You can pass `--force` to mandate static declarations.

```bash
# Check for ghost classes in src/ (auto-detects Tailwind)
bash .specify/scripts/bash/check-ghost-classes.sh

# Custom source directory
bash .specify/scripts/bash/check-ghost-classes.sh --src-dir=src/components

# Force static CSS verification even if Tailwind is present
bash .specify/scripts/bash/check-ghost-classes.sh --force

# Dry run mode
bash .specify/scripts/bash/check-ghost-classes.sh --dry-run
```

### 4. `verify-stitch-design.sh` (Stitch Token & Visual Gate)
Compares design tokens in `tokens.css` against DOM `:root` computed styles, followed by Playwright visual snapshot regression testing and contract validation.

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
bash .specify/scripts/bash/check-bundle-budget.sh --max-chunk=180 --max-total=800
```

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

The workflow instructs the model, before any other step, that **gate configuration is human-owned**. The bundle installs two layers of instruction:

1. A `guardrails` prompt step at the start of `workflow.yml`.
2. A `Quality Gate Integrity (NON-NEGOTIABLE)` section in `.specify/memory/constitution.md`.

The rule strictly forbids modifying:
- `vite.config.ts`, `vitest.config.ts`, and any quality tooling
- `.specify/scripts/bash/*` quality scripts
- `.specify/extensions.yml` hooks
- Test files, assertions, fixtures, or coverage thresholds to make a failing test pass
- Lint rules, complexity limits, or architecture boundary overrides
- Suppressions like `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`

When a gate fails, the model must fix the application code. If a gate is genuinely wrong, it must stop and request explicit human approval before changing it.
