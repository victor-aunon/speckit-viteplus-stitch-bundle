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
  --skip-tests     Skip running the automated test suite (evidence: skipped)
  --allow-no-tests Allow a test run that executes zero tests (evidence: skipped).
                   Without this flag, zero executed tests FAIL the gate.
  --require-git    Fail when the project root is not its own git repository
  --allow-foreign-git  Allow running inside an ancestor git repository instead of
                   the project root (dangerous: blast radius would audit the
                   ancestor repo, not this project)
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
ALLOW_NO_TESTS=false
REQUIRE_GIT=false
ALLOW_FOREIGN_GIT=false
SCOPE_DIR=""
RESET_BREAKER=false
FEATURE_DIR=""
EVIDENCE_DIR=""
# Populated only when the gate actually fails. The evidence used to record WHICH
# check died and nothing else, so reading it after an abort never told you what
# to fix and the only path forward was re-running the gate by hand.
FAILURE_OUTPUT=""
FAILURE_EXIT=""
FAILURE_LOG=""

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
    --allow-no-tests)
      ALLOW_NO_TESTS=true
      ;;
    --require-git)
      REQUIRE_GIT=true
      ;;
    --allow-foreign-git)
      ALLOW_FOREIGN_GIT=true
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

if [ "$ALLOW_NO_TESTS" = false ] && [ "${SPECIFY_ALLOW_NO_TESTS:-}" = "true" ]; then
  ALLOW_NO_TESTS=true
fi
if [ "$REQUIRE_GIT" = false ] && [ "${SPECIFY_REQUIRE_GIT:-}" = "true" ]; then
  REQUIRE_GIT=true
fi
if [ "$ALLOW_FOREIGN_GIT" = false ] && [ "${SPECIFY_ALLOW_FOREIGN_GIT:-}" = "true" ]; then
  ALLOW_FOREIGN_GIT=true
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

# Test execution bookkeeping (filled in by the Regression Gate below)
TESTS_EXECUTED=""
REGRESSION_OVERRIDE=""

