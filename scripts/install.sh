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

for arg in "$@"; do
  case "$arg" in
    --target-dir=*)
      TARGET_DIR="${arg#*=}"
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
chmod +x "$SPECIFY_DIR/scripts/bash/check-quality-gate.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-env-config.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/verify-stitch-design.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-blast-radius.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-contracts.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-ghost-classes.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-bundle-budget.sh"

# 3. Copy templates
if [ -d "$BUNDLE_ROOT/templates" ]; then
  cp "$BUNDLE_ROOT/templates/"* "$SPECIFY_DIR/templates/" 2>/dev/null || true
fi

# 4. Install the non-negotiable quality-gate guardrails
#    - A standalone copy the workflow prompt step tells the model to read.
#    - A constitution section, because speckit.plan/tasks/implement read
#      .specify/memory/constitution.md on every invocation.
if [ -f "$BUNDLE_ROOT/templates/guardrails.md" ]; then
  cp "$BUNDLE_ROOT/templates/guardrails.md" "$SPECIFY_DIR/workflows/viteplus-stitch/GUARDRAILS.md"
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
`verify-stitch-design.sh`), `.specify/extensions.yml`, test files/snapshots, or any
lint/type/complexity rule to make a failing gate or test pass.
When a gate fails, fix the application code. If a gate is genuinely wrong, stop and
ask the human for explicit approval before changing it. Gate configuration is
human-owned; silence or a passing run is not approval.

See `.specify/workflows/viteplus-stitch/GUARDRAILS.md` for the full policy.

### Impeccable UI Craft Lifecycle
<!-- viteplus-stitch:impeccable-lifecycle -->
When a feature contains frontend UI components (has_ui is true), the agent must follow the Impeccable lifecycle:
1. Conception (impeccable critique): critique visual hierarchy, tokens, and contrast before approving designs.
2. Robustness (impeccable harden): UI tasks must include loading skeletons, empty states, and error boundaries.
3. Polish (impeccable animate + audit): final phase must include micro-interactions (with prefers-reduced-motion) and accessibility audit.
EOF
elif ! grep -q "viteplus-stitch:quality-gate-integrity" "$CONSTITUTION_FILE"; then
  cat >> "$CONSTITUTION_FILE" << 'EOF'

## Quality Gate Integrity (NON-NEGOTIABLE)
<!-- viteplus-stitch:quality-gate-integrity -->
The agent MUST NOT modify Vite settings (`vite.config.ts` or any Vite/Vite+ config),
`package.json` quality scripts, the bundle quality gates
(`.specify/scripts/bash/check-quality-gate.sh`, `check-env-config.sh`,
`verify-stitch-design.sh`), `.specify/extensions.yml`, test files/snapshots, or any
lint/type/complexity rule to make a failing gate or test pass.
When a gate fails, fix the application code. If a gate is genuinely wrong, stop and
ask the human for explicit approval before changing it. Gate configuration is
human-owned; silence or a passing run is not approval.

See `.specify/workflows/viteplus-stitch/GUARDRAILS.md` for the full policy.

### Impeccable UI Craft Lifecycle
<!-- viteplus-stitch:impeccable-lifecycle -->
When a feature contains frontend UI components (has_ui is true), the agent must follow the Impeccable lifecycle:
1. Conception (impeccable critique): critique visual hierarchy, tokens, and contrast before approving designs.
2. Robustness (impeccable harden): UI tasks must include loading skeletons, empty states, and error boundaries.
3. Polish (impeccable animate + audit): final phase must include micro-interactions (with prefers-reduced-motion) and accessibility audit.
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
    - name: "viteplus-quality-gate"
      description: "Runs vp check (Airbnb linter, Oxlint, types, complexity, architecture layer boundaries, typed env config guard, and scoped regression tests without build)"
      command: ".specify/scripts/bash/check-quality-gate.sh --skip-build ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "stitch-tokens-gate"
      description: "Validates Stitch CSS design tokens without running full visual Playwright suite"
      command: ".specify/scripts/bash/verify-stitch-design.sh --tokens-only --skip-orphans ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
  after_implement:
    - name: "final-quality-gate"
      description: "Comprehensive final verification of quality, architecture, production build, and full test suite (scoped inside a feature slice when one is set)"
      command: ".specify/scripts/bash/check-quality-gate.sh ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "bundle-budget-gate"
      description: "Validates production build performance and bundle size limits"
      command: ".specify/scripts/bash/check-bundle-budget.sh"
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
    - name: "viteplus-quality-gate"
      description: "Runs vp check (Airbnb linter, Oxlint, types, complexity, architecture layer boundaries, typed env config guard, and scoped regression tests without build)"
      command: ".specify/scripts/bash/check-quality-gate.sh --skip-build ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "stitch-tokens-gate"
      description: "Validates Stitch CSS design tokens without running full visual Playwright suite"
      command: ".specify/scripts/bash/verify-stitch-design.sh --tokens-only --skip-orphans ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
  after_implement:
    - name: "final-quality-gate"
      description: "Comprehensive final verification of quality, architecture, production build, and full test suite (scoped inside a feature slice when one is set)"
      command: ".specify/scripts/bash/check-quality-gate.sh ${SPECIFY_SCOPE:+--scope=$SPECIFY_SCOPE}"
      optional: false
    - name: "bundle-budget-gate"
      description: "Validates production build performance and bundle size limits"
      command: ".specify/scripts/bash/check-bundle-budget.sh"
      optional: false
    - name: "final-visual-gate"
      description: "Comprehensive final visual audit against Stitch designs"
      command: ".specify/scripts/bash/verify-stitch-design.sh"
      optional: false
EOF
    fi
  fi
fi

# 6. Provision or augment root AGENTS.md for AI agent guidance (Gemini CLI, Claude Code, Cursor, Copilot)
AGENTS_FILE="$TARGET_DIR/AGENTS.md"
if [ ! -f "$AGENTS_FILE" ]; then
  if [ -f "$BUNDLE_ROOT/templates/AGENTS.md.tmpl" ]; then
    cp "$BUNDLE_ROOT/templates/AGENTS.md.tmpl" "$AGENTS_FILE"
  fi
elif ! grep -q "viteplus-stitch:agents-instructions" "$AGENTS_FILE"; then
  if [ -f "$BUNDLE_ROOT/templates/AGENTS.md.tmpl" ]; then
    echo "" >> "$AGENTS_FILE"
    cat "$BUNDLE_ROOT/templates/AGENTS.md.tmpl" >> "$AGENTS_FILE"
  fi
fi

# 7. Provision starter package.json if the project root does not have one
PACKAGE_FILE="$TARGET_DIR/package.json"
if [ ! -f "$PACKAGE_FILE" ]; then
  if [ -f "$BUNDLE_ROOT/templates/package.json.tmpl" ]; then
    cp "$BUNDLE_ROOT/templates/package.json.tmpl" "$PACKAGE_FILE"
    echo "✓ Initialized starter package.json with scripts and dependencies"
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

echo "✅ Installation of viteplus-stitch completed successfully in $TARGET_DIR"
exit 0
