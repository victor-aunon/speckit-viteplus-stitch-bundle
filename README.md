# Vite+ & Stitch Quality Workflow for Spec Kit

Deterministic Spec-Driven Development (SDD) workflow for high-fidelity web applications with strict architectural and visual quality gates.

## Key Features
* ⚡ **Vite+ (`vp`) as Quality Gate**: Blazing-fast, Rust-powered unified checks for formatting (Oxfmt), linting (Oxlint with Airbnb rules), strict typing (`typeCheck: true`), and cyclomatic complexity limits (max 10).
* 🏛️ **Clean Architecture Boundaries**: Enforced import boundaries preventing cross-layer violations across Domain, Application, Infrastructure, and UI (`import/no-restricted-paths`).
* 🎨 **@shadcn/lint for Tailwind CSS**: Component contract enforcement, blocking arbitrary bracket values (`p-[13px]`) and unsemantic palette classes.
* 🖌️ **Optional Google Stitch MCP**: Automated creation of design systems, CSS tokens, and canonical UI screens directly from the terminal.
* 🛑 **Interactive Visual Review Gate**: Inspect and approve UI screens and design tokens before writing product code.
* 🔄 **Phased Implementation with Checkpoints**: Playwright and Vite+ validate every phase before allowing the workflow to proceed.

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

---

## Installation in Any Project

Run inside the root directory of any repository initialized with Spec Kit (`specify init`):

### Option A: Install from a specific GitHub Release (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --release=v1.0.0
```

### Option B: Install using a downloaded Release `.zip`
If you downloaded `viteplus-stitch-1.0.0.zip` from GitHub Releases:
```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash -s -- --zip=./viteplus-stitch-1.0.0.zip
```
*(Or unzip it and run `bash scripts/install.sh`)*

### Option C: Install latest from `main`
```bash
curl -fsSL https://raw.githubusercontent.com/victor-aunon/speckit-viteplus-stitch-bundle/main/scripts/install.sh | bash
```

> **Note on `specify bundle install`:** In current versions of Spec Kit CLI (`<= 0.8.x`), `specify bundle install` only resolves workflows that are officially merged into the central GitHub catalog (`github/spec-kit`). For third-party or custom workflow bundles, the standalone `install.sh` script is the official installation method, which cleanly unpacks the workflow, sets up executable quality gate scripts, and registers lifecycle hooks in `.specify/`.

This automatically sets up:
* The workflow at `.specify/workflows/viteplus-stitch/`
* Lifecycle hooks in `.specify/extensions.yml`
* Quality gate scripts in `.specify/scripts/bash/`
* Configuration templates for `vite.config.ts` and Playwright in `templates/`

---

## Step-by-Step Workflow

### Step 1: Start a New Feature
Trigger the cycle with a prompt describing what you want to build:

```bash
specify workflow run viteplus-stitch --input spec="Create a credit card management module with list, details, and fee calculations"
```
*(You can also trigger it conversationally with your AI agent: "Run the viteplus-stitch workflow for feature X")*

### Step 2: Specification Approval (`review-spec`)
Spec Kit generates the functional technical specification (`specs/<feature>/spec.md`) and pauses:
* Review requirements and Gherkin scenarios.
* Select **`[approve]`** to proceed or **`[reject]`** to adjust.

### Step 3: Planning, CSS Tokens, and Stitch Screens
The workflow generates the implementation plan (`plan.md`):
* If the feature includes a UI, the agent invokes Google Stitch MCP.
* Creates the design system and generates required screen views.
* Downloads reference screenshots to `specs/<feature>/designs/<screen-id>.png` and tokens to `specs/<feature>/designs/tokens.css`.
* Creates `routes-manifest.json` mapping screens to local dev routes.

### Step 4: Visual Design Review Gate (`review-design`)
The workflow pauses and presents the generated screens:
* Open them locally in your image viewer or browser.
* **If you like the design**: Select **`[approve]`**. Designs are frozen as the canonical golden master.
* **If you want changes**: Select **`[request_changes]`** and instruct the agent (e.g. *"make the main call to action button more prominent with dark variant"*). The agent uses Stitch `edit_screens` before freezing.

### Step 5: Phase-by-Phase Task Breakdown
The `speckit.tasks` command generates `tasks.md` split into strictly ordered phases:
* `Phase 1: Setup` (Vite+ configuration, dependencies, CSS tokens)
* `Phase 2: Core & Domain` (Entities, Value Objects, Repository Ports)
* `Phase 3..N: User Stories` (Use cases, adapters, and UI components)
* `Phase Final: Polish & E2E` (Full integration and end-to-end tests)

### Step 6: Phased Implementation with Automated Quality Gates
The agent executes tasks phase by phase. After each phase completes, two deterministic quality gates run:

1. **Static Gate (`vp check`)**:
   * Validates types (`tsc`), formatting (Oxfmt), and linting (Oxlint).
   * Fails if any function exceeds cyclomatic complexity 10 or 50 lines.
   * Fails if domain imports infrastructure or UI.
   * Fails if an invalid Tailwind utility is detected by `@shadcn/lint`.
   * **The agent fixes all reported issues before continuing to the next phase.**

2. **Visual Playwright Gate (when the phase touches UI)**:
   * Playwright starts the application via `vp dev`.
   * Confirms computed DOM CSS variables match `tokens.css`.
   * Runs snapshot comparison (`toHaveScreenshot`) against the Stitch golden master with controlled tolerance (`0.05`).
   * If deviations exceed the threshold, the agent adjusts the markup.

### Step 7: Completion
Once all phases are completed and all checkpoints pass, the feature is fully verified, architecturally clean, and ready to merge.
