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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

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
  --source=<origin>       Who asked for a --reset, recorded in telemetry. Use
                          `workflow` for a loop iteration, `human` when a person
                          follows the abort message. Omitting it records
                          `unspecified`, which is how an agent-driven reset is
                          distinguished after the fact: all three are the same
                          shell command in the same work tree, so without this
                          field they are indistinguishable in the event log.
  --max-failures=<N>      Maximum consecutive failures before tripping (default: 3)
  --state-dir=<path>      Directory for circuit breaker state (default: .specify or /tmp)
  --require-git           Fail when the project root is not its own git repository
  --allow-foreign-git     Allow an ancestor git repository (dangerous: audits the
                          ancestor repo, not this project)

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
RESET_SOURCE=""
SCOPE_DIR=""
MAX_FAILURES=3
STATE_DIR=""
REQUIRE_GIT=false
ALLOW_FOREIGN_GIT=false

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
    --source=*)
      RESET_SOURCE="${arg#*=}"
      ;;
    --max-failures=*)
      MAX_FAILURES="${arg#*=}"
      ;;
    --state-dir=*)
      STATE_DIR="${arg#*=}"
      ;;
    --require-git)
      REQUIRE_GIT=true
      ;;
    --allow-foreign-git)
      ALLOW_FOREIGN_GIT=true
      ;;
    *)
      ;;
  esac
done

# Sanitize before it reaches the telemetry JSON: an unescaped quote would make
# `--details` unparseable and the event would silently lose its payload.
RESET_SOURCE="$(printf '%s' "$RESET_SOURCE" | tr -cd 'A-Za-z0-9_-')"
[ -n "$RESET_SOURCE" ] || RESET_SOURCE="unspecified"

if [ "$REQUIRE_GIT" = false ] && [ "${SPECIFY_REQUIRE_GIT:-}" = "true" ]; then
  REQUIRE_GIT=true
fi
if [ "$ALLOW_FOREIGN_GIT" = false ] && [ "${SPECIFY_ALLOW_FOREIGN_GIT:-}" = "true" ]; then
  ALLOW_FOREIGN_GIT=true
fi

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

emit_cb_telemetry() {
  local event="$1"
  local status="$2"
  local details="$3"
  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --event="$event" \
      --gate="check-blast-radius" \
      --status="$status" \
      ${SCOPE_DIR:+--scope="$SCOPE_DIR"} \
      ${details:+--details="$details"} 2>/dev/null || true
  fi
}

# 1. Reset / Success handling
if [ "$RESET_BREAKER" = true ] || [ "$RECORD_SUCCESS" = true ]; then
  if [ "$DRY_RUN" = false ]; then
    set_failure_count 0
  fi
  emit_cb_telemetry "circuit_breaker" "reset" "{\"failures\":0,\"source\":\"$RESET_SOURCE\"}"
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
    emit_cb_telemetry "circuit_breaker" "tripped" "{\"failures\":$CURRENT_COUNT,\"max_failures\":$MAX_FAILURES}"
    exit 1
  fi
  echo "✓ Circuit breaker is healthy (failures: $CURRENT_COUNT / $MAX_FAILURES)."
  emit_cb_telemetry "circuit_breaker" "healthy" "{\"failures\":$CURRENT_COUNT,\"max_failures\":$MAX_FAILURES}"
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
    emit_cb_telemetry "circuit_breaker" "tripped" "{\"failures\":$NEW_COUNT,\"max_failures\":$MAX_FAILURES}"
    exit 1
  fi
  emit_cb_telemetry "circuit_breaker" "failure_recorded" "{\"failures\":$NEW_COUNT,\"max_failures\":$MAX_FAILURES}"
  exit 0
fi

