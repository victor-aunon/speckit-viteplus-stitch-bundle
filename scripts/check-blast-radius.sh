#!/usr/bin/env bash
# ==============================================================================
# check-blast-radius.sh
# ------------------------------------------------------------------------------
# Blast Radius & Circuit Breaker Quality Gate for Spec Kit and Vite+.
#
# Enforces two critical autonomous development protections:
#   1. Blast Radius Control: Prevents agents from modifying protected tooling,
#      configuration files, quality gates, or files outside the target feature scope.
#   2. Circuit Breaker (Anti-Loop): Tracks consecutive failure attempts per task.
#      If consecutive failures exceed threshold (default: 3), execution is halted
#      to prevent degradation loops and runaway token waste.
# ==============================================================================

set -eo pipefail

show_help() {
  cat << 'EOF'
Usage: check-blast-radius.sh [options]

Protects repository scope and prevents infinite agent repair loops.

Options:
  --help                  Show this help message
  --dry-run               Simulate checks without modifying state
  --scope=<path>          Allowed feature slice directory (e.g. src/features/billing)
  --check-scope           Verify git modified files stay within scope and do not touch protected files
  --check-breaker         Verify circuit breaker is not currently tripped
  --record-failure        Increment failure counter; trip if threshold reached
  --record-success        Reset failure counter to 0
  --reset                 Manually reset the circuit breaker counter
  --max-failures=<N>      Maximum consecutive failures before tripping (default: 3)
  --state-dir=<path>      Directory for circuit breaker state (default: .specify or /tmp)

Exit Codes:
  0                       All checks passed / Breaker is healthy
  1                       Blast radius violation or Circuit Breaker tripped
  2                       Configuration error
EOF
}

DRY_RUN=false
CHECK_SCOPE=false
CHECK_BREAKER=false
RECORD_FAILURE=false
RECORD_SUCCESS=false
RESET_BREAKER=false
SCOPE_DIR=""
MAX_FAILURES=3
STATE_DIR=""

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --scope=*)
      SCOPE_DIR="${arg#*=}"
      ;;
    --check-scope)
      CHECK_SCOPE=true
      ;;
    --check-breaker)
      CHECK_BREAKER=true
      ;;
    --record-failure)
      RECORD_FAILURE=true
      ;;
    --record-success)
      RECORD_SUCCESS=true
      ;;
    --reset)
      RESET_BREAKER=true
      ;;
    --max-failures=*)
      MAX_FAILURES="${arg#*=}"
      ;;
    --state-dir=*)
      STATE_DIR="${arg#*=}"
      ;;
    *)
      ;;
  esac
done

# Resolve state directory
if [ -z "$STATE_DIR" ]; then
  if [ -d "$PWD/.specify" ]; then
    STATE_DIR="$PWD/.specify"
  else
    DIR_HASH="$(printf '%s' "$PWD" | shasum 2>/dev/null | awk '{print $1}' || printf '%s' "$PWD" | md5 2>/dev/null || echo "default")"
    STATE_DIR="${TMPDIR:-/tmp}/speckit-cb-${DIR_HASH:0:12}"
    mkdir -p "$STATE_DIR" 2>/dev/null || true
  fi
fi

STATE_FILE="$STATE_DIR/.circuit-breaker-state"

get_failure_count() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

set_failure_count() {
  local count="$1"
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  printf '%s' "$count" > "$STATE_FILE" 2>/dev/null || true
}

# 1. Reset / Success handling
if [ "$RESET_BREAKER" = true ] || [ "$RECORD_SUCCESS" = true ]; then
  if [ "$DRY_RUN" = false ]; then
    set_failure_count 0
  fi
  echo "✓ Circuit breaker counter reset to 0."
  exit 0
fi

