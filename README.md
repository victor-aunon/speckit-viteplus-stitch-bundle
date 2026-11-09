# Vite+ & Stitch Quality Workflow for Spec Kit

Deterministic Spec-Driven Development (SDD) workflow for high-fidelity web applications with strict architectural and visual quality gates.

## Key Features

- ⚡ **Vite+ (`vp`) as Quality Gate**: Blazing-fast, Rust-powered unified checks for formatting (Oxfmt), linting (Oxlint with Airbnb rules), strict typing (`typeCheck: true`), and cyclomatic complexity limits (max 10).
- 🏛️ **Clean Architecture Boundaries (including vertical slices)**: Enforced import boundaries preventing cross-layer violations across Domain, Application, Infrastructure, and UI (`import/no-restricted-paths`) in `src/core/**` *and* in every vertical slice such as `src/features/<slice>/{domain,application,infrastructure,ui}/**`.
- 🔐 **Typed Environment Configuration Gate**: Blocks direct `process.env` / `import.meta.env` access in application code. Environment variables must be read, validated, typed, and exported from a single config module (`src/config/env.ts`).
- 🎨 **@shadcn/lint for Tailwind CSS**: Component contract enforcement, blocking arbitrary bracket values (`p-[13px]`) and unsemantic palette classes.
- 🖌️ **Optional Google Stitch MCP**: Automated creation of design systems, CSS tokens, and canonical UI screens directly from the terminal.
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

> **Note on `specify bundle install`:** Use the standalone `install.sh` script for this bundle. It installs the workflow and its supporting scripts directly into `.specify/`, without requiring the bundle to be published in a Spec Kit catalog. If you later publish this bundle to a catalog, `specify bundle install` can also be used.

### What gets installed

This is a **Spec Kit workflow**, not a slash-command extension. It does not add `/speckit.*` commands to your agent; it adds a workflow that dispatches the existing `speckit.specify`, `speckit.plan`, `speckit.tasks`, and `speckit.implement` commands to the AI integration already configured in your project.


| Path                                              | Purpose                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `.specify/workflows/viteplus-stitch/workflow.yml` | The workflow definition and phase gates                               |
| `.specify/extensions.yml`                         | Lifecycle hooks that run the quality gates after tasks/implementation |
| `.specify/scripts/bash/check-quality-gate.sh`     | Vite+ + env-config + architecture quality gate                        |
| `.specify/scripts/bash/check-env-config.sh`       | Direct env-access guard                                               |
| `.specify/scripts/bash/verify-stitch-design.sh`   | Playwright Stitch token/visual gate                                   |
| `.specify/templates/`                             | `vite.config.ts`, Playwright, env config, and design-audit templates  |
| `.specify/workflows/viteplus-stitch/GUARDRAILS.md` | Non-negotiable policy: never weaken gates to pass tests              |
| `.specify/memory/constitution.md`                 | Receives the "Quality Gate Integrity" section (read by every command) |


The workflow uses `integration: auto` by default, which reads the integration selected when the project was initialized with `specify init` (for example Claude, Gemini, or Copilot).

---

## How to Interact from an AI Agent

### Option 1: Start from the terminal (recommended)

Run the workflow from the project root. Spec Kit dispatches each step to your configured AI integration:

```bash
specify workflow run viteplus-stitch \
  --input spec="Create a credit card management module with list, details, and fee calculations"
```

When a gate appears, answer it in the terminal. If the workflow pauses, inspect and resume it later with:

```bash
specify workflow status --json
specify workflow resume <run_id>
```

### Option 2: Ask your AI agent to run it

In your agent chat, ask it to execute the workflow through its terminal/shell tool:

> Run this from the project root: `specify workflow run viteplus-stitch --input spec="Create a credit card management module"`. Then show me `specify workflow status --json` and stop at every gate until I approve.

The agent needs permission to run terminal commands. If the agent cannot answer interactive gate prompts, let it run until the gate pauses, then run `specify workflow resume <run_id>` yourself in a terminal and answer the gate there.

### Optional inputs

```bash
# Disable Stitch for a non-UI feature
specify workflow run viteplus-stitch -i spec="Add a CSV parser" -i enable_stitch=false

# Force a specific AI integration
specify workflow run viteplus-stitch -i spec="Add billing" -i integration=claude

# Run every implementation phase without pausing after each phase
specify workflow run viteplus-stitch -i spec="Add billing" -i auto_continue=true
```

