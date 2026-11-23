#!/usr/bin/env bash
# ==============================================================================
# verify-stitch-design.sh
# ------------------------------------------------------------------------------
# Visual Quality Gate using Playwright against frozen Google Stitch screenshots.
# Verifies:
#   1. Existence of the current feature designs directory.
#   2. Alignment of CSS variables and design tokens in the DOM.
#   3. Visual snapshot comparison (toHaveScreenshot) with calibrated tolerance (0.05).
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: verify-stitch-design.sh [options]

Playwright visual verification gate against Google Stitch screenshots.

Options:
  --help                    Show this help message
  --feature-dir=<path>      Path to the feature directory (e.g. specs/001-feature)
  --tokens-only             Validate tokens.css structure without launching Playwright
  --update-snapshots        Update canonical snapshots if design was intentionally modified
  --skip-orphans            Skip orphan UI component detection during contract check
  --require-ui              Fail if UI/Stitch designs are missing (do not skip)
  --evidence-dir=<path>     Directory to write machine evidence JSON (default: <feature-dir>/evidence)
  --scope=<path>            Feature slice scope

Exit Codes:
  0                         All visual tests passed or UI verification does not apply
  1                         Visual differences detected above tolerance threshold, or UI artifacts missing when required
  2                         Failure running Playwright or configuration error
EOF
}

FEATURE_DIR=""
UPDATE_SNAPSHOTS=false
TOKENS_ONLY=false
SKIP_ORPHANS=false
REQUIRE_UI=false
EVIDENCE_DIR=""
SCOPE_DIR=""

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --tokens-only)
      TOKENS_ONLY=true
      ;;
    --update-snapshots)
      UPDATE_SNAPSHOTS=true
      ;;
    --skip-orphans)
      SKIP_ORPHANS=true
      ;;
    --require-ui)
      REQUIRE_UI=true
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --scope=*)
      SCOPE_DIR="${arg#*=}"
      ;;
    *)
      ;;
  esac
done

# Resolve UI requirement from environment variable if not passed as CLI argument
if [ "$REQUIRE_UI" = false ] && [ -n "${SPECIFY_HAS_UI:-}" ]; then
  if [ "$SPECIFY_HAS_UI" = "true" ] || [ "$SPECIFY_HAS_UI" = "1" ]; then
    REQUIRE_UI=true
  fi
fi

