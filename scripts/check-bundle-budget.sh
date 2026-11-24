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
#
# Brownfield awareness:
#   - Budgets can come from CLI flags, environment variables, or an optional
#     `.bundle-budget.json` config file (CLI > env > config > defaults).
#   - The TOTAL budget is grandfathered: when dist/ already exceeds it and no
#     baseline is recorded, the check is skipped with a warning instead of
#     blocking the agent on inherited dependency weight. Record a baseline
#     (`baselineTotalKb`) to enforce "no growth" from that point on. Use
#     BUNDLE_STRICT=true (or "strict": true) to always enforce the total budget.
#   - Legacy chunks can be excluded from the per-chunk budget with
#     `ignoreChunks` (glob patterns) so inherited vendor bundles do not fail the
#     agent's own chunks. The agent's new chunks are still enforced.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

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
  --baseline-total-kb=<N> Known pre-existing total size in KB (grandfathered debt)
  --strict                Always enforce the total budget, even without a baseline
  --feature-dir=<path>    Feature directory (e.g. specs/001-feature)
  --evidence-dir=<path>   Directory to write machine evidence JSON (default: <feature-dir>/evidence)

Environment variables (override defaults, below CLI flags):
  BUNDLE_MAX_CHUNK_KB     Per-chunk budget in KB
  BUNDLE_MAX_TOTAL_KB     Total bundle budget in KB
  BUNDLE_BASELINE_TOTAL_KB Pre-existing total size in KB
  BUNDLE_TOLERANCE_KB     Allowed growth over the baseline in KB (default: 25)
  BUNDLE_IGNORE_CHUNKS    Comma-separated glob patterns of legacy chunks to exempt
  BUNDLE_DIST_DIR         Distribution directory
  BUNDLE_STRICT           "true" to always enforce the total budget
  BUNDLE_BUDGET_CONFIG    Config file path (default: .bundle-budget.json)

Config file (.bundle-budget.json, optional):
  {
    "maxChunkKb": 250,
    "maxTotalKb": 1000,
    "baselineTotalKb": 1450,
    "toleranceKb": 25,
    "ignoreChunks": ["vendor-three-*.js"],
    "strict": false
  }

Exit Codes:
  0                       All bundle assets are within budget
  1                       Bundle size exceeds performance budget
  2                       Build error or missing distribution directory
EOF
}

MAX_CHUNK_KB=250
MAX_TOTAL_KB=1000
DIST_DIR="dist"
BASELINE_TOTAL_KB=""
TOLERANCE_KB=25
IGNORE_CHUNKS=""
STRICT=false
DRY_RUN=false
SKIP_BUILD=false

# 1. Optional project config file (lowest precedence)
BUDGET_CONFIG_FILE="${BUNDLE_BUDGET_CONFIG:-.bundle-budget.json}"
if [ -f "$BUDGET_CONFIG_FILE" ] && command -v node >/dev/null 2>&1; then
  CONFIG_VALUES="$(
    node -e '
      const fs = require("fs");
      try {
        const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const numeric = (key) => {
          const value = cfg[key];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            console.log(`${key}=${Math.floor(value)}`);
          }
        };
        numeric("maxChunkKb");
        numeric("maxTotalKb");
        numeric("baselineTotalKb");
        numeric("toleranceKb");
        if (Array.isArray(cfg.ignoreChunks)) {
          const patterns = cfg.ignoreChunks.filter((item) => typeof item === "string" && item.trim() !== "");
          if (patterns.length > 0) console.log(`ignoreChunks=${patterns.join(",")}`);
        }
        if (cfg.strict === true) console.log("strict=true");
      } catch (err) {
        console.error(`Invalid bundle budget config: ${err.message}`);
        process.exit(0);
      }
    ' "$BUDGET_CONFIG_FILE" 2>/dev/null || true
  )"
  while IFS='=' read -r key value; do
    case "$key" in
      maxChunkKb) MAX_CHUNK_KB="$value" ;;
      maxTotalKb) MAX_TOTAL_KB="$value" ;;
      baselineTotalKb) BASELINE_TOTAL_KB="$value" ;;
      toleranceKb) TOLERANCE_KB="$value" ;;
      ignoreChunks) IGNORE_CHUNKS="$value" ;;
      strict) STRICT="$value" ;;
    esac
  done <<< "$CONFIG_VALUES"
  if [ -n "$CONFIG_VALUES" ]; then
    echo "ℹ️  Loaded bundle budgets from $BUDGET_CONFIG_FILE"
  fi
fi

