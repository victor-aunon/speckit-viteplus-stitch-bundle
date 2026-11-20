#!/usr/bin/env bash
# ==============================================================================
# build-release.sh
# ------------------------------------------------------------------------------
# Build the distributable release artifact from the shipped bundle files only.
#
# Why this exists: `specify bundle build` packs the whole source directory and
# only excludes `.git`, `__pycache__` and `.DS_Store`. Building straight from a
# working copy therefore ships node_modules/, tests/, editor settings and other
# local junk (a 17 MB artifact with 1261 dependency files instead of ~48 bundle
# files). This script stages exactly what the installer consumes, then packs the
# staged copy.
#
# Usage: bash scripts/build-release.sh
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"
BUNDLE_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || pwd)"

if ! command -v specify >/dev/null 2>&1; then
  echo "❌ Error: the Spec Kit CLI ('specify') is required to build the artifact."
  exit 2
fi

# Files and directories the installer actually consumes from the bundle.
SHIPPED_ENTRIES=(
  "bundle.yml"
  "README.md"
  "package.json"
  "workflows"
  "scripts"
  "templates"
  "extensions"
)

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/viteplus-stitch-release.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "======================================================================"
echo "[RELEASE] Staging shipped bundle files"
echo "======================================================================"

for entry in "${SHIPPED_ENTRIES[@]}"; do
  if [ ! -e "$BUNDLE_ROOT/$entry" ]; then
    echo "❌ Error: required bundle entry '$entry' is missing in $BUNDLE_ROOT"
    exit 1
  fi
  cp -R "$BUNDLE_ROOT/$entry" "$STAGE_DIR/"
  echo "✓ staged: $entry"
done

# Never ship the release tooling itself nor local artifacts.
rm -f "$STAGE_DIR/scripts/build-release.sh"
find "$STAGE_DIR" -name ".DS_Store" -delete 2>/dev/null || true

specify bundle build --path="$STAGE_DIR" >/dev/null

ARTIFACT="$(find "$STAGE_DIR" -maxdepth 1 -name '*.zip' -print -quit)"
if [ -z "$ARTIFACT" ] || [ ! -f "$ARTIFACT" ]; then
  echo "❌ Error: 'specify bundle build' did not produce an artifact."
  exit 1
fi

ARTIFACT_NAME="$(basename "$ARTIFACT")"
mv -f "$ARTIFACT" "$BUNDLE_ROOT/$ARTIFACT_NAME"

FILE_COUNT="$(unzip -Z1 "$BUNDLE_ROOT/$ARTIFACT_NAME" 2>/dev/null | grep -c '[^/]$' || echo 0)"
SIZE_KB=$(( $(wc -c < "$BUNDLE_ROOT/$ARTIFACT_NAME" | tr -d '[:space:]') / 1024 ))

echo ""
echo "✅ [RELEASE ARTIFACT]: $BUNDLE_ROOT/$ARTIFACT_NAME (${FILE_COUNT} files, ${SIZE_KB} KB)"
exit 0
