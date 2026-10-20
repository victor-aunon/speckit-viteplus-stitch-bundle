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

TARGET_DIR="."

for arg in "$@"; do
  case "$arg" in
    --target-dir=*)
      TARGET_DIR="${arg#*=}"
      ;;
    --help)
      echo "Usage: install.sh [--target-dir=<path>]"
      exit 0
      ;;
    *)
      ;;
  esac
done

TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")"
SPECIFY_DIR="$TARGET_DIR/.specify"

# If local assets are missing (e.g. running via `curl ... | bash`), download from GitHub
if [ ! -f "$BUNDLE_ROOT/workflows/viteplus-stitch/workflow.yml" ]; then
  TEMP_DOWNLOAD_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'speckit-bundle')"
  trap 'rm -rf "$TEMP_DOWNLOAD_DIR"' EXIT
  echo "Downloading bundle assets from GitHub ($GITHUB_REPO)..."
  if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
    curl -fsSL "https://github.com/$GITHUB_REPO/archive/refs/heads/$REMOTE_BRANCH.tar.gz" | tar -xz -C "$TEMP_DOWNLOAD_DIR" --strip-components=1
    BUNDLE_ROOT="$TEMP_DOWNLOAD_DIR"
  else
    echo "❌ Error: 'curl' and 'tar' are required to download bundle assets remotely."
    exit 2
  fi
fi

echo "Installing viteplus-stitch bundle into: $TARGET_DIR..."

mkdir -p "$SPECIFY_DIR/workflows/viteplus-stitch"
mkdir -p "$SPECIFY_DIR/scripts/bash"
mkdir -p "$SPECIFY_DIR/templates"

# 1. Copy workflow definition
cp "$BUNDLE_ROOT/workflows/viteplus-stitch/workflow.yml" "$SPECIFY_DIR/workflows/viteplus-stitch/workflow.yml"

# 2. Copy scripts and ensure execution permissions
cp "$BUNDLE_ROOT/scripts/check-quality-gate.sh" "$SPECIFY_DIR/scripts/bash/check-quality-gate.sh"
cp "$BUNDLE_ROOT/scripts/verify-stitch-design.sh" "$SPECIFY_DIR/scripts/bash/verify-stitch-design.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/check-quality-gate.sh"
chmod +x "$SPECIFY_DIR/scripts/bash/verify-stitch-design.sh"

# 3. Copy templates
if [ -d "$BUNDLE_ROOT/templates" ]; then
  cp "$BUNDLE_ROOT/templates/"* "$SPECIFY_DIR/templates/" 2>/dev/null || true
fi

# 4. Configure hooks in .specify/extensions.yml idempotently
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
      description: "Runs vp check (Airbnb linter, Oxlint, types, complexity, and architecture layer boundaries)"
      command: ".specify/scripts/bash/check-quality-gate.sh"
      optional: false
    - name: "stitch-visual-gate"
      description: "Runs Playwright visual audit against Stitch screenshots when applicable"
      command: ".specify/scripts/bash/verify-stitch-design.sh"
      optional: false
  after_implement:
    - name: "final-quality-gate"
      description: "Comprehensive final verification of quality and architecture"
      command: ".specify/scripts/bash/check-quality-gate.sh"
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
      description: "Runs vp check (Airbnb linter, Oxlint, types, complexity, and architecture layer boundaries)"
      command: ".specify/scripts/bash/check-quality-gate.sh"
      optional: false
    - name: "stitch-visual-gate"
      description: "Runs Playwright visual audit against Stitch screenshots when applicable"
      command: ".specify/scripts/bash/verify-stitch-design.sh"
      optional: false
  after_implement:
    - name: "final-quality-gate"
      description: "Comprehensive final verification of quality and architecture"
      command: ".specify/scripts/bash/check-quality-gate.sh"
      optional: false
    - name: "final-visual-gate"
      description: "Comprehensive final visual audit against Stitch designs"
      command: ".specify/scripts/bash/verify-stitch-design.sh"
      optional: false
EOF
    fi
  fi
fi

# 5. Register in workflow-registry.json if present
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
        version: '1.0.0',
        description: 'Deterministic SDD workflow featuring Vite+, Google Stitch MCP, and architectural & visual quality gates',
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
