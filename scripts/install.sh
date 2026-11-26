#!/usr/bin/env bash
# ==============================================================================
# install.sh
# ------------------------------------------------------------------------------
# Idempotent installer for the viteplus-stitch bundle into any Spec Kit project.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"
BUNDLE_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || pwd)"

GITHUB_REPO="victor-aunon/speckit-viteplus-stitch-bundle"
REMOTE_BRANCH="main"

# Single source of truth for the release version: bundle.yml -> bundle.version
# (only the top-level `bundle:` key matches the two-space anchor).
resolve_bundle_version() {
  local manifest="$BUNDLE_ROOT/bundle.yml"
  [ -f "$manifest" ] || return 0
  sed -n -E 's/^  version:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n 1
}
BUNDLE_VERSION="$(resolve_bundle_version)"
RELEASE_TAG=""
ZIP_FILE=""
TARGET_DIR="."
PROFILE=""

for arg in "$@"; do
  case "$arg" in
    --target-dir=*)
      TARGET_DIR="${arg#*=}"
      ;;
    --profile=*)
      PROFILE="${arg#*=}"
      ;;
    --release=*|--version=*)
      RELEASE_TAG="${arg#*=}"
      ;;
    --zip=*)
      ZIP_FILE="${arg#*=}"
      ;;
    --help)
      echo "Usage: install.sh [options]"
      echo ""
      echo "Options:"
      echo "  --target-dir=<path>    Target directory of the project (default: current directory)"
      echo "  --profile=<profile>    Project profile: api, react, vanilla, or fullstack (default: auto-detected)"
      echo "  --release=<tag>        Install from a specific GitHub Release tag (e.g. v1.0.0)"
      echo "  --zip=<path>           Install from a locally downloaded release .zip file"
      echo "  --help                 Show this help message"
      exit 0
      ;;
    *)
      ;;
  esac
done

TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")"
SPECIFY_DIR="$TARGET_DIR/.specify"

# 1. If a local zip file was supplied, unpack and use as bundle root
if [ -n "$ZIP_FILE" ]; then
  if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Error: Zip file '$ZIP_FILE' does not exist."
    exit 1
  fi
  TEMP_UNPACK_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'speckit-bundle-zip')"
  trap 'rm -rf "$TEMP_UNPACK_DIR"' EXIT
  echo "Unpacking release archive from: $ZIP_FILE..."
  unzip -q -o "$ZIP_FILE" -d "$TEMP_UNPACK_DIR"
  BUNDLE_ROOT="$TEMP_UNPACK_DIR"
# 2. If local assets are missing (e.g. running via `curl ... | bash`), download from GitHub
elif [ ! -f "$BUNDLE_ROOT/workflows/viteplus-stitch/workflow.yml" ]; then
  TEMP_DOWNLOAD_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'speckit-bundle')"
  trap 'rm -rf "$TEMP_DOWNLOAD_DIR"' EXIT

  DOWNLOAD_URL="https://github.com/$GITHUB_REPO/archive/refs/heads/$REMOTE_BRANCH.tar.gz"
  REF_LABEL="branch: $REMOTE_BRANCH"
  if [ -n "$RELEASE_TAG" ]; then
    DOWNLOAD_URL="https://github.com/$GITHUB_REPO/archive/refs/tags/$RELEASE_TAG.tar.gz"
    REF_LABEL="release: $RELEASE_TAG"
  fi

  echo "Downloading bundle assets from GitHub ($GITHUB_REPO @ $REF_LABEL)..."
  if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
    curl -fsSL "$DOWNLOAD_URL" | tar -xz -C "$TEMP_DOWNLOAD_DIR" --strip-components=1
    BUNDLE_ROOT="$TEMP_DOWNLOAD_DIR"
  else
    echo "❌ Error: 'curl' and 'tar' are required to download bundle assets remotely."
    exit 2
  fi
fi

if [ -n "$BUNDLE_VERSION" ]; then
  echo "Installing viteplus-stitch bundle v$BUNDLE_VERSION into: $TARGET_DIR..."
else
  echo "Installing viteplus-stitch bundle into: $TARGET_DIR..."
  echo "⚠️  Could not resolve bundle.version from $BUNDLE_ROOT/bundle.yml"
