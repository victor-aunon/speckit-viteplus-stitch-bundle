# Profile-Tailored AGENTS.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide specialized, profile-tailored `AGENTS.md` instructions dynamically matching the project and feature domain (pure API service, React + Tailwind + Stitch, Vanilla Web, and Full-Stack framework), eliminating leaky UI/React abstractions in non-UI projects.

**Architecture:** Split the monolithic `AGENTS.md.tmpl` into profile-specific templates (`AGENTS.api.md.tmpl`, `AGENTS.react.md.tmpl`, `AGENTS.vanilla.md.tmpl`, `AGENTS.fullstack.md.tmpl`) alongside the backward-compatible `AGENTS.md.tmpl`. Update `install.sh` and `bootstrap-project-env.sh` with profile autodetection (and `--profile` flag support) and wire `workflow.yml` so non-UI runs enforce the API profile cleanly.

**Tech Stack:** Bash, Markdown, Vitest, Node.js.

**Spec:** User request: "Me gustaría que el agents.md también fuese distinto en función de la feature. Se está poniendo el mismo agents.md tanto a proyectos son react y shadcn, como a proyectos solo con api o proyectos que no usan stitch".

## Global Constraints

- Never weaken or alter deterministic quality gate scripts (`check-quality-gate.sh`, `check-blast-radius.sh`, etc.).
- Maintain 100% backward compatibility for projects expecting the default `templates/AGENTS.md.tmpl`.
- All generated `AGENTS.md` files must start with `<!-- viteplus-stitch:agents-instructions -->` for idempotent section detection in `install.sh`.
- Strictly enforce sandbox safety rules (`.git/`, `node_modules/`) and build configuration policy (`npm pkg set` for `package.json`) across all templates.

## Review Focus

- API profile must contain ZERO references to React, JSX, `@shadcn/lint`, Tailwind, or `ui/` directories.
- Vanilla profile must enforce CSS tokens and ghost-classes without assuming React or shadcn.
- `install.sh` with `--profile=api` must install `AGENTS.api.md.tmpl` as `AGENTS.md`.
- Autodetection in `install.sh` on `examples/1-api-service` must select `api`.
- Autodetection in `install.sh` on `examples/2-react-vite` must select `react`.

---

### Task 1: Create Profile-Specific AGENTS.md Templates

**Files:**
- Create: `templates/AGENTS.api.md.tmpl`
- Create: `templates/AGENTS.react.md.tmpl`
- Create: `templates/AGENTS.vanilla.md.tmpl`
- Create: `templates/AGENTS.fullstack.md.tmpl`
- Keep / Update: `templates/AGENTS.md.tmpl` (as universal / react default)

**Interfaces:**
- Produces: 4 specialized template files in `templates/` ready to be copied by `install.sh` and `bootstrap-project-env.sh`.

- [ ] **Step 1: Write `templates/AGENTS.api.md.tmpl`**
  Tailored exclusively for pure API and backend services:
  - Vertical slices: `domain/`, `application/`, `infrastructure/` (no `ui/`).
  - Strict absence of Tailwind, `@shadcn/lint`, Atomic Design, and React multi-component rules.
  - Runtime HTTP contract (`runtime.json`, `dev:api` script, `check-dev-entrypoint.sh --require-contract`).
  - Terminal-only package management (`npm pkg set`, `npm install`).
  - Quality commands: `check-quality-gate.sh`, `check-dev-entrypoint.sh`, `check-bundle-budget.sh`, `check-tasks-complete.sh`, `check-verification-verdict.sh` (omits UI and Stitch checks).

- [ ] **Step 2: Write `templates/AGENTS.react.md.tmpl`**
  Tailored for React + Tailwind + Stitch applications (the full UI stack).

- [ ] **Step 3: Write `templates/AGENTS.vanilla.md.tmpl`**
  Tailored for native web applications (HTML5, Vanilla CSS, DOM APIs, tokens.css, ghost-classes check, without React/shadcn).

- [ ] **Step 4: Write `templates/AGENTS.fullstack.md.tmpl`**
  Tailored for full-stack framework applications (Next.js, Nuxt, Astro with framework dev server and API routes).

- [ ] **Step 5: Verify all template files exist and are valid markdown**
  Run: `ls -la templates/AGENTS*.md.tmpl`
  Expected: All 5 files exist.

