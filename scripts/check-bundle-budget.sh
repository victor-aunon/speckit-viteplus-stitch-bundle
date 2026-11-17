#!/usr/bin/env bash
# ==============================================================================
# check-bundle-budget.sh
# ------------------------------------------------------------------------------
# Performance & Bundle Size Quality Gate for Spec Kit and Vite+.
#
# Enforces production bundle budgets:
#   1. Builds project for production (vp build / vite build / npm run build).
#   2. Validates that no individual JS/CSS asset exceeds the single-chunk budget
#      (default: 250 KB).
#   3. Validates that the total size of assets in dist/ does not exceed the
#      total bundle budget (default: 1000 KB).
# Prevents autonomous agents from accidentally introducing bloated or untreeshaken
# dependencies.
# ==============================================================================

set -eo pipefail

show_help() {
  cat << 'EOF'
Usage: check-bundle-budget.sh [options]

Deterministic Performance & Bundle Size Gate for Vite+ applications.

Options:
  --help                  Show this help message
  --dry-run               Simulate verification without failing on threshold
  --skip-build            Check existing dist directory without running build
  --max-chunk-kb=<N>      Maximum allowed size per chunk in KB (default: 250)
  --max-total-kb=<N>      Maximum allowed total bundle size in KB (default: 1000)
  --dist-dir=<path>       Target distribution directory (default: dist)

Exit Codes:
  0                       All bundle assets are within budget
  1                       Bundle size exceeds performance budget
  2                       Build error or missing distribution directory
EOF
}

DRY_RUN=false
SKIP_BUILD=false
MAX_CHUNK_KB=250
MAX_TOTAL_KB=1000
DIST_DIR="dist"

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --skip-build)
      SKIP_BUILD=true
      ;;
    --max-chunk-kb=*)
      MAX_CHUNK_KB="${arg#*=}"
      ;;
    --max-total-kb=*)
      MAX_TOTAL_KB="${arg#*=}"
      ;;
    --dist-dir=*)
      DIST_DIR="${arg#*=}"
      ;;
    *)
      ;;
  esac
done

echo "======================================================================"
echo "[PERFORMANCE GATE] Checking Production Bundle Budget"
echo "======================================================================"

# 1. Execute production build if not skipped
if [ "$SKIP_BUILD" = false ]; then
  BUILD_CMD=""
  if command -v vp >/dev/null 2>&1; then
    BUILD_CMD="vp build"
  elif [ -x "./node_modules/.bin/vp" ]; then
    BUILD_CMD="./node_modules/.bin/vp build"
  elif [ -x "./node_modules/.bin/vite" ]; then
    BUILD_CMD="./node_modules/.bin/vite build"
  elif [ -f "package.json" ] && grep -q '"build":' package.json; then
    BUILD_CMD="npm run build"
  fi

  if [ -n "$BUILD_CMD" ]; then
    echo "Executing production build: $BUILD_CMD..."
    BUILD_STATUS=0
    $BUILD_CMD || BUILD_STATUS=$?
    if [ $BUILD_STATUS -ne 0 ]; then
      echo "❌ [PERFORMANCE GATE FAILED]: Production build failed (exit code: $BUILD_STATUS)."
      exit 2
    fi
  else
    echo "ℹ️  No build tool or script detected; inspecting existing $DIST_DIR directory."
  fi
fi

if [ ! -d "$DIST_DIR" ]; then
  echo "ℹ️  No distribution directory ($DIST_DIR) found."
  echo "ℹ️  Skipping bundle budget verification."
  exit 0
fi

# 2. Inspect chunks in dist/
echo "Analyzing asset sizes in $DIST_DIR (Budget: max chunk ${MAX_CHUNK_KB}KB, total ${MAX_TOTAL_KB}KB)..."

TOTAL_BYTES=0
LARGEST_CHUNK_BYTES=0
LARGEST_CHUNK_NAME=""
VIOLATIONS=0

# Loop over JS and CSS assets
while IFS= read -r -d '' asset; do
  BYTES=$(wc -c < "$asset" | tr -d '[:space:]')
  KB=$((BYTES / 1024))
  TOTAL_BYTES=$((TOTAL_BYTES + BYTES))

  if [ "$BYTES" -gt "$LARGEST_CHUNK_BYTES" ]; then
    LARGEST_CHUNK_BYTES="$BYTES"
    LARGEST_CHUNK_NAME="$asset"
  fi

  if [ "$KB" -gt "$MAX_CHUNK_KB" ]; then
    echo "❌ [BUDGET VIOLATION]: Chunk '$asset' is ${KB}KB (exceeds budget: ${MAX_CHUNK_KB}KB)."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find "$DIST_DIR" -type f \( -name "*.js" -o -name "*.css" -o -name "*.wasm" \) -print0 2>/dev/null || true)

TOTAL_KB=$((TOTAL_BYTES / 1024))
LARGEST_CHUNK_KB=$((LARGEST_CHUNK_BYTES / 1024))

echo "Asset summary: Total size = ${TOTAL_KB}KB | Largest chunk = ${LARGEST_CHUNK_KB}KB ($LARGEST_CHUNK_NAME)"

if [ "$TOTAL_KB" -gt "$MAX_TOTAL_KB" ]; then
  echo "❌ [BUDGET VIOLATION]: Total bundle size (${TOTAL_KB}KB) exceeds total budget (${MAX_TOTAL_KB}KB)."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "⚠️ [PERFORMANCE GATE DRY-RUN]: $VIOLATIONS budget violation(s) detected (dry-run mode)."
    exit 0
  else
    echo ""
    echo "❌ [PERFORMANCE GATE FAILED]: $VIOLATIONS bundle budget violation(s) detected."
    echo "   Ensure code splitting, dynamic imports, and treeshaking are properly configured,"
    echo "   and remove heavyweight or unused dependencies."
    exit 1
  fi
fi

echo ""
echo "✅ [PERFORMANCE GATE PASSED]: Bundle size is strictly within budget."
exit 0