fi

mkdir -p "$SPECIFY_DIR/workflows/viteplus-stitch"
mkdir -p "$SPECIFY_DIR/scripts/bash"
mkdir -p "$SPECIFY_DIR/templates"

# 1. Copy workflow definition
cp "$BUNDLE_ROOT/workflows/viteplus-stitch/workflow.yml" "$SPECIFY_DIR/workflows/viteplus-stitch/workflow.yml"

# 2. Copy scripts and ensure execution permissions
cp "$BUNDLE_ROOT/scripts/check-quality-gate.sh" "$SPECIFY_DIR/scripts/bash/check-quality-gate.sh"
cp "$BUNDLE_ROOT/scripts/check-env-config.sh" "$SPECIFY_DIR/scripts/bash/check-env-config.sh"
cp "$BUNDLE_ROOT/scripts/verify-stitch-design.sh" "$SPECIFY_DIR/scripts/bash/verify-stitch-design.sh"
cp "$BUNDLE_ROOT/scripts/check-blast-radius.sh" "$SPECIFY_DIR/scripts/bash/check-blast-radius.sh"
cp "$BUNDLE_ROOT/scripts/check-contracts.sh" "$SPECIFY_DIR/scripts/bash/check-contracts.sh"
cp "$BUNDLE_ROOT/scripts/check-ghost-classes.sh" "$SPECIFY_DIR/scripts/bash/check-ghost-classes.sh"
cp "$BUNDLE_ROOT/scripts/check-bundle-budget.sh" "$SPECIFY_DIR/scripts/bash/check-bundle-budget.sh"
cp "$BUNDLE_ROOT/scripts/emit-telemetry.sh" "$SPECIFY_DIR/scripts/bash/emit-telemetry.sh"
cp "$BUNDLE_ROOT/scripts/check-tasks-complete.sh" "$SPECIFY_DIR/scripts/bash/check-tasks-complete.sh"
cp "$BUNDLE_ROOT/scripts/check-verification-verdict.sh" "$SPECIFY_DIR/scripts/bash/check-verification-verdict.sh"
cp "$BUNDLE_ROOT/scripts/bootstrap-project-env.sh" "$SPECIFY_DIR/scripts/bash/bootstrap-project-env.sh"
cp "$BUNDLE_ROOT/scripts/check-design-artifacts.sh" "$SPECIFY_DIR/scripts/bash/check-design-artifacts.sh"
cp "$BUNDLE_ROOT/scripts/check-dev-entrypoint.sh" "$SPECIFY_DIR/scripts/bash/check-dev-entrypoint.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-quality-gate.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-env-config.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/verify-stitch-design.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-blast-radius.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-contracts.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-ghost-classes.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-bundle-budget.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/emit-telemetry.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-tasks-complete.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-verification-verdict.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/bootstrap-project-env.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-design-artifacts.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-dev-entrypoint.sh"

# 3. Copy templates
if [ -d "$BUNDLE_ROOT/templates" ]; then
  cp "$BUNDLE_ROOT/templates/"* "$SPECIFY_DIR/templates/" 2>/dev/null || true
fi

# The Playwright/design-audit templates ship with a *.tmpl suffix but are consumed
# without it (verify-stitch-design.sh resolves the un-suffixed path).
for tmpl in "playwright.design.config.ts" "design-audit.spec.ts"; do
  if [ -f "$SPECIFY_DIR/templates/${tmpl}.tmpl" ] && [ ! -f "$SPECIFY_DIR/templates/${tmpl}" ]; then
    cp "$SPECIFY_DIR/templates/${tmpl}.tmpl" "$SPECIFY_DIR/templates/${tmpl}"
  fi
done

# 4. Install the non-negotiable quality-gate guardrails
#    - A standalone copy the workflow prompt step tells the model to read.
#    - A constitution section, because speckit.plan/tasks/implement read
#      .specify/memory/constitution.md on every invocation.
if [ -f "$BUNDLE_ROOT/templates/guardrails.md" ]; then
  cp "$BUNDLE_ROOT/templates/guardrails.md" "$SPECIFY_DIR/workflows/viteplus-stitch/GUARDRAILS.md"