emit_gate_telemetry() {
  local status="$1"
  local code="$2"
  local end_time=$(date +%s 2>/dev/null || echo 0)
  local dur=$(( (end_time - START_TIME) * 1000 ))
  local details=""
  if [ -n "${TESTS_EXECUTED:-}" ] && [ "$TESTS_EXECUTED" != "unknown" ]; then
    details="{\"tests_executed\":$TESTS_EXECUTED}"
  fi
  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --gate="check-quality-gate" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${details:+--details="$details"} \
      ${SCOPE_DIR:+--scope="$SCOPE_DIR"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/quality-gate.json"} 2>/dev/null || true
  fi
}

# Persist what the tool actually printed.
#
# Two destinations on purpose: the full log lands next to the evidence (the JSON
# keeps a bounded tail so it stays readable and the history line stays small), and
# the same tail is embedded so a summary is useful on its own.
capture_failure_output() {
  local source_log="$1"
  FAILURE_EXIT="$CHECK_STATUS"
  [ -f "$source_log" ] || return 0

  if [ -n "$EVIDENCE_DIR" ] && mkdir -p "$EVIDENCE_DIR" 2>/dev/null; then
    if cp "$source_log" "$EVIDENCE_DIR/quality-gate.log" 2>/dev/null; then
      FAILURE_LOG="quality-gate.log"
    fi
  fi

  # The tail, not the head: the tool banner is at the top and the violations are
  # at the bottom. 120 lines names the failures without turning the evidence into
  # a log dump.
  FAILURE_OUTPUT="$(tail -n 120 "$source_log" 2>/dev/null | cut -c1-500 || true)"
}

write_evidence() {
  local status="$1"
  local failed_step="${2:-none}"
  # A green gate must not leave the previous failure's log next to it: read as
  # current evidence, it is a lie. A real audit had to explain it away in its
  # report ("it is the output file of a past failure, not a status artifact").
  if [ "$status" != "failed" ] && [ -n "$EVIDENCE_DIR" ]; then
    rm -f "$EVIDENCE_DIR/quality-gate.log" 2>/dev/null || true
  fi
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      EV_STATUS="$status" \
      EV_FAILED_STEP="$failed_step" \
      EV_SCOPE="$SCOPE_DIR" \
      EV_FEATURE_DIR="$FEATURE_DIR" \
      EV_ENGINE="$VP_CMD" \
      EV_SKIP_TESTS="$SKIP_TESTS" \
      EV_SKIP_BUILD="$SKIP_BUILD" \
      EV_TESTS_EXECUTED="$TESTS_EXECUTED" \
      EV_FAILURE_OUTPUT="$FAILURE_OUTPUT" \
      EV_FAILURE_EXIT="$FAILURE_EXIT" \
      EV_FAILURE_LOG="$FAILURE_LOG" \
      EV_REGRESSION_OVERRIDE="$REGRESSION_OVERRIDE" \
      EV_GIT_TOPLEVEL="$GIT_TOPLEVEL" \
      EV_PROJECT_ROOT="$PROJECT_ROOT" \
      node -e '
        const fs = require("fs");
        const outPath = process.argv[1];
        const env = process.env;
        const status = env.EV_STATUS || "unknown";
        const failedStep = env.EV_FAILED_STEP || "none";
        const stepsOrder = ["circuit_breaker", "git_root", "dependencies", "anti_tampering", "blast_radius", "env_config", "code_quality", "regression_tests", "build"];
        const failedIndex = failedStep !== "none" ? stepsOrder.indexOf(failedStep) : -1;
        const getStatus = (stepName, index) => {
          if (failedIndex !== -1) {
            if (index === failedIndex) return "failed";
            if (index > failedIndex) return "unreached";
          }
          if (stepName === "regression_tests") {
            if (env.EV_REGRESSION_OVERRIDE === "skipped") return "skipped";
            if (env.EV_SKIP_TESTS === "true") return "skipped";
          }
          if (stepName === "build" && env.EV_SKIP_BUILD === "true") return "skipped";
          if (stepName === "git_root" && env.EV_GIT_TOPLEVEL) return "passed";
          if (stepName === "git_root") return "skipped";
          return stepName === "circuit_breaker" ? "healthy" : "passed";
        };
        const testsExecuted = Number(env.EV_TESTS_EXECUTED);
        const failureExit = Number(env.EV_FAILURE_EXIT);
        const failureOutput = env.EV_FAILURE_OUTPUT || "";
        // What the tool said, not just which check died. Absent on a passing run
        // so a stale failure can never be read as current.
        const failure =
          status === "failed" && failureOutput
            ? {
                step: failedStep !== "none" ? failedStep : undefined,
                exit_code: Number.isFinite(failureExit) ? failureExit : undefined,
                output_file: env.EV_FAILURE_LOG || undefined,
                output: failureOutput,
              }
            : undefined;
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-quality-gate",
          status,
          failed_step: failedStep !== "none" ? failedStep : undefined,
          previous_status: previousStatus,
          scope: env.EV_SCOPE || undefined,
          feature_dir: env.EV_FEATURE_DIR || undefined,
          project_root: env.EV_PROJECT_ROOT || undefined,
          git_toplevel: env.EV_GIT_TOPLEVEL || undefined,
          engine: env.EV_ENGINE || undefined,
          tests_executed: Number.isFinite(testsExecuted) ? testsExecuted : undefined,
          failure,
          checks: {
            circuit_breaker: getStatus("circuit_breaker", 0),
            git_root: getStatus("git_root", 1),
            dependencies: getStatus("dependencies", 2),
            anti_tampering: getStatus("anti_tampering", 3),
            blast_radius: getStatus("blast_radius", 4),
            env_config: getStatus("env_config", 5),
            code_quality: getStatus("code_quality", 6),
            regression_tests: getStatus("regression_tests", 7),
            build: getStatus("build", 8)
          },
          evidence_type: "deterministic_quality_gate"
        };
        // Trailing newline: Oxfmt rejects a file that does not end with one, and
        // `vp check` scans this evidence directory.
        const serialized = JSON.stringify(data, null, 2) + "\n";
        fs.writeFileSync(outPath, serialized, "utf8");
        // Append-only audit trail: every run leaves a line, nothing is overwritten.
        // Append-only, but only on state changes: repeated identical outcomes
        // do not grow the history (the timestamp is not part of the payload).
        // Execution frequency lives in .specify/telemetry.jsonl, not here.
        const historyPath = outPath.replace(/\.json$/, ".history.jsonl");
        const comparable = (entry) => {
          // timestamp and previous_status are bookkeeping, not state.
          // `failure` is excluded too: its content changes on every run (paths,
          // line numbers, counts) without the gate STATE changing, so counting
          // it would append a history line per run and destroy the "only on state
          // change" contract that makes this trail readable. No apostrophes in
          // here: this whole block lives inside a single-quoted node -e payload.
          const { timestamp, previous_status, failure, ...rest } = entry;
          return JSON.stringify(rest);
        };
        let lastHistory = "";
        try {
          const historyLines = fs.readFileSync(historyPath, "utf8").split("\n").filter(Boolean);
          if (historyLines.length > 0) lastHistory = historyLines[historyLines.length - 1];
        } catch {}
        let changed = true;
        if (lastHistory) {
          try {
            changed = comparable(JSON.parse(lastHistory)) !== comparable(data);
          } catch {
            changed = true;
          }
        }
        if (changed) {
          fs.appendFileSync(historyPath, JSON.stringify(data) + "\n", "utf8");
        }
      ' "$EVIDENCE_DIR/quality-gate.json" 2>/dev/null || true
    fi
  fi
}