# 2. Environment variables (override config)
[ -n "${BUNDLE_MAX_CHUNK_KB:-}" ] && MAX_CHUNK_KB="$BUNDLE_MAX_CHUNK_KB"
[ -n "${BUNDLE_MAX_TOTAL_KB:-}" ] && MAX_TOTAL_KB="$BUNDLE_MAX_TOTAL_KB"
[ -n "${BUNDLE_BASELINE_TOTAL_KB:-}" ] && BASELINE_TOTAL_KB="$BUNDLE_BASELINE_TOTAL_KB"
[ -n "${BUNDLE_TOLERANCE_KB:-}" ] && TOLERANCE_KB="$BUNDLE_TOLERANCE_KB"
[ -n "${BUNDLE_IGNORE_CHUNKS:-}" ] && IGNORE_CHUNKS="$BUNDLE_IGNORE_CHUNKS"
[ -n "${BUNDLE_DIST_DIR:-}" ] && DIST_DIR="$BUNDLE_DIST_DIR"
[ "${BUNDLE_STRICT:-}" = "true" ] && STRICT=true

FEATURE_DIR=""
EVIDENCE_DIR=""

# 3. CLI flags (highest precedence)
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
    --strict)
      STRICT=true
      ;;
    --max-chunk-kb=*)
      MAX_CHUNK_KB="${arg#*=}"
      ;;
    --max-total-kb=*)
      MAX_TOTAL_KB="${arg#*=}"
      ;;
    --baseline-total-kb=*)
      BASELINE_TOTAL_KB="${arg#*=}"
      ;;
    --dist-dir=*)
      DIST_DIR="${arg#*=}"
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    *)
      ;;
  esac
done

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
      --gate="check-bundle-budget" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/bundle-budget.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const [outPath, status, maxChunk, largestChunk, largestName, maxTotal, totalKb, violations, grandfathered] = process.argv.slice(1);
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-bundle-budget",
          status,
          previous_status: previousStatus,
          metrics: {
            max_chunk_kb: Number(maxChunk) || 0,
            largest_chunk_kb: Number(largestChunk) || 0,
            largest_chunk_name: largestName || undefined,
            max_total_kb: Number(maxTotal) || 0,
            total_bundle_kb: Number(totalKb) || 0,
            violations: Number(violations) || 0,
            grandfathered: grandfathered === "true"
          },
          evidence_type: "production_bundle_budget"
        };
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
        // Append-only, but only on state changes: repeated identical outcomes
        // do not grow the history (the timestamp is not part of the payload).
        // Execution frequency lives in .specify/telemetry.jsonl, not here.
        const historyPath = outPath.replace(/\.json$/, ".history.jsonl");
        const comparable = (entry) => {
          // timestamp and previous_status are bookkeeping, not state.
          const { timestamp, previous_status, ...rest } = entry;
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
      ' "$EVIDENCE_DIR/bundle-budget.json" "$status" "$MAX_CHUNK_KB" "$LARGEST_CHUNK_KB" "$LARGEST_CHUNK_NAME" "$MAX_TOTAL_KB" "$TOTAL_KB" "$VIOLATIONS" "$TOTAL_SKIPPED" 2>/dev/null || true
    fi
  fi
}

echo "======================================================================"
echo "[PERFORMANCE GATE] Checking Production Bundle Budget"
echo "======================================================================"

# 1. Execute production build if not skipped
if [ "$SKIP_BUILD" = false ]; then
  if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
    echo ""
    echo "❌ [PERFORMANCE GATE FAILED]: 'package.json' exists but 'node_modules/' is missing."
    echo "   Dependencies must be installed before running production build."
    write_evidence "failed"
    emit_gate_telemetry "failed" 1
    exit 1
  fi

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
      write_evidence "failed"
      emit_gate_telemetry "failed" "$BUILD_STATUS"
      exit 2
    fi
  else
    echo "ℹ️  No build tool or script detected; inspecting existing $DIST_DIR directory."
  fi
fi

if [ ! -d "$DIST_DIR" ]; then
  echo "ℹ️  No distribution directory ($DIST_DIR) found."
  echo "ℹ️  Skipping bundle budget verification."
  emit_gate_telemetry "skipped" 0
  exit 0
fi

# 2. Inspect chunks in dist/
echo "Analyzing asset sizes in $DIST_DIR (Budget: max chunk ${MAX_CHUNK_KB}KB, total ${MAX_TOTAL_KB}KB)..."
if [ -n "$IGNORE_CHUNKS" ]; then
  echo "ℹ️  Grandfathered legacy chunks (glob): $IGNORE_CHUNKS"
fi