fi
if [ -f "$BUNDLE_ROOT/templates/auditor.md" ]; then
  cp "$BUNDLE_ROOT/templates/auditor.md" "$SPECIFY_DIR/workflows/viteplus-stitch/AUDITOR.md"
fi

MEMORY_DIR="$SPECIFY_DIR/memory"
CONSTITUTION_FILE="$MEMORY_DIR/constitution.md"
mkdir -p "$MEMORY_DIR"

if [ ! -f "$CONSTITUTION_FILE" ]; then
  cat > "$CONSTITUTION_FILE" << 'EOF'
# Project Constitution

## Core Principles

### Quality Gate Integrity (NON-NEGOTIABLE)
<!-- viteplus-stitch:quality-gate-integrity -->
The agent MUST NOT modify Vite settings (`vite.config.ts` or any Vite/Vite+ config),
`package.json` quality scripts, the bundle quality gates
(`.specify/scripts/bash/check-quality-gate.sh`, `check-env-config.sh`,
`verify-stitch-design.sh`, `check-contracts.sh`, `check-tasks-complete.sh`,
`check-verification-verdict.sh`), `.specify/extensions.yml`, test files/snapshots, or any
lint/type/complexity rule to make a failing gate or test pass.
When a gate fails, fix the application code. If a gate is genuinely wrong, stop and
ask the human for explicit approval before changing it. Gate configuration is
human-owned; silence or a passing run is not approval.

See `.specify/workflows/viteplus-stitch/GUARDRAILS.md` for the full policy.

### Evidence Integrity (NON-NEGOTIABLE)
<!-- viteplus-stitch:evidence-integrity -->
A green signal is not proof. The agent MUST NOT:
- Claim completion while `tasks.md` has unchecked tasks (`check-tasks-complete.sh`).
- Report a feature as verified unless `specs/<feature>/evidence/verification.json`
  contains `{"verdict":"pass"}` (`check-verification-verdict.sh`).
- Treat a suite that executed zero tests, or `verify-stitch-design.sh --tokens-only`,
  as verification. Structural checks are not visual or behavioral proof.
- Pass `--allow-no-tests`, `--allow-incomplete`, `--allow-missing`,
  `--allow-foreign-git`, or `--tokens-only` without explicit human approval.
- Hand-edit evidence artifacts. Evidence is append-only (`<gate>.history.jsonl`).
The project root MUST own its git repository (`git init`); inheriting an ancestor
repository makes anti-tampering and blast radius audit the wrong tree.

### Impeccable UI Craft Lifecycle
<!-- viteplus-stitch:impeccable-lifecycle -->
When a feature contains frontend UI components (has_ui is true), the agent must follow the Impeccable lifecycle:
1. Conception (impeccable critique): critique visual hierarchy, tokens, and contrast before approving designs.
2. Robustness (impeccable harden): UI tasks must include loading skeletons, empty states, and error boundaries.
3. Polish (impeccable animate + audit): final phase must include micro-interactions (with prefers-reduced-motion) and accessibility audit.

### Real Execution & Mandatory Dependencies
<!-- viteplus-stitch:real-execution-mandate -->
The agent MUST install dependencies (`vp install` or `npm install`) via terminal whenever `package.json` is created or modified. Checking tasks without a functioning `node_modules/` directory is prohibited.
NEVER use `read_file`, `list_directory`, or file tools on `node_modules/` (symlinks trigger fatal sandbox errors). Diagnose packages exclusively via terminal: `npm ls`, `npm install`, or `vp check`.
The agent MUST execute `.specify/scripts/bash/check-quality-gate.sh` via terminal after completing each task in `tasks.md`. Spec Kit executes automated quality gates as non-agent shell steps with an automated self-healing repair window.