You can also trigger it conversationally with your AI agent: *"Run the viteplus-stitch workflow for feature X and pause at each gate."*

---

## Step-by-Step Workflow

### Step 1: Start a New Feature

Trigger the cycle with a prompt describing what you want to build:

```bash
specify workflow run viteplus-stitch --input spec="Create a credit card management module with list, details, and fee calculations"
```

Spec Kit then runs the workflow's command steps through your configured AI integration. See [How to Interact from an AI Agent](#how-to-interact-from-an-ai-agent) for agent-first usage and gate handling.

### Step 2: Specification Approval (`review-spec`)

Spec Kit generates the functional technical specification (`specs/<feature>/spec.md`) and pauses:

- Review requirements and Gherkin scenarios.
- Select **`[approve]`** to proceed or **`[reject]`** to adjust.

### Step 3: Planning, CSS Tokens, and Stitch Screens

The workflow generates the implementation plan (`plan.md`):

- If the feature includes a UI, the agent invokes Google Stitch MCP.
- Creates the design system and generates required screen views.
- Downloads reference screenshots to `specs/<feature>/designs/<screen-id>.png` and tokens to `specs/<feature>/designs/tokens.css`.
- Creates `routes-manifest.json` mapping screens to local dev routes.

### Step 4: Visual Design Review Gate (`review-design`)

The workflow pauses and presents the generated screens:

- Open them locally in your image viewer or browser.
- **If you like the design**: Select **`[approve]`**. Designs are frozen as the canonical golden master.
- **If you want changes**: Select **`[request_changes]`** and instruct the agent (e.g. *"make the main call to action button more prominent with dark variant"*). The agent uses Stitch `edit_screens` before freezing.

### Step 5: Phase-by-Phase Task Breakdown

The `speckit.tasks` command generates `tasks.md` split into strictly ordered phases:

- `Phase 1: Setup` (Vite+ configuration, dependencies, CSS tokens)
- `Phase 2: Core & Domain` (Entities, Value Objects, Repository Ports)
- `Phase 3..N: User Stories` (Use cases, adapters, and UI components)
- `Phase Final: Polish & E2E` (Full integration and end-to-end tests)

### Step 6: Phased Implementation with Automated Quality Gates

The agent executes tasks **phase by phase**. After each phase completes, two deterministic quality gates run:

1. **Static Gate (`vp check`)**:
   - Validates types (`tsc`), formatting (Oxfmt), and linting (Oxlint).
   - Fails if any function exceeds cyclomatic complexity 10 or 50 lines.
   - Fails if domain imports infrastructure or UI, including inside any vertical slice under `src/**`.
   - Runs the env config gate and fails if application code reads `process.env` or `import.meta.env` directly, or if `src/config/env.ts` is missing/not typed.
   - Fails if an invalid Tailwind utility is detected by `@shadcn/lint`.
   - **The agent fixes all reported issues before continuing to the next phase.**
2. **Visual Playwright Gate (when the phase touches UI)**:
   - Playwright starts the application via `vp dev`.
   - Parses every token in `tokens.css` and compares it against the computed DOM value on `:root`; any missing token or different value fails the gate.
   - Runs snapshot comparison (`toHaveScreenshot`) against the Stitch golden master with controlled tolerance (`0.05`).
   - If deviations exceed the threshold, the agent adjusts the markup.

**Phase approval (default)**: after both gates pass, the workflow stops and asks whether to continue to the next phase. Nothing is implemented beyond the current phase without approval.

**Unattended mode**: run the workflow with `auto_continue=true`, or pass `--auto-continue` to `speckit.implement`, to execute all phases without pausing. Gates still run after every phase and still block on failure.

```bash
# Default: pause and ask after each phase
specify workflow run viteplus-stitch --input spec="Create a billing module"

# Unattended: run every phase, stopping only when a quality gate fails
specify workflow run viteplus-stitch \
  --input spec="Create a billing module" \
  --input auto_continue=true
```

### Step 7: Completion

Once all phases are completed and all checkpoints pass, the feature is fully verified, architecturally clean, and ready to merge.

---

## Quality Gate Integrity (Guardrails)

The workflow instructs the model, before any other step, that **gate configuration is human-owned**. The bundle installs two layers of instruction:

1. A `guardrails` prompt step at the start of `workflow.yml`.
2. A `Quality Gate Integrity (NON-NEGOTIABLE)` section in `.specify/memory/constitution.md`, which `speckit.plan`, `speckit.tasks`, and `speckit.implement` read on every invocation. The full policy lives in `.specify/workflows/viteplus-stitch/GUARDRAILS.md`.

The rule forbids the agent from editing these files to make a check pass:

- `vite.config.ts` and any other Vite/Vite+ configuration (`vitest.config.ts`, `vite.config.*`)
- `package.json` quality scripts
- `.specify/scripts/bash/check-quality-gate.sh`, `check-env-config.sh`, `verify-stitch-design.sh`
- `.specify/extensions.yml` hooks
- test files, snapshots, fixtures, and coverage thresholds
- lint rules, complexity thresholds, architecture zones, and `@shadcn/lint` rules

It also forbids `eslint-disable`/`oxlint-disable`/`ts-ignore` suppressions, lowering thresholds, deleting or skipping assertions, and regenerating golden screenshots to match a broken UI. When a gate fails, the model must fix the application code. If a gate is genuinely wrong, it must stop and request explicit human approval before changing it.

The constitution section is idempotent: reinstalling the bundle never duplicates it, and an existing constitution is preserved.

---

## Quality Gate Details

### Environment variables

Application code must not read `process.env` or `import.meta.env` directly. Create the typed module from `templates/env.config.ts.tmpl` (typically at `src/config/env.ts`) and import values from it:

```ts
// src/config/env.ts -- the only module allowed to read env variables
export interface Env {
  readonly API_BASE_URL: string;
}

export const env: Env = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5173',
} satisfies Env;
```

```ts
// src/features/billing/charge.ts -- correct usage
import { env } from '../../config/env';

charge(env.API_BASE_URL);
```

Run the gate directly with:

```bash
.specify/scripts/bash/check-env-config.sh
# Custom config path:
.specify/scripts/bash/check-env-config.sh --env-config=src/shared/settings.ts
```

### Vertical slice layout

The layer rules are path-based and apply to every slice, not just `src/core`:

```text
src/
  core/                         # shared layers (optional)
  features/
    billing/
      domain/                   # cannot import application, infrastructure, ui
      application/              # cannot import infrastructure, ui
      infrastructure/           # cannot import ui
      ui/                       # cannot import infrastructure directly
    notifications/
      domain/
      application/
      infrastructure/
      ui/
```

### Strict Stitch token verification

`tokens.css` generated by Stitch is the design-token source of truth. The visual gate fails when:

- a UI feature has Stitch screenshots but no `tokens.css`;
- `tokens.css` declares no `--*` custom properties;
- any token declared in `tokens.css` is missing from the computed `:root` styles;
- any token value in the DOM differs from the value in `tokens.css`.

Validate the token file without launching Playwright:

```bash
.specify/scripts/bash/verify-stitch-design.sh --tokens-only --feature-dir=specs/001-feature
```

### Lifecycle Hooks Specialization & Mock Fixtures

- **Fast Task Loop (`after_task`)**: Runs `check-quality-gate.sh` and `verify-stitch-design.sh --tokens-only`. This ensures that tasks involving domain, application, or infrastructure code are never blocked waiting for Playwright or failing on nonexistent UI routes.
- **Full Visual Gate (`after_implement`)**: Runs the full visual Playwright audit comparing snapshots against Stitch golden masters.
- **Deterministic Rendering**: Playwright injects font stabilization CSS (`-webkit-font-smoothing: antialiased`, disabled animations/carets) to ensure cross-platform snapshot consistency between macOS and Linux/CI.
- **Mock Data Fixtures (`routes-manifest.json`)**: Dynamic or authenticated routes can declare local mock fixtures and target container selectors:
  ```json
  {
    "screens": [
      {
        "id": "screen-main-dashboard",
        "name": "Main Dashboard",
        "route": "/cards/card-demo-123",
        "selector": "main",
        "waitForSelector": "main",
        "fixtures": {
          "/api/v1/cards/card-demo-123": "./fixtures/card.json"
        }
      }
    ]
  }
  ```
  Playwright automatically intercepts matching network requests (`page.route`) and fulfills them with local fixture data for 100% deterministic, backend-independent visual audits.