TOTAL_BYTES=0
LARGEST_CHUNK_BYTES=0
LARGEST_CHUNK_NAME=""
VIOLATIONS=0
IGNORED_COUNT=0

is_ignored_chunk() {
  local base="$1"
  [ -z "$IGNORE_CHUNKS" ] && return 1
  local patterns=()
  IFS=',' read -r -a patterns <<< "$IGNORE_CHUNKS"
  local pattern
  for pattern in "${patterns[@]}"; do
    pattern="${pattern#"${pattern%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [ -z "$pattern" ] && continue
    # Unquoted on purpose: glob matching against the asset file name.
    case "$base" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

# Loop over JS and CSS assets
while IFS= read -r -d '' asset; do
  BYTES=$(wc -c < "$asset" | tr -d '[:space:]')
  KB=$((BYTES / 1024))
  TOTAL_BYTES=$((TOTAL_BYTES + BYTES))

  if is_ignored_chunk "$(basename "$asset")"; then
    IGNORED_COUNT=$((IGNORED_COUNT + 1))
    echo "ℹ️  Exempted legacy chunk (per-chunk budget skipped): $asset (${KB}KB)"
    continue
  fi

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
if [ "$IGNORED_COUNT" -gt 0 ]; then
  echo "ℹ️  Legacy chunks exempted from the per-chunk budget: $IGNORED_COUNT"
fi

TOTAL_SKIPPED=false

if [ "$TOTAL_KB" -gt "$MAX_TOTAL_KB" ]; then
  if [ -n "$BASELINE_TOTAL_KB" ]; then
    ALLOWED_TOTAL_KB=$((BASELINE_TOTAL_KB + TOLERANCE_KB))
    if [ "$TOTAL_KB" -le "$ALLOWED_TOTAL_KB" ]; then
      echo "⚠️  [BROWNFIELD BUDGET]: total ${TOTAL_KB}KB exceeds the ${MAX_TOTAL_KB}KB budget but stays"
      echo "    within the inherited baseline (${BASELINE_TOTAL_KB}KB + ${TOLERANCE_KB}KB tolerance = ${ALLOWED_TOTAL_KB}KB)."
      echo "    Treated as pre-existing debt: no regression introduced."
      TOTAL_SKIPPED=true
    else
      echo "❌ [BUDGET VIOLATION]: Total bundle size (${TOTAL_KB}KB) grows beyond the inherited baseline"
      echo "   (${BASELINE_TOTAL_KB}KB + ${TOLERANCE_KB}KB tolerance = ${ALLOWED_TOTAL_KB}KB)."
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  elif [ "$STRICT" = true ]; then
    echo "❌ [BUDGET VIOLATION]: Total bundle size (${TOTAL_KB}KB) exceeds total budget (${MAX_TOTAL_KB}KB)."
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "⚠️  [BROWNFIELD BUDGET]: total ${TOTAL_KB}KB already exceeds the ${MAX_TOTAL_KB}KB budget and no"
    echo "    baseline is recorded, so this inherited overage does not block the agent."
    echo "    Make it enforceable from now on (no-growth gate):"
    echo "      BUNDLE_BASELINE_TOTAL_KB=${TOTAL_KB} bash scripts/check-bundle-budget.sh"
    echo "      or add \"baselineTotalKb\": ${TOTAL_KB} to .bundle-budget.json"
    echo "    Raise the budget with --max-total-kb=<N> / BUNDLE_MAX_TOTAL_KB=<N>, or force"
    echo "    enforcement with --strict / BUNDLE_STRICT=true."
    TOTAL_SKIPPED=true
  fi
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "⚠️ [PERFORMANCE GATE DRY-RUN]: $VIOLATIONS budget violation(s) detected (dry-run mode)."
    write_evidence "passed"
    emit_gate_telemetry "passed" 0
    exit 0
  else
    echo ""
    echo "❌ [PERFORMANCE GATE FAILED]: $VIOLATIONS bundle budget violation(s) detected."
    echo "   Ensure code splitting, dynamic imports, and treeshaking are properly configured,"
    echo "   and remove heavyweight or unused dependencies."
    write_evidence "failed"
    emit_gate_telemetry "failed" 1
    exit 1
  fi
fi

echo ""
if [ "$TOTAL_SKIPPED" = true ]; then
  echo "⚠️ [PERFORMANCE GATE PASSED WITH WARNINGS]: chunk budgets respected; total budget grandfathered."
else
  echo "✅ [PERFORMANCE GATE PASSED]: Bundle size is strictly within budget."
fi
write_evidence "passed"
emit_gate_telemetry "passed" 0
exit 0