### Subagent-Driven Execution Architecture
<!-- viteplus-stitch:subagent-execution -->
To prevent cognitive drift, memory saturation, and timeouts on large feature sets:
1. Dispatch each task in `tasks.md` to an isolated, ephemeral worker subagent (e.g. `@generalist`).
2. Provide only the task scope and target file paths; do not forward bloated session history.
3. Require the worker subagent to run `check-quality-gate.sh` and return only a 3-line status before disposing of its context.
EOF
elif ! grep -q "viteplus-stitch:quality-gate-integrity" "$CONSTITUTION_FILE"; then
  cat >> "$CONSTITUTION_FILE" << 'EOF'

## Quality Gate Integrity (NON-NEGOTIABLE)
<!-- viteplus-stitch:quality-gate-integrity -->
The agent MUST NOT modify Vite settings (`vite.config.ts` or any Vite/Vite+ config),
`package.json` quality scripts, the bundle quality gates
(`.specify/scripts/bash/check-quality-gate.sh`, `check-env-config.sh`,
`verify-stitch-design.sh`, `check-contracts.sh`, `check-tasks-complete.sh`,
`check-verification-verdict.sh`), `.specify/extensions.yml`, test files/snapshots, or any
lint/type/complexity rule to make a failing gate or test pass.
When a gate fails, fix the application code. If a gate is genuinely wrong, stop and
ask the human for explicit approval before changing it. Gate configuration is
human-owned; silence or a passing run is not approval.

See `.specify/workflows/viteplus-stitch/GUARDRAILS.md` for the full policy.

### Evidence Integrity (NON-NEGOTIABLE)
<!-- viteplus-stitch:evidence-integrity -->
A green signal is not proof. The agent MUST NOT:
- Claim completion while `tasks.md` has unchecked tasks (`check-tasks-complete.sh`).
- Report a feature as verified unless `specs/<feature>/evidence/verification.json`
  contains `{"verdict":"pass"}` (`check-verification-verdict.sh`).
- Treat a suite that executed zero tests, or `verify-stitch-design.sh --tokens-only`,
  as verification. Structural checks are not visual or behavioral proof.
- Pass `--allow-no-tests`, `--allow-incomplete`, `--allow-missing`,
  `--allow-foreign-git`, or `--tokens-only` without explicit human approval.
- Hand-edit evidence artifacts. Evidence is append-only (`<gate>.history.jsonl`).
The project root MUST own its git repository (`git init`); inheriting an ancestor
repository makes anti-tampering and blast radius audit the wrong tree.

### Impeccable UI Craft Lifecycle
<!-- viteplus-stitch:impeccable-lifecycle -->
When a feature contains frontend UI components (has_ui is true), the agent must follow the Impeccable lifecycle:
1. Conception (impeccable critique): critique visual hierarchy, tokens, and contrast before approving designs.
2. Robustness (impeccable harden): UI tasks must include loading skeletons, empty states, and error boundaries.
3. Polish (impeccable animate + audit): final phase must include micro-interactions (with prefers-reduced-motion) and accessibility audit.

### Real Execution & Mandatory Dependencies
<!-- viteplus-stitch:real-execution-mandate -->
The agent MUST install dependencies (`vp install` or `npm install`) via terminal whenever `package.json` is created or modified. Checking tasks without a functioning `node_modules/` directory is prohibited.
NEVER use `read_file`, `list_directory`, or file tools on `node_modules/` (symlinks trigger fatal sandbox errors). Diagnose packages exclusively via terminal: `npm ls`, `npm install`, or `vp check`.
The agent MUST execute `.specify/scripts/bash/check-quality-gate.sh` via terminal after completing each task in `tasks.md`. Spec Kit executes automated quality gates as non-agent shell steps with an automated self-healing repair window.

### Subagent-Driven Execution Architecture
<!-- viteplus-stitch:subagent-execution -->
To prevent cognitive drift, memory saturation, and timeouts on large feature sets:
1. Dispatch each task in `tasks.md` to an isolated, ephemeral worker subagent (e.g. `@generalist`).
2. Provide only the task scope and target file paths; do not forward bloated session history.
3. Require the worker subagent to run `check-quality-gate.sh` and return only a 3-line status before disposing of its context.
EOF
fi

# 5. Configure hooks in .specify/extensions.yml idempotently
EXTENSIONS_FILE="$SPECIFY_DIR/extensions.yml"