---

### Task 2: Implement Profile Detection and `--profile` Flag in `scripts/install.sh`

**Files:**
- Modify: `scripts/install.sh:30-70,405-425`
- Test: `tests/install-e2e.test.ts`

**Interfaces:**
- Consumes: `TARGET_DIR`, `--profile=<api|react|vanilla|fullstack>`, project structure and `package.json`.
- Produces: Profile-appropriate `AGENTS.md` materialized in `$TARGET_DIR`.

- [ ] **Step 1: Write failing test in `tests/install-e2e.test.ts` for `--profile=api`**
  Assert that installing with `--profile=api` installs an `AGENTS.md` containing `API & Backend Service` and does NOT contain `@shadcn/lint` or `React presentation components`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/install-e2e.test.ts -t "profile"`
  Expected: FAIL

- [ ] **Step 3: Implement `detect_project_profile` function and `--profile` argument parser in `scripts/install.sh`**
  Add detection logic:
  - Check framework configs -> `fullstack`.
  - Check `package.json` for `react`, `vue`, `svelte` -> `react`.
  - Check `package.json` name for `api`, `service`, `server` or backend dependencies -> `api`.
  - Check `index.html` without react -> `vanilla`.
  - Default -> `react`.
  Resolve template file: `templates/AGENTS.${PROFILE}.md.tmpl` falling back to `templates/AGENTS.md.tmpl`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/install-e2e.test.ts -t "profile"`
  Expected: PASS

---

### Task 3: Support Profile & Feature Awareness in `scripts/bootstrap-project-env.sh`

**Files:**
- Modify: `scripts/bootstrap-project-env.sh:30-80,140-190`
- Test: `tests/bootstrap-project-env.test.ts`

**Interfaces:**
- Consumes: `--profile=<profile>`, `--has-ui=<true|false>`.
- Produces: Consistent `AGENTS.md` if absent, or alignment during bootstrap.

- [ ] **Step 1: Write test in `tests/bootstrap-project-env.test.ts` verifying `--has-ui=false` or `--profile=api` bootstrap**
  Verify that when `AGENTS.md` is absent and `--has-ui=false` is provided, `AGENTS.api.md.tmpl` is selected.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/bootstrap-project-env.test.ts -t "profile"`
  Expected: FAIL

- [ ] **Step 3: Implement profile resolution in `scripts/bootstrap-project-env.sh`**
  Parse `--profile=*` and `--has-ui=*`. If `--has-ui=false`, profile defaults to `api` when unconfigured.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/bootstrap-project-env.test.ts -t "profile"`
  Expected: PASS

---

### Task 4: Connect Workflow `bootstrap_env` Steps with Feature UI Inputs

**Files:**
- Modify: `workflows/viteplus-stitch/workflow.yml:125-128,323-328`
- Test: `tests/workflow-schema.test.ts`, `tests/workflow-integrity.test.ts`

**Interfaces:**
- Consumes: `inputs.has_ui`.
- Produces: `--has-ui={{ inputs.has_ui }}` passed to `bootstrap-project-env.sh`.

- [ ] **Step 1: Update `workflow.yml` `bootstrap_env_early` and `bootstrap_env`**
  Pass `--has-ui={{ inputs.has_ui }}` to `bootstrap-project-env.sh`.

- [ ] **Step 2: Run workflow schema and integrity tests**
  Run: `npx vitest run tests/workflow-schema.test.ts tests/workflow-integrity.test.ts`
  Expected: PASS

---

### Task 5: Verify All 4 Example Archetypes and Comprehensive Test Suite

**Files:**
- Update: `examples/1-api-service/AGENTS.md` with the new API-specific profile.
- Test: Run full vitest suite.

- [ ] **Step 1: Install API profile into `examples/1-api-service/AGENTS.md`**
  Run: `bash scripts/install.sh --target-dir=examples/1-api-service --profile=api`
  Verify: `examples/1-api-service/AGENTS.md` contains NO React, Tailwind or shadcn references.

- [ ] **Step 2: Run full test suite**
  Run: `npx vitest run tests/install-e2e.test.ts tests/bootstrap-project-env.test.ts tests/workflow-schema.test.ts tests/workflow-integrity.test.ts`
  Expected: ALL PASS