# 4. Scope and Protected Files Check (Blast Radius)
# If neither --check-scope nor --check-breaker was explicitly asked, default to checking scope
if [ "$CHECK_SCOPE" = true ] || [ "$CHECK_BREAKER" = false ]; then
  echo "======================================================================"
  echo "[BLAST RADIUS GATE] Verifying modified file boundaries"
  echo "======================================================================"

  # The project root must own its git repository. Otherwise an unrelated ancestor
  # repository (e.g. $HOME) is audited instead of this project, and its modified
  # files are misreported as this project's blast radius.
  PROJECT_ROOT="$PWD"
  SCAN_DIR="$PWD"
  while [ "$SCAN_DIR" != "/" ] && [ -n "$SCAN_DIR" ]; do
    if [ -d "$SCAN_DIR/.specify" ] || [ -f "$SCAN_DIR/package.json" ] || [ -e "$SCAN_DIR/.git" ]; then
      PROJECT_ROOT="$SCAN_DIR"
      break
    fi
    SCAN_DIR="$(dirname "$SCAN_DIR")"
  done

  GIT_TOPLEVEL=""
  if command -v git >/dev/null 2>&1; then
    GIT_TOPLEVEL="$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
  fi

  if [ -z "$GIT_TOPLEVEL" ]; then
    if [ "$REQUIRE_GIT" = true ]; then
      echo "❌ [BLAST RADIUS GATE FAILED]: --require-git was passed but no git repository was found."
      echo "   Run 'git init' in $PROJECT_ROOT and commit a baseline."
      exit 1
    fi
    echo "ℹ️  Not inside a git repository; skipping git blast radius scan."
    exit 0
  fi

  GIT_TOPLEVEL_REAL="$(cd "$GIT_TOPLEVEL" 2>/dev/null && pwd -P || printf '%s' "$GIT_TOPLEVEL")"
  PROJECT_ROOT_REAL="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P || printf '%s' "$PROJECT_ROOT")"
  if [ "$GIT_TOPLEVEL_REAL" != "$PROJECT_ROOT_REAL" ] && [ "$ALLOW_FOREIGN_GIT" = false ]; then
    echo "❌ [BLAST RADIUS GATE FAILED]: project root is not its own git repository."
    echo "   Project root : $PROJECT_ROOT"
    echo "   Inherited git: $GIT_TOPLEVEL"
    echo "   Auditing that repository would report unrelated files as this project's blast radius."
    echo "   Fix: run 'git init' in $PROJECT_ROOT and commit a baseline, or pass --allow-foreign-git."
    exit 1
  fi

  MODIFIED_FILES=()
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    # Porcelain v1: first 3 chars are XY + space; renames read 'old -> new'.
    file="${entry:3}"
    case "$file" in
      *' -> '*) file="${file##* -> }" ;;
    esac
    file="${file%\"}"
    file="${file#\"}"
    if [ -n "$file" ]; then
      MODIFIED_FILES+=("$file")
    fi
  done < <(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=all -- . 2>/dev/null || true)

  if [ ${#MODIFIED_FILES[@]} -eq 0 ]; then
    echo "✓ No modified files detected in working tree."
    exit 0
  fi

  PROTECTED_PATTERNS=(
    ".specify/scripts/"
    ".specify/extensions.yml"
    ".specify/workflows/"
    ".specify/memory/"
    ".specify/templates/"
    "templates/guardrails.md"
    # The gate config IS a gate. An addition there is as dangerous as a deletion:
    # `lint: { ignorePatterns: ['src/**'] }` removes every rule from the code and
    # the anti-tampering delta check (which greps removed lines) never sees it.
    # A real run had to edit this file just to give vitest a jsdom environment, so
    # the profiles that need it now ship that block in the template: nobody should
    # have to touch this file to run the test suite.
    "vite.config.ts"
    # The vendored accessibility/visual audit. It is tooling, and an agent that can
    # edit it can make the audit pass by weakening the audit.
    "tests/design/"
  )

  # App-shell and shared infrastructure are intentionally outside any slice.
  # The canonical env module (src/config/env.ts) is required by check-env-config.sh
  # and the Vite entry/Tailwind stylesheet live at the app root, so a scoped run
  # must allow them. Otherwise the two gates contradict each other: the agent can
  # only pass one of them by moving the typed config out of its canonical path.
  SHARED_SCOPE_PATTERNS=(
    "src/shared/*"
    "src/common/*"
    "src/config/*"
    "src/styles/*"
    "src/main.*"
    "src/App.*"
    "src/index.*"
  )

  is_shared_scope_path() {
    local candidate="$1"
    local pattern
    for pattern in "${SHARED_SCOPE_PATTERNS[@]}"; do
      # shellcheck disable=SC2053 # glob match on purpose
      if [[ "$candidate" == $pattern ]]; then
        return 0
      fi
    done
    return 1
  }

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
      if [[ "$file" == src/* ]] && [[ "$file" != "$SCOPE_DIR"* ]] && ! is_shared_scope_path "$file"; then
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
    emit_cb_telemetry "blast_radius" "failed" "{\"violations\":$VIOLATIONS}"
    exit 1
  fi

  echo "✓ All ${#MODIFIED_FILES[@]} modified file(s) are within legitimate boundaries."
  emit_cb_telemetry "blast_radius" "passed" "{\"modified_files\":${#MODIFIED_FILES[@]}}"
fi

exit 0