if [ ! -f "$EXTENSIONS_FILE" ]; then
  cp "$BUNDLE_ROOT/extensions/extensions.yml" "$EXTENSIONS_FILE"
else
  # If file already exists, check if hooks are already present to avoid duplication
  if ! grep -q "check-quality-gate.sh" "$EXTENSIONS_FILE"; then
    if grep -q "^hooks:" "$EXTENSIONS_FILE"; then
      cat >> "$EXTENSIONS_FILE" << 'EOF'
  after_task:
    - name: "project-bootstrap"
      description: "Idempotent git init + baseline commit and Playwright/design-audit template materialization"
      command: ".specify/scripts/bash/bootstrap-project-env.sh"
      optional: false
    - name: "viteplus-quality-gate"
      description: "Runs vp check (Airbnb linter, Oxlint, types, complexity, architecture layer boundaries, typed env config guard, and scoped regression tests without build)"
      command: ".specify/scripts/bash/check-quality-gate.sh --skip-build ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "stitch-tokens-gate"
      description: "Validates Stitch CSS design tokens without running full visual Playwright suite"
      command: ".specify/scripts/bash/verify-stitch-design.sh --tokens-only --skip-orphans ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
  after_implement:
    - name: "project-bootstrap"
      description: "Idempotent git init + baseline commit and Playwright/design-audit template materialization"
      command: ".specify/scripts/bash/bootstrap-project-env.sh"
      optional: false
    - name: "final-quality-gate"
      description: "Comprehensive final verification of quality, architecture, production build, and full test suite (scoped inside a feature slice when one is set)"
      command: ".specify/scripts/bash/check-quality-gate.sh ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "bundle-budget-gate"
      description: "Validates production build performance and bundle size limits"
      command: ".specify/scripts/bash/check-bundle-budget.sh"
      optional: false
    - name: "tasks-completion-gate"
      description: "Fails when tasks.md still contains unchecked tasks, so a scaffold cannot be reported as complete"
      command: ".specify/scripts/bash/check-tasks-complete.sh"
      optional: false
    - name: "final-visual-gate"
      description: "Comprehensive final visual audit against Stitch designs"
      command: ".specify/scripts/bash/verify-stitch-design.sh"
      optional: false
EOF
    else
      cat >> "$EXTENSIONS_FILE" << 'EOF'

hooks:
  after_task:
    - name: "project-bootstrap"
      description: "Idempotent git init + baseline commit and Playwright/design-audit template materialization"
      command: ".specify/scripts/bash/bootstrap-project-env.sh"
      optional: false
    - name: "viteplus-quality-gate"
      description: "Runs vp check (Airbnb linter, Oxlint, types, complexity, architecture layer boundaries, typed env config guard, and scoped regression tests without build)"
      command: ".specify/scripts/bash/check-quality-gate.sh --skip-build ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "stitch-tokens-gate"
      description: "Validates Stitch CSS design tokens without running full visual Playwright suite"
      command: ".specify/scripts/bash/verify-stitch-design.sh --tokens-only --skip-orphans ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
  after_implement:
    - name: "project-bootstrap"
      description: "Idempotent git init + baseline commit and Playwright/design-audit template materialization"
      command: ".specify/scripts/bash/bootstrap-project-env.sh"
      optional: false
    - name: "final-quality-gate"
      description: "Comprehensive final verification of quality, architecture, production build, and full test suite (scoped inside a feature slice when one is set)"
      command: ".specify/scripts/bash/check-quality-gate.sh ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "bundle-budget-gate"
      description: "Validates production build performance and bundle size limits"
      command: ".specify/scripts/bash/check-bundle-budget.sh"
      optional: false
    - name: "tasks-completion-gate"
      description: "Fails when tasks.md still contains unchecked tasks, so a scaffold cannot be reported as complete"
      command: ".specify/scripts/bash/check-tasks-complete.sh"
      optional: false
    - name: "final-visual-gate"
      description: "Comprehensive final visual audit against Stitch designs"
      command: ".specify/scripts/bash/verify-stitch-design.sh"
      optional: false
EOF
    fi
  fi
fi