# ------------------------------------------------------------------------------
# Git ownership: the project root must be its own repository.
# Without this, a greenfield project nested inside an unrelated repo (e.g. $HOME)
# would audit, diff and "protect" that ancestor repo instead of this project.
# ------------------------------------------------------------------------------
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

GIT_OWNED=false
if [ -n "$GIT_TOPLEVEL" ]; then
  GIT_TOPLEVEL_REAL="$(cd "$GIT_TOPLEVEL" 2>/dev/null && pwd -P || printf '%s' "$GIT_TOPLEVEL")"
  PROJECT_ROOT_REAL="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P || printf '%s' "$PROJECT_ROOT")"
  if [ "$GIT_TOPLEVEL_REAL" = "$PROJECT_ROOT_REAL" ]; then
    GIT_OWNED=true
  fi
fi

if [ "$GIT_OWNED" = false ] && [ "$ALLOW_FOREIGN_GIT" = false ] && [ "$DRY_RUN" = false ]; then
  if [ -n "$GIT_TOPLEVEL" ]; then
    echo "❌ [QUALITY GATE FAILED]: Project root is NOT its own git repository."
    echo "   Project root : $PROJECT_ROOT"
    echo "   Inherited git: $GIT_TOPLEVEL"
    echo "   Anti-tampering and blast radius would audit the ancestor repository instead of this project."
    echo "   Fix: run 'git init' in $PROJECT_ROOT (and commit a baseline), or pass --allow-foreign-git."
    write_evidence "failed" "git_root"
    emit_gate_telemetry "failed" 1
    exit 1
  fi
  if [ "$REQUIRE_GIT" = true ]; then
    echo "❌ [QUALITY GATE FAILED]: --require-git was passed but no git repository was found."
    echo "   Run 'git init' in $PROJECT_ROOT and commit a baseline."
    write_evidence "failed" "git_root"
    emit_gate_telemetry "failed" 1
    exit 1
  fi
  echo "⚠️  [QUALITY GATE WARNING]: no git repository at project root ($PROJECT_ROOT)."
  echo "   Anti-tampering and blast radius checks are disabled until 'git init' is run."
fi

# Auto-detect scope from the project's own repository only (never an ancestor repo)
if [ -z "$SCOPE_DIR" ] && [ "$GIT_OWNED" = true ]; then
  MODIFIED_SLICES=($(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=all -- . 2>/dev/null | sed 's/^...//' | sed 's/^"//; s/"$//' | grep -E '^src/features/[^/]+' | cut -d/ -f1-3 | sort -u || true))
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
  bash "$BLAST_CHECK" --reset --source=quality-gate-flag
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

# 2. Verify dependencies exist if package.json is present
if [ "$DRY_RUN" = false ] && [ -f "package.json" ] && [ ! -d "node_modules" ]; then
  echo ""
  echo "❌ [QUALITY GATE FAILED]: 'package.json' exists but 'node_modules/' directory is missing."
  echo "   Dependencies must be installed before running quality checks."
  echo "   Run 'npm install' or 'vp install' in the terminal."
  record_failure
  write_evidence "failed" "dependencies"
  emit_gate_telemetry "failed" 1
  exit 1
fi

