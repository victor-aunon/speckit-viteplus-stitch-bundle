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
  --skip-build     Skip application compilation and build verification
  --scope=<path>   Restrict allowed modifications to a feature slice (e.g. src/features/billing).
                   Also narrows the env-config audit and regression tests to that slice.
  --feature-dir=<path>  Target feature directory (e.g. specs/001-feature)
  --evidence-dir=<path> Directory to write machine evidence JSON (default: <feature-dir>/evidence)
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
SKIP_BUILD=false
SCOPE_DIR=""
RESET_BREAKER=false
FEATURE_DIR=""
EVIDENCE_DIR=""

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
    --skip-build)
      SKIP_BUILD=true
      ;;
    --scope=*)
      SCOPE_DIR="${arg#*=}"
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --reset-breaker)
      RESET_BREAKER=true
      ;;
    *)
      ;;
  esac
done

# Resolve scope from environment variable if not passed as CLI argument
if [ -z "$SCOPE_DIR" ] && [ -n "${SPECIFY_SCOPE:-}" ]; then
  SCOPE_DIR="$SPECIFY_SCOPE"
fi

# Resolve feature directory from environment variable if not passed as CLI argument
if [ -z "$FEATURE_DIR" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi

# Autodetect feature directory if not provided
if [ -z "$FEATURE_DIR" ] && [ -d "specs" ]; then
  FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
fi

# Resolve evidence directory
if [ -z "$EVIDENCE_DIR" ] && [ -n "$FEATURE_DIR" ] && [ -d "$FEATURE_DIR" ]; then
  EVIDENCE_DIR="$FEATURE_DIR/evidence"
fi

START_TIME=$(date +%s 2>/dev/null || echo 0)

emit_gate_telemetry() {
  local status="$1"
  local code="$2"
  local end_time=$(date +%s 2>/dev/null || echo 0)
  local dur=$(( (end_time - START_TIME) * 1000 ))
  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --gate="check-quality-gate" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${SCOPE_DIR:+--scope="$SCOPE_DIR"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/quality-gate.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  local failed_step="${2:-none}"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const [outPath, status, failedStep, scopeDir, featDir, vpCmd, skipTests, skipBuild] = process.argv.slice(1);
        const stepsOrder = ["circuit_breaker", "blast_radius", "env_config", "code_quality", "regression_tests", "build"];
        const failedIndex = failedStep !== "none" ? stepsOrder.indexOf(failedStep) : -1;
        const getStatus = (stepName, index) => {
          if (failedIndex !== -1) {
            if (index === failedIndex) return "failed";
            if (index > failedIndex) return "unreached";
          }
          if (stepName === "regression_tests" && skipTests === "true") return "skipped";
          if (stepName === "build" && skipBuild === "true") return "skipped";
          return stepName === "circuit_breaker" ? "healthy" : "passed";
        };
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-quality-gate",
          status,
          failed_step: failedStep !== "none" ? failedStep : undefined,
          scope: scopeDir || undefined,
          feature_dir: featDir || undefined,
          engine: vpCmd || undefined,
          checks: {
            circuit_breaker: getStatus("circuit_breaker", 0),
            blast_radius: getStatus("blast_radius", 1),
            env_config: getStatus("env_config", 2),
            code_quality: getStatus("code_quality", 3),
            regression_tests: getStatus("regression_tests", 4),
            build: getStatus("build", 5)
          },
          evidence_type: "deterministic_quality_gate"
        };
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
      ' "$EVIDENCE_DIR/quality-gate.json" "$status" "$failed_step" "$SCOPE_DIR" "$FEATURE_DIR" "$VP_CMD" "$SKIP_TESTS" "$SKIP_BUILD" 2>/dev/null || true
    fi
  fi
}

# Auto-detect scope if inside a git work tree and changes are isolated to a single feature slice
if [ -z "$SCOPE_DIR" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  MODIFIED_SLICES=($(git status --porcelain 2>/dev/null | awk '{print $2}' | grep -E '^src/features/[^/]+' | cut -d/ -f1-3 | sort -u || true))
  if [ ${#MODIFIED_SLICES[@]} -eq 1 ]; then
    SCOPE_DIR="${MODIFIED_SLICES[0]}"
    echo "ℹ️  Auto-detected feature scope from git status: $SCOPE_DIR"
  fi
fi

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
    write_evidence "failed" "circuit_breaker"
    emit_gate_telemetry "failed" 1
    exit 1
  fi

  SCOPE_ARGS=()
  if [ -n "$SCOPE_DIR" ]; then
    SCOPE_ARGS+=("--scope=$SCOPE_DIR")
  fi
  if ! bash "$BLAST_CHECK" --check-scope "${SCOPE_ARGS[@]}"; then
    record_failure
    write_evidence "failed" "blast_radius"
    emit_gate_telemetry "failed" 1
    exit 1
  fi
fi

# 2. Enforce centralized, typed environment variable access
if [ "$DRY_RUN" = false ]; then
  ENV_CHECK="$SCRIPT_DIR/check-env-config.sh"
  if [ -f "$ENV_CHECK" ]; then
    # Brownfield safety: when a feature scope is active, only audit that slice so
    # inherited env-access debt outside the scope does not block the agent.
    ENV_ARGS=()
    if [ -n "$SCOPE_DIR" ]; then
      ENV_ARGS+=("--path=$SCOPE_DIR")
      echo "ℹ️  Scoped env-config check active: scanning '$SCOPE_DIR' only"
    fi
    if ! bash "$ENV_CHECK" "${ENV_ARGS[@]}"; then
      record_failure
      write_evidence "failed" "env_config"
      emit_gate_telemetry "failed" 1
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
  emit_gate_telemetry "failed" 2
  exit 2
fi

echo "✓ Engine detected: $VP_CMD"

if [ "$DRY_RUN" = true ]; then
  echo "✓ [QUALITY GATE]: Dry run completed successfully. Tools are available."
  emit_gate_telemetry "passed" 0
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
  write_evidence "failed" "code_quality"
  emit_gate_telemetry "failed" "$CHECK_STATUS"
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
    if [ -n "$SCOPE_DIR" ]; then
      echo "ℹ️  Scoped regression check active: filtering test execution to '$SCOPE_DIR'"
      TEST_CMD="$TEST_CMD $SCOPE_DIR"
    fi
    echo "✓ Test runner detected: $TEST_CMD"
    TEST_STATUS=0
    $TEST_CMD || TEST_STATUS=$?

    if [ $TEST_STATUS -ne 0 ]; then
      record_failure
      write_evidence "failed" "regression_tests"
      emit_gate_telemetry "failed" "$TEST_STATUS"
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

# 5. Build and compile application (Build Gate)
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "Executing application build and compilation (Build Gate)..."

  BUILD_CMD=""
  if [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
    if command -v vp >/dev/null 2>&1; then
      BUILD_CMD="vp build"
    elif [ -x "./node_modules/.bin/vp" ]; then
      BUILD_CMD="./node_modules/.bin/vp build"
    elif [ -x "./node_modules/.bin/vite" ]; then
      BUILD_CMD="./node_modules/.bin/vite build"
    fi
  fi

  if [ -z "$BUILD_CMD" ] && [ -f "package.json" ]; then
    if grep -q '"build":' package.json; then
      BUILD_CMD="npm run build"
    fi
  fi

  if [ -n "$BUILD_CMD" ]; then
    echo "✓ Build tool detected: $BUILD_CMD"
    BUILD_STATUS=0
    $BUILD_CMD || BUILD_STATUS=$?

    if [ $BUILD_STATUS -ne 0 ]; then
      record_failure
      write_evidence "failed" "build"
      emit_gate_telemetry "failed" "$BUILD_STATUS"
      echo ""
      echo "❌ [QUALITY GATE FAILED]: Application build / compilation failed with errors (exit code: $BUILD_STATUS)."
      echo "Please fix bundling, syntax, or module resolution errors before proceeding."
      exit 1
    fi
    echo "✓ Application compiled and built successfully with zero errors."
  else
    echo "ℹ️  No build script or configuration found; skipping compilation gate."
  fi
else
  echo "ℹ️  --skip-build flag specified; skipping application build."
fi

record_success
write_evidence "passed"
emit_gate_telemetry "passed" 0

echo ""
echo "✅ [QUALITY GATE PASSED]: All deterministic quality checks passed."
exit 0