# 5b. Upgrade hooks in an already-installed extensions.yml.
#     The block above only fires when no gate hook exists, so existing projects
#     would silently miss newly added hooks (e.g. project-bootstrap). Insert each
#     missing hook under its existing section instead of appending a duplicate
#     YAML key.
insert_hook_after() {
  local section="$1"
  local hook_name="$2"
  local body="$3"
  local hook_file target_file
  hook_file="$(mktemp "${TMPDIR:-/tmp}/speckit-hook-XXXXXX" 2>/dev/null || printf '%s/speckit-hook-%s' "${TMPDIR:-/tmp}" "$$")"
  printf '%s\n' "$body" > "$hook_file"
  target_file="$(mktemp "${TMPDIR:-/tmp}/speckit-ext-XXXXXX" 2>/dev/null || printf '%s/speckit-ext-%s' "${TMPDIR:-/tmp}" "$$")"
  if awk -v section="$section:" -v hookfile="$hook_file" '
    { print }
    $0 == "  " section && !done {
      while ((getline line < hookfile) > 0) print line
      close(hookfile)
      done = 1
    }
  ' "$EXTENSIONS_FILE" > "$target_file" 2>/dev/null; then
    if [ -s "$target_file" ] && grep -q "name: \"$hook_name\"" "$target_file"; then
      mv "$target_file" "$EXTENSIONS_FILE"
      echo "✓ Added $hook_name hook to $EXTENSIONS_FILE"
    else
      rm -f "$target_file"
    fi
  else
    rm -f "$target_file"
  fi
  rm -f "$hook_file"
}

if [ -f "$EXTENSIONS_FILE" ]; then
  BOOTSTRAP_HOOK='    - name: "project-bootstrap"
      description: "Idempotent git init + baseline commit and Playwright/design-audit template materialization"
      command: ".specify/scripts/bash/bootstrap-project-env.sh"
      optional: false'
  TASKS_HOOK='    - name: "tasks-completion-gate"
      description: "Fails when tasks.md still contains unchecked tasks, so a scaffold cannot be reported as complete"
      command: ".specify/scripts/bash/check-tasks-complete.sh"
      optional: false'

  if ! grep -q "project-bootstrap" "$EXTENSIONS_FILE"; then
    insert_hook_after "after_task" "project-bootstrap" "$BOOTSTRAP_HOOK"
    insert_hook_after "after_implement" "project-bootstrap" "$BOOTSTRAP_HOOK"
  fi
  if ! grep -q "tasks-completion-gate" "$EXTENSIONS_FILE"; then
    insert_hook_after "after_implement" "tasks-completion-gate" "$TASKS_HOOK"
  fi
fi

detect_project_profile() {
  local target="$1"
  local pkg_file="$target/package.json"

  # 1. Framework configs (Next, Nuxt, Astro, Remix, SvelteKit) -> fullstack
  for candidate in "next.config.*" "nuxt.config.*" "astro.config.*" "remix.config.*" "svelte.config.*"; do
    if compgen -G "$target/$candidate" >/dev/null 2>&1; then
      echo "fullstack"
      return 0
    fi
  done

  # 2. Inspect package.json if present
  if [ -f "$pkg_file" ]; then
    # React / Vue / Svelte UI libraries
    if grep -qE '"(react|@vitejs/plugin-react|vue|svelte)"' "$pkg_file" 2>/dev/null; then
      echo "react"
      return 0
    fi
    # Explicit API / Service / Backend in name or backend dependencies
    if grep -qE '"name":[[:space:]]*"[^"]*(api|service|server|backend)' "$pkg_file" 2>/dev/null || \
       grep -qE '"(express|fastify|hono|koa|jsonwebtoken|cors)"' "$pkg_file" 2>/dev/null; then
      echo "api"
      return 0
    fi
  fi

  # 3. Source structure check
  if [ -d "$target/src/features" ] && [ ! -d "$target/src/components" ] && [ ! -f "$target/index.html" ]; then
    echo "api"
    return 0
  fi

  if [ -f "$target/index.html" ]; then
    echo "vanilla"
    return 0
  fi

  # Default fallback profile
  echo "react"
}

