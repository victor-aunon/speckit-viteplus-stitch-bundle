#!/usr/bin/env bash
# ==============================================================================
# check-design-artifacts.sh
# ------------------------------------------------------------------------------
# Deterministic design-artifact gate.
#
# `generate-designs` is a prompt: it can finish without writing anything, and the
# failure then surfaces only after implementation, when --require-ui gates run.
# This gate fails in seconds, before any code is written, with a precise list of
# what is missing.
#
# Required when a feature declares UI:
#   designs/tokens.css            non-empty, declares at least one --token: value
#   designs/routes-manifest.json  valid JSON, non-empty screens with id/route/selector
#   designs/<screen>.html         at least one screen
#   declared fixtures             every fixture path referenced by the manifest exists
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: check-design-artifacts.sh [options]

Fails when the design artifacts required by the UI gates are missing or invalid.

Options:
  --help                 Show this help message
  --feature-dir=<path>   Feature directory (default: newest under specs/)
  --designs-dir=<path>   Designs directory (default: <feature-dir>/designs)
  --allow-missing        Do not fail when there is no designs directory (evidence: skipped)
  --evidence-dir=<path>  Directory to write machine evidence JSON
  --dry-run              Report problems without failing

Exit Codes:
  0                      Artifacts are present and valid (or skipped)
  1                      Missing or invalid design artifacts
  2                      Invalid configuration
EOF
}

FEATURE_DIR=""
DESIGNS_DIR=""
ALLOW_MISSING=false
EVIDENCE_DIR=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --designs-dir=*)
      DESIGNS_DIR="${arg#*=}"
      ;;
    --allow-missing)
      ALLOW_MISSING=true
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      ;;
  esac
done