# 3. Anti-Tampering & Code Integrity Gate (Delta-only, brownfield-safe)
if [ "$DRY_RUN" = false ] && [ "$GIT_OWNED" = true ]; then
  TAMPERING_VIOLATIONS=0

  # A. Check for new compiler/linter suppression comments in git diff (delta inspection)
  NEW_SUPPRESSIONS=()
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      NEW_SUPPRESSIONS+=("$line")
    fi
  done < <(git -C "$PROJECT_ROOT" diff HEAD -U0 -- 'src/*' 2>/dev/null | grep -E '^\+[^+]' | grep -E '(@ts-ignore|@ts-nocheck|eslint-disable|oxlint-disable)' || true)

  # Check untracked files under src/
  UNTRACKED_FILES=()
  while IFS= read -r ufile; do
    if [ -n "$ufile" ]; then
      UNTRACKED_FILES+=("$ufile")
    fi
  done < <(git -C "$PROJECT_ROOT" ls-files --others --exclude-standard 'src/*' 2>/dev/null | sed "s#^#$PROJECT_ROOT/#" || true)

  if [ ${#UNTRACKED_FILES[@]} -gt 0 ]; then
    while IFS= read -r line; do
      if [ -n "$line" ]; then
        NEW_SUPPRESSIONS+=("$line")
      fi
    done < <(grep -rnE '(@ts-ignore|@ts-nocheck|eslint-disable|oxlint-disable)' "${UNTRACKED_FILES[@]}" 2>/dev/null || true)
  fi

  if [ ${#NEW_SUPPRESSIONS[@]} -gt 0 ]; then
    echo ""
    echo "❌ [ANTI-TAMPERING VIOLATION]: Prohibited compiler/linter suppression comments added in code:"
    for sup in "${NEW_SUPPRESSIONS[@]}"; do
      echo "   $sup"
    done
    echo "   Using @ts-ignore, @ts-nocheck, eslint-disable, or oxlint-disable to bypass quality gates is forbidden."
    TAMPERING_VIOLATIONS=$((TAMPERING_VIOLATIONS + 1))
  fi

  # B. Check for weakening or deletion of quality rules in vite.config.ts / vitest.config.ts
  VITE_DELETIONS=$(git -C "$PROJECT_ROOT" diff HEAD -U0 -- 'vite.config.*' 'vitest.config.*' 2>/dev/null | grep -E '^\-[^-]' | grep -E "('complexity'|no-restricted-imports|max-lines-per-function|@shadcn/lint)" || true)
  if [ -n "$VITE_DELETIONS" ]; then
    echo ""
    echo "❌ [ANTI-TAMPERING VIOLATION]: Deleting or weakening quality rules in bundler config is prohibited:"
    echo "$VITE_DELETIONS"
    TAMPERING_VIOLATIONS=$((TAMPERING_VIOLATIONS + 1))
  fi

  # B2. ADDITIONS matter as much as deletions, and the delta check above only
  # greps removed lines. `ignorePatterns` is the cheapest bypass in the file: one
  # line takes whole trees away from the linter and the formatter, so the gate
  # grades an empty set and reports green. Same for switching the type check off
  # or retuning a rule to `off`/`warn`. A real run needed an addition here (the
  # jsdom test block), which is why that block now ships in the template instead:
  # the fix for "I need to edit the gate config" is the template, never the gate.
  VITE_ADDITIONS=$(git -C "$PROJECT_ROOT" diff HEAD -U0 -- 'vite.config.*' 'vitest.config.*' 2>/dev/null | grep -E '^\+[^+]' || true)
  if [ -n "$VITE_ADDITIONS" ]; then
    VITE_ADDED_BYPASS=$(printf '%s\n' "$VITE_ADDITIONS" | grep -E 'ignorePatterns' || true)
    VITE_TYPECHECK_OFF=$(printf '%s\n' "$VITE_ADDITIONS" | grep -E '(typeCheck|typeAware)[[:space:]]*:[[:space:]]*false' || true)
    VITE_RULE_DOWNGRADED=$(printf '%s\n' "$VITE_ADDITIONS" | grep -E '(complexity|max-lines-per-function|max-depth|max-params|max-statements|no-restricted-imports|no-multi-comp).*(off|warn)' || true)

    if [ -n "$VITE_ADDED_BYPASS" ] || [ -n "$VITE_TYPECHECK_OFF" ] || [ -n "$VITE_RULE_DOWNGRADED" ]; then
      echo ""
      echo "❌ [ANTI-TAMPERING VIOLATION]: Adding an exclusion, or disabling a check, in the bundler config is prohibited:"
      if [ -n "$VITE_ADDED_BYPASS" ]; then printf '%s\n' "$VITE_ADDED_BYPASS"; fi
      if [ -n "$VITE_TYPECHECK_OFF" ]; then printf '%s\n' "$VITE_TYPECHECK_OFF"; fi
      if [ -n "$VITE_RULE_DOWNGRADED" ]; then printf '%s\n' "$VITE_RULE_DOWNGRADED"; fi
      echo "   An exclusion narrows what the gate can see; that is the gate grading itself."
      echo "   If the change is legitimate, commit it: this check reads the working tree,"
      echo "   so a committed decision is audited history instead of an unrecorded edit."
      TAMPERING_VIOLATIONS=$((TAMPERING_VIOLATIONS + 1))
    fi
  fi

  # B3. The formatter reads `.prettierignore` and `.gitignore`, so an exclusion
  # there is `ignorePatterns` through another door: `src/` in either file takes the
  # whole application out of `vp check` and the gate grades an empty set. A real
  # run created an UNTRACKED `.prettierignore` (to stop the formatter rewriting the
  # auditor's report, a legitimate need) and nothing audited it. Checked whether the
  # file is tracked or not, because an untracked file never shows in a diff.
  #
  # Only patterns that exclude ALL of `src` count. A narrow carve-out such as
  # `src/legacy/` is a decision, not a bypass, and stays the project's to make.
  # Collected in an ARRAY, not in `$( ... )`: bash 3.2 (macOS) mis-parses a
  # multi-line `case` inside a command substitution and only fails at RUN time,
  # while `bash -n` accepts the same file.
  BROAD_SRC_EXCLUSIONS=()
  for ignore_file in .prettierignore .gitignore; do
    [ -f "$PROJECT_ROOT/$ignore_file" ] || continue
    while IFS= read -r exclude_line || [ -n "$exclude_line" ]; do
      exclude_trimmed="$(printf '%s' "$exclude_line" | tr -d '[:space:]')"
      [ -n "$exclude_trimmed" ] || continue
      if [ "${exclude_trimmed:0:1}" = "#" ]; then continue; fi
      case "$exclude_trimmed" in
        'src'|'src/'|'src/*'|'src/**'|'/src'|'/src/'|'/src/*'|'/src/**'|'*'|'**'|'**/*')
          BROAD_SRC_EXCLUSIONS+=("$ignore_file: $exclude_line")
          ;;
      esac
    done < "$PROJECT_ROOT/$ignore_file"
  done
  if [ "${#BROAD_SRC_EXCLUSIONS[@]}" -gt 0 ]; then
    echo ""
    echo "❌ [ANTI-TAMPERING VIOLATION]: An ignore file excludes the whole application from the formatter:"
    printf '   %s\n' "${BROAD_SRC_EXCLUSIONS[@]}"
    echo "   `vp check` reads .prettierignore and .gitignore, so this turns the formatting"
    echo "   check off for src/ instead of fixing the code."
    TAMPERING_VIOLATIONS=$((TAMPERING_VIOLATIONS + 1))
  fi

  # C. Check for neutralization of test/check scripts in package.json
  PKG_NEUTRALIZATIONS=$(git diff HEAD -U0 -- package.json 2>/dev/null | grep -E '^\+[^+]' | grep -E '"(test|check)"[[:space:]]*:[[:space:]]*"(echo\b|true\b|exit[[:space:]]+0\b|:|"")' || true)
  if [ -n "$PKG_NEUTRALIZATIONS" ]; then
    echo ""
    echo "❌ [ANTI-TAMPERING VIOLATION]: Neutralizing quality scripts in package.json is prohibited:"
    echo "$PKG_NEUTRALIZATIONS"
    TAMPERING_VIOLATIONS=$((TAMPERING_VIOLATIONS + 1))
  fi

  if [ $TAMPERING_VIOLATIONS -gt 0 ]; then
    echo ""
    echo "❌ [QUALITY GATE FAILED]: Code or gate tampering detected. Fix the root issues in application code."
    record_failure
    write_evidence "failed" "anti_tampering"
    emit_gate_telemetry "failed" 1
    exit 1
  fi
fi

# 4. Enforce centralized, typed environment variable access
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
    # A warning here is invisible inside a 30-minute repair window, and the
    # effect is a gate that silently does not run: exactly the "green means
    # nothing" failure this bundle exists to prevent. Treat a missing checker as
    # a broken install, not as an absent check.
    echo "❌ [QUALITY GATE FAILED]: check-env-config.sh is missing from the installed bundle."
    echo "   The environment gate cannot run, so it cannot be reported as passed."
    echo "   Reinstall the bundle (specify bundle install viteplus-stitch) and retry."
    write_evidence "failed" "env_config"
    emit_gate_telemetry "failed" 2
    exit 2
  fi
fi

# 3. Resolve Vite+ (vp) binary
VP_CMD=""
if command -v vp >/dev/null 2>&1; then
  VP_CMD="vp"
elif [ -x "./node_modules/.bin/vp" ]; then
  VP_CMD="./node_modules/.bin/vp"
elif command -v npx >/dev/null 2>&1; then
  # `vite-plus` ships THREE bins (vp, vpr, vpx), so npx cannot pick one from the
  # package name alone: `npx vite-plus vp check` dies with "could not determine
  # executable to run". `-p <pkg>` installs it and then runs the named bin.
  VP_CMD="npx -p vite-plus vp"
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
# Tee the tool output into a log we own: the evidence must be able to say what
# broke, not only that something did. `set -o pipefail` makes the pipeline report
# vp's status, so the guard below still sees the real exit code.
CHECK_LOG_FILE="${TMPDIR:-/tmp}/speckit-quality-check-$$.log"
: > "$CHECK_LOG_FILE" 2>/dev/null || true
if [ "$AUTO_FIX" = true ]; then
  $VP_CMD check --fix 2>&1 | tee "$CHECK_LOG_FILE" || CHECK_STATUS=$?
else
  $VP_CMD check 2>&1 | tee "$CHECK_LOG_FILE" || CHECK_STATUS=$?
fi

if [ $CHECK_STATUS -ne 0 ]; then
  record_failure
  capture_failure_output "$CHECK_LOG_FILE"
  rm -f "$CHECK_LOG_FILE" 2>/dev/null || true
  write_evidence "failed" "code_quality"
  emit_gate_telemetry "failed" "$CHECK_STATUS"
  echo ""
  echo "❌ [QUALITY GATE FAILED]: Violations detected in code (exit code: $CHECK_STATUS)."
  echo "Please fix the issues flagged by Vite+ before proceeding to the next phase."
  if [ -n "$FAILURE_OUTPUT" ]; then
    echo ""
    echo "--- output (tail; full log: ${EVIDENCE_DIR:-.}/${FAILURE_LOG:-quality-gate.log}) ---"
    printf '%s\n' "$FAILURE_OUTPUT"
  fi
  exit 1
fi

echo "✓ Code style, types, complexity, and architectural boundaries passed."

# 4. Run automated test suite (Regression Gate)
# A green suite only proves something when it actually executed tests. Zero tests
# is a FAILURE unless a human explicitly opts in with --allow-no-tests.

# Colourised and progress-aware reporters defeat naive parsing: a summary line can
# arrive as "\033[2m      Tests \033[22m 15 passed" (escape codes precede the label,
# so an anchored grep never matches) or be glued to a previous line by a bare "\r"
# (so the line does not start with the label either). Both are perfectly good
# summaries; normalise them before counting instead of declaring the report
# unparseable.
normalize_test_log() {
  sed -E $'s/\033\\[[0-9;?]*[a-zA-Z]//g' | tr '\r' '\n'
}

count_executed_tests() {
  local log="$1"
  if [ ! -f "$log" ]; then
    echo "unknown"
    return 0
  fi

  local clean
  clean="$(normalize_test_log < "$log")"

  if printf '%s\n' "$clean" | grep -qiE 'No test files found|No tests found|no tests to run'; then
    echo 0
    return 0
  fi

  local summary total
  summary="$(printf '%s\n' "$clean" | grep -E '^[[:space:]]*Tests:?[[:space:]]' | tail -n 1 || true)"
  if [ -z "$summary" ]; then
    # Unanchored fallback for reporters that prefix the summary with other text.
    summary="$(printf '%s\n' "$clean" | grep -E '(^|[[:space:]])Tests:?[[:space:]]+[0-9]+' | tail -n 1 || true)"
  fi
  if [ -n "$summary" ]; then
    # vitest: "Tests  12 passed (13)" -> the parenthesised value is the total.
    total="$(printf '%s' "$summary" | sed -nE 's/.*\(([0-9]+)\).*/\1/p')"
    if [ -z "$total" ]; then
      # jest: "Tests: 3 passed, 3 total"
      total="$(printf '%s' "$summary" | sed -nE 's/.*[,]?[[:space:]]([0-9]+)[[:space:]]+total.*/\1/p')"
    fi
    if [ -z "$total" ]; then
      total="$(printf '%s' "$summary" | grep -Eo '[0-9]+' | head -n 1 || true)"
    fi
    if [ -n "$total" ]; then
      echo "$total"
      return 0
    fi
  fi

  # mocha: "  7 passing"
  total="$(printf '%s\n' "$clean" | grep -Eo '[0-9]+ passing' | tail -n 1 | grep -Eo '[0-9]+' || true)"
  if [ -n "$total" ]; then
    echo "$total"
    return 0
  fi

  # node --test: "# pass 15"
  total="$(printf '%s\n' "$clean" | grep -E '^# pass[[:space:]]+[0-9]+' | tail -n 1 | grep -Eo '[0-9]+' || true)"
  if [ -n "$total" ]; then
    echo "$total"
    return 0
  fi

  echo "unknown"
}

if [ "$SKIP_TESTS" = false ]; then
  echo ""
  echo "Executing automated test suite (Regression Gate)..."

  TEST_CMD_ARGS=()
  TEST_SCOPE_MODE="append"
  # How the suite is run, in order of authority:
  #
  #   1. `vite-plus` declared in package.json -> the project IS a Vite+ project,
  #      so the built-in `vp test --run` (Vitest) is its native runner.
  #   2. a declared `test` script -> that is the project's own contract (Jest,
  #      Mocha, node --test, vitest...). Running it is the only correct choice for
  #      a project whose runner is not Vitest, so the script wins over the
  #      built-in (https://viteplus.dev/guide/run).
  #   3. test config files without a script -> built-in Vitest (`vp test --run`).
  #   4. a local vitest binary -> `vitest run` (no vp on PATH at all).
  #
  # `vite.config.ts` is NEVER proof that "this app is bundled by Vite": the
  # installer provisions that file as Vite+'s quality-config container for every
  # profile, including API-only projects that never install vite-plus. Its
  # presence only selects the fallback in step 3. `vite-plus` in package.json is
  # vp's own criterion for "this project uses vite-plus" (verified empirically:
  # without the dependency `vp test` warns and is not the project's contract).
  PKG_HAS_VITE_PLUS=false
  PKG_HAS_TEST_SCRIPT=false
  if [ -f "package.json" ]; then
    grep -q '"vite-plus"[[:space:]]*:' package.json && PKG_HAS_VITE_PLUS=true
    grep -q '"test"[[:space:]]*:' package.json && PKG_HAS_TEST_SCRIPT=true
  fi

  if [ "$PKG_HAS_VITE_PLUS" = true ]; then
    TEST_CMD_ARGS=($VP_CMD test --run)
  elif [ "$PKG_HAS_TEST_SCRIPT" = true ]; then
    if [ -n "$VP_CMD" ]; then
      # `vp run test` executes the declared script (args are forwarded verbatim).
      TEST_CMD_ARGS=($VP_CMD run test)
    else
      # npm needs `--` before forwarded args or it consumes them itself.
      TEST_CMD_ARGS=(npm test)
      TEST_SCOPE_MODE="after-double-dash"
    fi
  elif [ -f "vitest.config.ts" ] || [ -f "vitest.config.js" ] || [ -f "vite.config.ts" ]; then
    TEST_CMD_ARGS=($VP_CMD test --run)
  elif [ -x "./node_modules/.bin/vitest" ]; then
    TEST_CMD_ARGS=(./node_modules/.bin/vitest run)
  fi

  if [ ${#TEST_CMD_ARGS[@]} -gt 0 ]; then
    if [ -n "$SCOPE_DIR" ]; then
      echo "ℹ️  Scoped regression check active: filtering test execution to '$SCOPE_DIR'"
      if [ "$TEST_SCOPE_MODE" = "after-double-dash" ]; then
        TEST_CMD_ARGS+=(-- "$SCOPE_DIR")
      else
        TEST_CMD_ARGS+=("$SCOPE_DIR")
      fi
    fi
    echo "✓ Test runner detected: ${TEST_CMD_ARGS[*]}"

    TEST_LOG="$(mktemp "${TMPDIR:-/tmp}/speckit-tests-XXXXXX" 2>/dev/null || printf '%s/speckit-tests-%s.log' "${TMPDIR:-/tmp}" "$$")"
    TEST_STATUS=0
    # CI=1 keeps a script that defaults to watch mode from hanging the gate, so a
    # `"test": "vp test"` / `vitest` script still exits after one run.
    CI="${CI:-1}" "${TEST_CMD_ARGS[@]}" 2>&1 | tee "$TEST_LOG" || TEST_STATUS=${PIPESTATUS[0]}

    TESTS_EXECUTED="$(count_executed_tests "$TEST_LOG")"

    if [ $TEST_STATUS -ne 0 ]; then
      record_failure
      write_evidence "failed" "regression_tests"
      emit_gate_telemetry "failed" "$TEST_STATUS"
      rm -f "$TEST_LOG"
      echo ""
      echo "❌ [QUALITY GATE FAILED]: Test suite failed with regressions (exit code: $TEST_STATUS)."
      echo "Please fix the failing tests before proceeding to the next phase."
      exit 1
    fi

    if [ "$TESTS_EXECUTED" = "0" ]; then
      if [ "$ALLOW_NO_TESTS" = true ]; then
        echo "⚠️  [REGRESSION GATE]: zero tests executed; allowed by --allow-no-tests (evidence: skipped)."
        REGRESSION_OVERRIDE="skipped"
      else
        record_failure
        write_evidence "failed" "regression_tests"
        emit_gate_telemetry "failed" 1
        rm -f "$TEST_LOG"
        echo ""
        echo "❌ [QUALITY GATE FAILED]: the test suite executed ZERO tests."
        echo "   A green run with nothing to test proves nothing. Write the co-located tests"
        echo "   for the feature before claiming completion."
        echo "   If this project has no test suite by design, a human must opt in with --allow-no-tests."
        exit 1
      fi
    elif [ "$TESTS_EXECUTED" = "unknown" ]; then
      record_failure
      write_evidence "failed" "regression_tests"
      emit_gate_telemetry "failed" 1
      rm -f "$TEST_LOG"
      echo ""
      echo "❌ [QUALITY GATE FAILED]: could not determine how many tests were executed."
      echo "   The gate refuses to treat an unparseable test report as a pass."
      echo "   Use a runner with a standard summary line, or pass --allow-no-tests to opt out explicitly."
      exit 1
    else
      echo "✓ Test suite passed: $TESTS_EXECUTED test(s) executed with zero regressions."
    fi
    rm -f "$TEST_LOG"
  else
    echo "ℹ️  No test runner or test suite configured."
    if [ "$ALLOW_NO_TESTS" = true ]; then
      echo "⚠️  [REGRESSION GATE]: no test runner found; allowed by --allow-no-tests (evidence: skipped)."
      REGRESSION_OVERRIDE="skipped"
    else
      record_failure
      write_evidence "failed" "regression_tests"
      emit_gate_telemetry "failed" 1
      echo ""
      echo "❌ [QUALITY GATE FAILED]: no test runner or test suite was found."
      echo "   Install a runner and add tests, or pass --allow-no-tests for a human-approved exemption."
      exit 1
    fi
  fi
else
  echo "ℹ️  --skip-tests flag specified; skipping regression tests (evidence: skipped)."
fi

# 5. Build and compile application (Build Gate)
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "Executing application build and compilation (Build Gate)..."

  BUILD_CMD=""
  # Built-in vs script (https://viteplus.dev/guide/run): `vp build` ALWAYS runs the
  # built-in Vite production build and ignores the project's `build` script. In a
  # project whose bundler is not Vite (Next, Nuxt, Astro, Remix), that is the wrong
  # build, so the declared script wins. `vp build` stays as the fallback for a Vite
  # project that has no build script of its own.
  if [ -f "package.json" ] && grep -q '"build":' package.json; then
    if [ -n "$VP_CMD" ]; then
      BUILD_CMD="$VP_CMD run build"
    else
      BUILD_CMD="npm run build"
    fi
  elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
    if command -v vp >/dev/null 2>&1; then
      BUILD_CMD="vp build"
    elif [ -x "./node_modules/.bin/vp" ]; then
      BUILD_CMD="./node_modules/.bin/vp build"
    elif [ -x "./node_modules/.bin/vite" ]; then
      BUILD_CMD="./node_modules/.bin/vite build"
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