# Resolve feature directory from environment variable if not passed as CLI argument
if [ -z "$FEATURE_DIR" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi

# Autodetect feature directory if not provided
if [ -z "$FEATURE_DIR" ]; then
  if [ -d "specs" ]; then
    FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
  fi
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
      --gate="verify-stitch-design" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${SCOPE_DIR:+--scope="$SCOPE_DIR"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/stitch-design.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  local tokens_count="$2"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const [outPath, status, tokensCount, featDir, tokensOnly] = process.argv.slice(1);
        const data = {
          timestamp: new Date().toISOString(),
          gate: "verify-stitch-design",
          status,
          reason: status === "skipped" ? "no_ui_declared" : undefined,
          tokens_count: Number(tokensCount) || 0,
          feature_dir: featDir || undefined,
          tokens_only: tokensOnly === "true",
          evidence_type: "visual_design_tokens"
        };
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
      ' "$EVIDENCE_DIR/stitch-design.json" "$status" "$tokens_count" "$FEATURE_DIR" "$TOKENS_ONLY" 2>/dev/null || true
    fi
  fi
}

echo "======================================================================"
echo "[VISUAL GATE] Starting Playwright Stitch visual validation"
echo "======================================================================"

if [ -z "$FEATURE_DIR" ] || [ ! -d "$FEATURE_DIR/designs" ]; then
  if [ "$REQUIRE_UI" = true ]; then
    echo "❌ [VISUAL GATE FAILED]: UI verification is required (--require-ui or SPECIFY_HAS_UI=true),"
    echo "   but designs directory does not exist: '${FEATURE_DIR:-none}/designs'."
    echo "   Every feature with UI must generate Stitch screens, tokens.css, and routes-manifest.json."
    emit_gate_telemetry "failed" 1
    write_evidence "failed" 0
    exit 1
  fi
  echo "ℹ️  [VISUAL GATE]: No designs directory found in feature (${FEATURE_DIR:-none})."
  echo "ℹ️  Skipping visual verification (no UI / Stitch designs declared)."
  write_evidence "skipped" 0
  emit_gate_telemetry "skipped" 0
  exit 0
fi

echo "✓ Design directory found: $FEATURE_DIR/designs"

# Strictly validate the Stitch token source of truth before rendering.
TOKENS_FILE="$FEATURE_DIR/designs/tokens.css"
HAS_UI_ARTIFACTS=false
if [ -f "$FEATURE_DIR/designs/routes-manifest.json" ] || [ -n "$(find "$FEATURE_DIR/designs" -maxdepth 1 -type f -name '*.png' -print -quit 2>/dev/null)" ]; then
  HAS_UI_ARTIFACTS=true
fi

if [ ! -f "$TOKENS_FILE" ]; then
  if [ "$HAS_UI_ARTIFACTS" = true ] || [ "$REQUIRE_UI" = true ]; then
    echo "❌ [VISUAL GATE FAILED]: Stitch UI artifacts exist (or UI is required) but tokens.css is missing."
    echo "   tokens.css is the canonical design-token source of truth generated by Stitch."
    emit_gate_telemetry "failed" 1
    write_evidence "failed" 0
    exit 1
  fi
  echo "ℹ️  [VISUAL GATE]: No tokens.css found and no UI artifacts declared."
  echo "ℹ️  Skipping visual verification (no UI / Stitch designs declared)."
  write_evidence "skipped" 0
  emit_gate_telemetry "skipped" 0
  exit 0
fi

TOKEN_COUNT="$(grep -oE -- '--[A-Za-z0-9_-]+[[:space:]]*:' "$TOKENS_FILE" 2>/dev/null | wc -l | tr -d '[:space:]' || true)"
TOKEN_COUNT="${TOKEN_COUNT:-0}"
if [ "$TOKEN_COUNT" -eq 0 ]; then
  echo "❌ [VISUAL GATE FAILED]: tokens.css does not declare any CSS custom properties."
  echo "   Stitch must provide at least one --design-token: value declaration."
  emit_gate_telemetry "failed" 1
  write_evidence "failed" 0
  exit 1
fi

echo "✓ tokens.css declares $TOKEN_COUNT design token(s)"

if [ "$TOKENS_ONLY" = true ]; then
  echo ""
  echo "✅ [VISUAL GATE PASSED]: Stitch tokens.css structure is valid."
  write_evidence "passed" "$TOKEN_COUNT"
  emit_gate_telemetry "passed" 0
  exit 0
fi

# Validate route and component contracts before launching Playwright
CONTRACT_SCRIPT="$SCRIPT_DIR/check-contracts.sh"
if [ -f "$CONTRACT_SCRIPT" ]; then
  CONTRACT_FLAGS=("--feature-dir=$FEATURE_DIR" "--check-atomic")
  if [ "$SKIP_ORPHANS" = false ]; then
    CONTRACT_FLAGS+=("--check-orphans")
  fi
  if [ -n "$SCOPE_DIR" ]; then
    CONTRACT_FLAGS+=("--scope=$SCOPE_DIR")
  fi
  if ! bash "$CONTRACT_SCRIPT" "${CONTRACT_FLAGS[@]}"; then
    echo ""
    echo "❌ [VISUAL GATE FAILED]: Route or component contract violations detected."
    exit 1
  fi
fi

# Verify Playwright
if ! command -v npx >/dev/null 2>&1; then
  echo "⚠️ [VISUAL GATE ERROR]: 'npx' is not available to run Playwright."
  exit 2
fi

PW_FLAGS=""
if [ "$UPDATE_SNAPSHOTS" = true ]; then
  PW_FLAGS="--update-snapshots"
fi

CONFIG_FILE="playwright.design.config.ts"
if [ ! -f "$CONFIG_FILE" ] && [ -f ".specify/templates/playwright.design.config.ts" ]; then
  CONFIG_FILE=".specify/templates/playwright.design.config.ts"
fi

echo "Executing visual fidelity tests..."
PW_STATUS=0
FEATURE_DIR="$FEATURE_DIR" npx playwright test --config="$CONFIG_FILE" $PW_FLAGS || PW_STATUS=$?

if [ $PW_STATUS -ne 0 ]; then
  echo ""
  echo "❌ [VISUAL GATE FAILED]: Render does not match Stitch design."
  echo "Review the difference report generated by Playwright."
  emit_gate_telemetry "failed" 1
  write_evidence "failed" "$TOKEN_COUNT"
  exit 1
fi

echo ""
echo "✅ [VISUAL GATE PASSED]: Implementation matches Stitch design faithfully."
write_evidence "passed" "$TOKEN_COUNT"
emit_gate_telemetry "passed" 0
exit 0