if [ -z "$FEATURE_DIR" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi

if [ -z "$FEATURE_DIR" ] && [ -z "$DESIGNS_DIR" ] && [ -d "specs" ]; then
  FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
fi

if [ -z "$DESIGNS_DIR" ] && [ -n "$FEATURE_DIR" ]; then
  DESIGNS_DIR="$FEATURE_DIR/designs"
fi

if [ -z "$EVIDENCE_DIR" ] && [ -n "$FEATURE_DIR" ] && [ -d "$FEATURE_DIR" ]; then
  EVIDENCE_DIR="$FEATURE_DIR/evidence"
fi

START_TIME=$(date +%s 2>/dev/null || echo 0)

emit_gate_telemetry() {
  local status="$1"
  local code="$2"
  local details="$3"
  local end_time=$(date +%s 2>/dev/null || echo 0)
  local dur=$(( (end_time - START_TIME) * 1000 ))
  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --gate="check-design-artifacts" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${details:+--details="$details"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/design-artifacts.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  local missing_json="$2"
  local tokens_count="$3"
  local screens_count="$4"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      EV_DESIGNS_DIR="$DESIGNS_DIR" \
      EV_FEATURE_DIR="$FEATURE_DIR" \
      node -e '
        const fs = require("fs");
        const [outPath, status, missingJson, tokensCount, screensCount] = process.argv.slice(1);
        let missing = [];
        try { missing = JSON.parse(missingJson || "[]"); } catch {}
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-design-artifacts",
          status,
          previous_status: previousStatus,
          reason: status === "skipped" ? "no_designs_declared" : undefined,
          designs_dir: process.env.EV_DESIGNS_DIR || undefined,
          feature_dir: process.env.EV_FEATURE_DIR || undefined,
          tokens_count: Number(tokensCount) || 0,
          screens_count: Number(screensCount) || 0,
          missing,
          evidence_type: "design_artifacts"
        };
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
        const historyPath = outPath.replace(/\.json$/, ".history.jsonl");
        const comparable = (entry) => {
          const { timestamp, previous_status, ...rest } = entry;
          return JSON.stringify(rest);
        };
        let lastHistory = "";
        try {
          const lines = fs.readFileSync(historyPath, "utf8").split("\n").filter(Boolean);
          if (lines.length > 0) lastHistory = lines[lines.length - 1];
        } catch {}
        let changed = true;
        if (lastHistory) {
          try { changed = comparable(JSON.parse(lastHistory)) !== comparable(data); } catch { changed = true; }
        }
        if (changed) fs.appendFileSync(historyPath, JSON.stringify(data) + "\n", "utf8");
      ' "$EVIDENCE_DIR/design-artifacts.json" "$status" "$missing_json" "$tokens_count" "$screens_count" 2>/dev/null || true
    fi
  fi
}

echo "======================================================================"
echo "[DESIGN GATE] Verifying design artifacts"
echo "======================================================================"

if [ -z "$DESIGNS_DIR" ] || [ ! -d "$DESIGNS_DIR" ]; then
  if [ "$ALLOW_MISSING" = true ]; then
    echo "ℹ️  No designs directory found (${DESIGNS_DIR:-none}); allowed by --allow-missing (evidence: skipped)."
    write_evidence "skipped" "[]" 0 0
    emit_gate_telemetry "skipped" 0 '{"reason":"allowed_missing"}'
    exit 0
  fi
  echo "❌ [DESIGN GATE FAILED]: designs directory not found: '${DESIGNS_DIR:-none}'."
  echo "   A UI feature must generate screens, tokens.css and routes-manifest.json."
  echo "   Local wireframe HTML is a valid fallback when Stitch is disabled."
  write_evidence "failed" '["designs_dir"]' 0 0
  emit_gate_telemetry "failed" 1 '{"missing":["designs_dir"]}'
  exit 1
fi

MISSING=()

TOKENS_FILE="$DESIGNS_DIR/tokens.css"
TOKENS_COUNT=0
if [ ! -f "$TOKENS_FILE" ]; then
  MISSING+=("tokens.css")
else
  TOKENS_COUNT="$(grep -oE -- '--[A-Za-z0-9_-]+[[:space:]]*:' "$TOKENS_FILE" 2>/dev/null | wc -l | tr -d '[:space:]' || true)"
  TOKENS_COUNT="${TOKENS_COUNT:-0}"
  if [ "$TOKENS_COUNT" -eq 0 ]; then
    echo "❌ [DESIGN GATE]: tokens.css declares no CSS custom properties."
    MISSING+=("tokens.css:no_tokens")
  fi
fi

SCREENS_COUNT="$(find "$DESIGNS_DIR" -maxdepth 1 -type f -name '*.html' 2>/dev/null | wc -l | tr -d '[:space:]' || true)"
SCREENS_COUNT="${SCREENS_COUNT:-0}"
if [ "$SCREENS_COUNT" -eq 0 ]; then
  MISSING+=("screens_html")
fi

MANIFEST_FILE="$DESIGNS_DIR/routes-manifest.json"
if [ ! -f "$MANIFEST_FILE" ]; then
  MISSING+=("routes-manifest.json")
else
  MANIFEST_STATUS=0
  MANIFEST_OUTPUT="$(node - "$MANIFEST_FILE" "$DESIGNS_DIR" << 'NODE_SCRIPT' 2>&1
const fs = require('fs');
const path = require('path');
const [file, designsDir] = process.argv.slice(2);
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.log(`invalid JSON: ${err.message}`);
  process.exit(1);
}
if (!manifest || !Array.isArray(manifest.screens) || manifest.screens.length === 0) {
  console.log('screens must be a non-empty array');
  process.exit(1);
}
const problems = [];
manifest.screens.forEach((screen, index) => {
  const label = screen && screen.id ? screen.id : `screen[${index}]`;
  if (!screen || typeof screen.id !== 'string' || screen.id.trim() === '') problems.push(`${label}: missing "id"`);
  if (!screen || typeof screen.route !== 'string' || !screen.route.startsWith('/')) problems.push(`${label}: "route" must start with "/"`);
  if (!screen || typeof screen.selector !== 'string' || screen.selector.trim() === '') problems.push(`${label}: missing "selector"`);
  if (screen && screen.fixtures && typeof screen.fixtures === 'object') {
    for (const [endpoint, fixturePath] of Object.entries(screen.fixtures)) {
      const candidate = path.resolve(designsDir, fixturePath);
      if (!fs.existsSync(candidate)) problems.push(`${label}: fixture for "${endpoint}" not found: ${fixturePath}`);
    }
  }
});
if (problems.length > 0) {
  console.log(problems.join('; '));
  process.exit(1);
}
process.exit(0);
NODE_SCRIPT
)" || MANIFEST_STATUS=$?
  if [ "$MANIFEST_STATUS" -ne 0 ]; then
    echo "❌ [DESIGN GATE]: routes-manifest.json is invalid: $MANIFEST_OUTPUT"
    MISSING+=("routes-manifest.json:invalid")
  fi
fi

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "❌ [DESIGN GATE FAILED]: ${#MISSING[@]} design artifact problem(s):"
  for item in "${MISSING[@]}"; do
    echo "   - $item"
  done
  echo "   Generate them (wireframe HTML is acceptable when Stitch is disabled) before implementing."
  MISSING_JSON="$(printf '%s\n' "${MISSING[@]}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(d.trim().split("\n").filter(Boolean))))' 2>/dev/null || echo '[]')"
  if [ "$DRY_RUN" = true ]; then
    echo "ℹ️  --dry-run: reporting only."
    write_evidence "failed" "$MISSING_JSON" "$TOKENS_COUNT" "$SCREENS_COUNT"
    emit_gate_telemetry "failed" 0 '{"dry_run":true}'
    exit 0
  fi
  write_evidence "failed" "$MISSING_JSON" "$TOKENS_COUNT" "$SCREENS_COUNT"
  emit_gate_telemetry "failed" 1
  exit 1
fi

echo "✓ tokens.css declares $TOKENS_COUNT design token(s)"
echo "✓ $SCREENS_COUNT screen HTML file(s) present"
echo "✓ routes-manifest.json is valid and its fixtures exist"
echo ""
echo "✅ [DESIGN GATE PASSED]: design artifacts are complete."
write_evidence "passed" "[]" "$TOKENS_COUNT" "$SCREENS_COUNT"
emit_gate_telemetry "passed" 0 "{\"tokens_count\":$TOKENS_COUNT,\"screens_count\":$SCREENS_COUNT}"
exit 0