# 2. Check Breaker State
if [ "$CHECK_BREAKER" = true ]; then
  CURRENT_COUNT="$(get_failure_count)"
  CURRENT_COUNT="${CURRENT_COUNT:-0}"
  if [ "$CURRENT_COUNT" -ge "$MAX_FAILURES" ]; then
    echo "❌ [CIRCUIT BREAKER TRIPPED]: Maximum retry attempts ($MAX_FAILURES) exceeded for this task."
    echo "   Current consecutive failure count: $CURRENT_COUNT."
    echo "   Execution is halted to prevent degradation loops and uncontrolled token expenditure."
    echo "   Action required: Inspect failures, revert uncommitted regressions with 'git checkout/restore .',"
    echo "   and reset with 'check-blast-radius.sh --reset'."
    exit 1
  fi
  echo "✓ Circuit breaker is healthy (failures: $CURRENT_COUNT / $MAX_FAILURES)."
  if [ "$CHECK_SCOPE" = false ] && [ "$RECORD_FAILURE" = false ]; then
    exit 0
  fi
fi

# 3. Record Failure
if [ "$RECORD_FAILURE" = true ]; then
  CURRENT_COUNT="$(get_failure_count)"
  CURRENT_COUNT="${CURRENT_COUNT:-0}"
  NEW_COUNT=$((CURRENT_COUNT + 1))
  if [ "$DRY_RUN" = false ]; then
    set_failure_count "$NEW_COUNT"
  fi
  echo "⚠️ [CIRCUIT BREAKER WARNING]: Gate failure recorded (attempt $NEW_COUNT of $MAX_FAILURES)."
  if [ "$NEW_COUNT" -ge "$MAX_FAILURES" ]; then
    echo "❌ [CIRCUIT BREAKER TRIPPED]: Consecutive failure threshold reached ($NEW_COUNT / $MAX_FAILURES)."
    echo "   Halting execution immediately to prevent damage to the repository."
    exit 1
  fi
  exit 0
fi

# 4. Scope and Protected Files Check (Blast Radius)
# If neither --check-scope nor --check-breaker was explicitly asked, default to checking scope
if [ "$CHECK_SCOPE" = true ] || [ "$CHECK_BREAKER" = false ]; then
  echo "======================================================================"
  echo "[BLAST RADIUS GATE] Verifying modified file boundaries"
  echo "======================================================================"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "ℹ️  Not inside a git repository; skipping git blast radius scan."
    exit 0
  fi

  MODIFIED_FILES=()
  while IFS= read -r file; do
    if [ -n "$file" ]; then
      MODIFIED_FILES+=("$file")
    fi
  done < <(git status --porcelain 2>/dev/null | awk '{print $2}' || true)

  if [ ${#MODIFIED_FILES[@]} -eq 0 ]; then
    echo "✓ No modified files detected in working tree."
    exit 0
  fi

  PROTECTED_PATTERNS=(
    ".specify/scripts/"
    ".specify/extensions.yml"
    ".specify/workflows/"
    "templates/guardrails.md"
  )

  VIOLATIONS=0
  for file in "${MODIFIED_FILES[@]}"; do
    # Check protected files
    for protected in "${PROTECTED_PATTERNS[@]}"; do
      if [[ "$file" == *"$protected"* ]]; then
        echo "❌ [BLAST RADIUS VIOLATION]: Modification to protected tooling/gate file detected: $file"
        VIOLATIONS=$((VIOLATIONS + 1))
      fi
    done

    # Check feature scope if specified
    if [ -n "$SCOPE_DIR" ]; then
      # Only restrict application source files under src/
      if [[ "$file" == src/* ]] && [[ "$file" != "$SCOPE_DIR"* ]] && [[ "$file" != src/shared/* ]] && [[ "$file" != src/common/* ]]; then
        echo "❌ [BLAST RADIUS VIOLATION]: File '$file' is outside target feature scope '$SCOPE_DIR'."
        VIOLATIONS=$((VIOLATIONS + 1))
      fi
    fi
  done

  if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "❌ [BLAST RADIUS GATE FAILED]: $VIOLATIONS file boundary violation(s) detected."
    echo "   Autonomous agents may only modify files within their assigned feature scope,"
    echo "   and may never modify quality gates, constitution rules, or tooling scripts."
    exit 1
  fi

  echo "✓ All ${#MODIFIED_FILES[@]} modified file(s) are within legitimate boundaries."
fi

exit 0