# 6. Provision or augment root AGENTS.md for AI agent guidance (Gemini CLI, Claude Code, Cursor, Copilot)
AGENTS_FILE="$TARGET_DIR/AGENTS.md"
TARGET_PROFILE="${PROFILE:-$(detect_project_profile "$TARGET_DIR")}"
RESOLVED_AGENTS_TMPL="$BUNDLE_ROOT/templates/AGENTS.${TARGET_PROFILE}.md.tmpl"
if [ ! -f "$RESOLVED_AGENTS_TMPL" ]; then
  RESOLVED_AGENTS_TMPL="$BUNDLE_ROOT/templates/AGENTS.md.tmpl"
fi

if [ ! -f "$AGENTS_FILE" ]; then
  if [ -f "$RESOLVED_AGENTS_TMPL" ]; then
    cp "$RESOLVED_AGENTS_TMPL" "$AGENTS_FILE"
    echo "✓ Initialized AGENTS.md with $TARGET_PROFILE profile"
  fi
elif ! grep -q "viteplus-stitch:agents-instructions" "$AGENTS_FILE"; then
  if [ -f "$RESOLVED_AGENTS_TMPL" ]; then
    echo "" >> "$AGENTS_FILE"
    cat "$RESOLVED_AGENTS_TMPL" >> "$AGENTS_FILE"
    echo "✓ Appended $TARGET_PROFILE profile instructions to existing AGENTS.md"
  fi
fi

# 7. Provision starter package.json if the project root does not have one
PACKAGE_FILE="$TARGET_DIR/package.json"
if [ ! -f "$PACKAGE_FILE" ]; then
  if [ -f "$BUNDLE_ROOT/templates/package.json.tmpl" ]; then
    cp "$BUNDLE_ROOT/templates/package.json.tmpl" "$PACKAGE_FILE"
    echo "✓ Initialized starter package.json with scripts and dependencies"
  fi
elif command -v node >/dev/null 2>&1; then
  NODE_PKG_SCRIPT='
    const fs = require("fs");
    const file = process.argv[1];
    const profile = process.argv[2] || "";
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      pkg.scripts = pkg.scripts || {};
      let changed = false;

      if (!pkg.scripts.dev) {
        if (profile === "api") {
          pkg.scripts["dev:api"] = pkg.scripts["dev:api"] || "tsx watch src/main.ts";
          pkg.scripts.dev = "vp run dev:api || npm run dev:api";
        } else {
          pkg.scripts.dev = "vp dev";
        }
        changed = true;
      }

      if (!pkg.scripts.build) {
        pkg.scripts.build = "vp build";
        changed = true;
      }

      if (!pkg.scripts.test) {
        pkg.scripts.test = "vp test";
        changed = true;
      }

      if (!pkg.scripts["check-quality"]) {
        pkg.scripts["check-quality"] = "bash .specify/scripts/bash/check-quality-gate.sh";
        changed = true;
      }

      if (profile !== "api" && !pkg.scripts["verify-design"]) {
        pkg.scripts["verify-design"] = "bash .specify/scripts/bash/verify-stitch-design.sh";
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        process.stdout.write("updated");
      }
    } catch (e) {}
  '
  PKG_UPDATED="$(node -e "$NODE_PKG_SCRIPT" "$PACKAGE_FILE" "$TARGET_PROFILE" 2>/dev/null || true)"
  if [ "$PKG_UPDATED" = "updated" ]; then
    echo "✓ Ensured baseline scripts (dev, build, test) in existing package.json"
  fi
fi

# 7b. Provision the Vite+ config when absent.
#     `vite.config.ts` is Vite+'s config container (lint/fmt/check/test/run), not a
#     marker of "this app is bundled by Vite". In a Vite UI project it also carries
#     the React plugin (Fast Refresh); in a full-stack framework (Next, Nuxt, Astro,
#     Remix, SvelteKit) the bundler is the framework's own, so injecting
#     `@vitejs/plugin-react` + `@shadcn/lint` would be wrong and would fail to
#     resolve in a dependency tree that does not ship them.
#
#     Detection is deliberately file-based: the framework config is the fact, not
#     a dependency guess.
FRAMEWORK="vite"
for candidate in "next:next.config" "nuxt:nuxt.config" "astro:astro.config" "remix:remix.config" "sveltekit:svelte.config"; do
  FRAMEWORK_NAME="${candidate%%:*}"
  FRAMEWORK_GLOB="${candidate##*:}"
  if compgen -G "$TARGET_DIR/$FRAMEWORK_GLOB.*" >/dev/null 2>&1; then
    FRAMEWORK="$FRAMEWORK_NAME"
    break
  fi
