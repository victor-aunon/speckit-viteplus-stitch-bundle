#!/usr/bin/env bash
# ==============================================================================
# check-quality-gate.sh
# ------------------------------------------------------------------------------
# Deterministic Quality Gate for Spec Kit powered by Vite+ (vp).
# Validates:
#   1. Code formatting (Oxfmt Airbnb style)
#   2. Linter (Oxlint with Airbnb rules and @shadcn/lint)
#   3. Strict type checking (TypeScript typeCheck)
#   4. Cyclomatic complexity limits (max 10) and function line limits (max 50)
#   5. Clean Architecture layer boundaries (no-restricted-imports with Oxlint overrides),
#      including vertical slices outside src/core
#   6. Environment access centralized in one typed config module
#   7. Automated unit and integration test suite execution with zero regressions
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: check-quality-gate.sh [options]

Deterministic Quality Gate for Spec Kit with Vite+ (vp).
Verifies formatting, types, Airbnb style rules, complexity limits, architectural boundaries,
centralized/typed environment variable access, blast radius scope, and automated regression test suite.

Options:
  --help           Show this help message
  --dry-run        Verify tooling availability without running full check
  --fix            Automatically fix formatting and auto-fixable lint issues
  --skip-tests     Skip running the automated test suite
  --scope=<path>   Restrict allowed modifications to a feature slice (e.g. src/features/billing)
  --reset-breaker  Reset the consecutive failure circuit breaker counter

Exit Codes:
  0                All checks passed successfully
  1                Linting, type, complexity, architectural, blast radius, or test violations
  2                Missing dependencies or runtime tools
EOF
}

DRY_RUN=false
AUTO_FIX=false
SKIP_TESTS=false
SCOPE_DIR=""
RESET_BREAKER=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --fix)
      AUTO_FIX=true
      ;;
    --skip-tests)
      SKIP_TESTS=true
      ;;
    --scope=*)
      SCOPE_DIR="${arg#*=}"
      ;;
    --reset-breaker)
      RESET_BREAKER=true
      ;;
    *)
      ;;
  esac
done

echo "======================================================================"
echo "[QUALITY GATE] Starting deterministic quality check with Vite+"
echo "======================================================================"

BLAST_CHECK="$SCRIPT_DIR/check-blast-radius.sh"

record_failure() {
  if [ -f "$BLAST_CHECK" ]; then
    bash "$BLAST_CHECK" --record-failure 2>/dev/null || true
  fi
}

record_success() {
  if [ -f "$BLAST_CHECK" ]; then
    bash "$BLAST_CHECK" --record-success 2>/dev/null || true
  fi
}

# 1. Circuit Breaker pre-flight and Reset
if [ "$RESET_BREAKER" = true ] && [ -f "$BLAST_CHECK" ]; then
  bash "$BLAST_CHECK" --reset
fi

if [ "$DRY_RUN" = false ] && [ -f "$BLAST_CHECK" ]; then
  if ! bash "$BLAST_CHECK" --check-breaker; then
    exit 1
  fi

  SCOPE_ARGS=()
  if [ -n "$SCOPE_DIR" ]; then
    SCOPE_ARGS+=("--scope=$SCOPE_DIR")
  fi
  if ! bash "$BLAST_CHECK" --check-scope "${SCOPE_ARGS[@]}"; then
    record_failure
    exit 1
  fi
fi

# 2. Enforce centralized, typed environment variable access
if [ "$DRY_RUN" = false ]; then
  ENV_CHECK="$SCRIPT_DIR/check-env-config.sh"
  if [ -f "$ENV_CHECK" ]; then
    if ! bash "$ENV_CHECK"; then
      record_failure
      echo ""
      echo "❌ [QUALITY GATE FAILED]: Environment variable configuration violations detected."
      exit 1
    fi
  else
    echo "⚠️ [QUALITY GATE WARNING]: check-env-config.sh not found; skipping environment gate."
  fi
fi

# 3. Resolve Vite+ (vp) binary
VP_CMD=""
if command -v vp >/dev/null 2>&1; then
  VP_CMD="vp"
elif [ -x "./node_modules/.bin/vp" ]; then
  VP_CMD="./node_modules/.bin/vp"
elif command -v npx >/dev/null 2>&1; then
  VP_CMD="npx vite-plus vp"
fi

if [ -z "$VP_CMD" ]; then
  echo "⚠️ [QUALITY GATE ERROR]: Neither Vite+ 'vp' command nor 'npx' was found."
  echo "To install Vite+, run: curl -fsSL https://vite.plus | bash"
  exit 2
fi

echo "✓ Engine detected: $VP_CMD"

if [ "$DRY_RUN" = true ]; then
  echo "✓ [QUALITY GATE]: Dry run completed successfully. Tools are available."
  exit 0
fi

# 3. Run unified quality check
echo "Executing vp check (Airbnb Linter + Oxlint + TypeScript Types + Complexity)..."

CHECK_STATUS=0
if [ "$AUTO_FIX" = true ]; then
  $VP_CMD check --fix || CHECK_STATUS=$?
else
  $VP_CMD check || CHECK_STATUS=$?
fi

if [ $CHECK_STATUS -ne 0 ]; then
  record_failure
  echo ""
  echo "❌ [QUALITY GATE FAILED]: Violations detected in code (exit code: $CHECK_STATUS)."
  echo "Please fix the issues flagged by Vite+ before proceeding to the next phase."
  exit 1
fi

echo "✓ Code style, types, complexity, and architectural boundaries passed."

# 4. Run automated test suite (Regression Gate)
if [ "$SKIP_TESTS" = false ]; then
  echo ""
  echo "Executing automated test suite (Regression Gate)..."

  TEST_CMD=""
  if [ -f "vitest.config.ts" ] || [ -f "vitest.config.js" ] || [ -f "vite.config.ts" ]; then
    if command -v vp >/dev/null 2>&1; then
      TEST_CMD="vp test --run --passWithNoTests"
    elif [ -x "./node_modules/.bin/vp" ]; then
      TEST_CMD="./node_modules/.bin/vp test --run --passWithNoTests"
    elif [ -x "./node_modules/.bin/vitest" ]; then
      TEST_CMD="./node_modules/.bin/vitest run --passWithNoTests"
    fi
  fi

  if [ -z "$TEST_CMD" ] && [ -f "package.json" ]; then
    if grep -q '"test":' package.json; then
      TEST_CMD="npm test -- --passWithNoTests"
    fi
  fi

  if [ -n "$TEST_CMD" ]; then
    echo "✓ Test runner detected: $TEST_CMD"
    TEST_STATUS=0
    $TEST_CMD || TEST_STATUS=$?

    if [ $TEST_STATUS -ne 0 ]; then
      record_failure
      echo ""
      echo "❌ [QUALITY GATE FAILED]: Test suite failed with regressions (exit code: $TEST_STATUS)."
      echo "Please fix the failing tests before proceeding to the next phase."
      exit 1
    fi
    echo "✓ Test suite passed with zero regressions."
  else
    echo "ℹ️  No test runner or test suite configured; skipping regression tests."
  fi
else
  echo "ℹ️  --skip-tests flag specified; skipping regression tests."
fi

record_success

echo ""
echo "✅ [QUALITY GATE PASSED]: All deterministic quality checks passed."
exit 0
