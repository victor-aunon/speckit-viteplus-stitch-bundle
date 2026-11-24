# Quality Gate Integrity — Non-Negotiable

This workflow is defined by its gates. A green suite that was obtained by weakening a gate is a **failed** task, even if every check reports success.

## Never modify to make a check pass

The agent MUST NOT edit, weaken, disable, skip, or delete any of the following in order to make a quality gate, test, or build pass:

- `vite.config.ts` (or any Vite/Vite+ configuration file, e.g. `vitest.config.ts`, `vite.config.*`)
- `package.json` quality scripts (creating `package.json`, managing dependencies with npm, and adding scripts during project setup is required; only weakening or deleting quality scripts to bypass a failure is forbidden)
- `.specify/scripts/bash/check-quality-gate.sh`
- `.specify/scripts/bash/check-env-config.sh`
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
- **Machine Proofs in `specs/<feature>/evidence/`**: Verification requires machine-generated proof files (`quality-gate.json`, `bundle-budget.json`, `contracts.json`, and `stitch-design.json`). Self-reported success without machine proof is rejected.
- **No Silent Skips**: When UI is declared (`has_ui: true`), visual verification and route contracts are mandatory. Missing design folders or manifests fail the gate instead of skipping.
- **Auditability via Telemetry**: All gate executions log structured events to `.specify/telemetry.jsonl` to ensure complete observability of execution duration, gate statuses, and circuit breaker health.

## Real Execution & Mandatory Dependency Installation

A green task cannot be simulated:
- **Mandatory Dependencies (`node_modules`)**: The agent MUST install dependencies (`vp install` or `npm install`) via terminal whenever `package.json` is created or modified. Checking tasks without a functioning `node_modules/` directory is prohibited.
- **Sandbox Boundary Safety (`node_modules/`)**: NEVER use `read_file`, `list_directory`, or file-reading tools on `node_modules/`. In modern package managers (pnpm, npm, vite-plus), `node_modules` contains symlinks pointing outside the workspace sandbox, which triggers fatal environment errors. Manage and inspect packages exclusively via terminal commands (`npm ls`, `npm install`, `vp check`).
- **Terminal Execution Required**: The agent MUST execute `.specify/scripts/bash/check-quality-gate.sh` via terminal after completing each task in `tasks.md`. Marking a task checkbox `- [x]` without executing the gate in the terminal is a fatal violation of Quality Gate Integrity.
- **Imperative Pipeline Enforcement**: The Spec Kit workflow runs automated quality gates (`gate_quality`, `gate_bundle`, `gate_contracts`) as non-agent shell steps with an automated self-healing repair window.