done

VITE_CONFIG_FILE="$TARGET_DIR/vite.config.ts"
if [ ! -f "$VITE_CONFIG_FILE" ]; then
  if { [ "$FRAMEWORK" != "vite" ] || [ "$TARGET_PROFILE" = "api" ]; } && [ -f "$BUNDLE_ROOT/templates/vite.config.agnostic.ts.tmpl" ]; then
    cp "$BUNDLE_ROOT/templates/vite.config.agnostic.ts.tmpl" "$VITE_CONFIG_FILE"
    echo "✓ Detected $FRAMEWORK ($TARGET_PROFILE profile): initialized vite.config.ts (Vite+ lint/fmt/boundaries only, no Vite bundler plugins)"
    echo "  Next step: add \`vite-plus\` (or use the global \`vp\` CLI) so \`vp check\` runs here."
  elif [ -f "$BUNDLE_ROOT/templates/vite.config.ts.tmpl" ]; then
    cp "$BUNDLE_ROOT/templates/vite.config.ts.tmpl" "$VITE_CONFIG_FILE"
    echo "✓ Initialized vite.config.ts (React plugin + Vite+ lint rules)"
  fi
fi

# 8. Provision .npmrc with legacy-peer-deps=true for Vite+ peer dependency resolution
NPMRC_FILE="$TARGET_DIR/.npmrc"
if [ ! -f "$NPMRC_FILE" ]; then
  if [ -f "$BUNDLE_ROOT/templates/.npmrc.tmpl" ]; then
    cp "$BUNDLE_ROOT/templates/.npmrc.tmpl" "$NPMRC_FILE"
  else
    echo "legacy-peer-deps=true" > "$NPMRC_FILE"
  fi
  echo "✓ Initialized .npmrc (legacy-peer-deps=true) for Vite+ compatibility"
elif ! grep -q "legacy-peer-deps" "$NPMRC_FILE"; then
  echo "legacy-peer-deps=true" >> "$NPMRC_FILE"
  echo "✓ Added legacy-peer-deps=true to existing .npmrc"
fi

# 9. Register in workflow-registry.json if present
REGISTRY_FILE="$SPECIFY_DIR/workflows/workflow-registry.json"
if [ -f "$REGISTRY_FILE" ]; then
  TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u)"
  node -e "
    const fs = require('fs');
    try {
      const reg = JSON.parse(fs.readFileSync('$REGISTRY_FILE', 'utf8'));
      reg.workflows = reg.workflows || {};
      reg.workflows['viteplus-stitch'] = {
        name: 'Vite+ Stitch SDD Lifecycle',
        version: '$BUNDLE_VERSION',
        description: 'Deterministic SDD workflow featuring Vite+, Google Stitch MCP, phase checkpoints, and architectural, env-config & visual quality gates',
        source: 'local-bundle',
        installed_at: '$TIMESTAMP',
        updated_at: '$TIMESTAMP'
      };
      fs.writeFileSync('$REGISTRY_FILE', JSON.stringify(reg, null, 2));
    } catch (e) {}
  " 2>/dev/null || true
fi

# 10. Git ownership pre-flight. Anti-tampering and blast radius audit the project's
# own repository; nested projects without .git would audit an ancestor repo instead.
if command -v git >/dev/null 2>&1; then
  if ! git -C "$TARGET_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
    echo "⚠️  No git repository detected in $TARGET_DIR."
    echo "   Run 'git init && git add -A && git commit -m \"chore: baseline\"' before the workflow."
    echo "   Anti-tampering and blast radius gates fail (or go blind) without it."
  fi
fi

echo "✅ Installation of viteplus-stitch completed successfully in $TARGET_DIR"
exit 0
