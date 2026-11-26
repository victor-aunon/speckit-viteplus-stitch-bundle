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
  --tokens-only             Validate tokens.css structure without launching Playwright.
                            Structural only: writes stitch-design-tokens.json, never
                            stitch-design.json, and is rejected with --require-ui.
  --calibrate               Render the reference screens, compare the app against
                            them, and PRINT the per-screen diff ratio without failing.
                            Use it to choose a tolerance with data instead of guessing;
                            exits 0 unless the run cannot execute at all.
  --update-snapshots        Regenerate the golden screenshots from designs/<id>.html.
                            The HTML is the design master: this NEVER promotes the app's
                            current render to the baseline (that would silently bless a
                            regression), so the flag is now the same work the gate always
                            does, stated explicitly.
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
CALIBRATE=false
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
    --calibrate)
      CALIBRATE=true
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
    # Structural token validation and full visual verification are different
    # claims, so they never share an evidence artifact.
    local out_path="$EVIDENCE_DIR/stitch-design.json"
    if [ "$TOKENS_ONLY" = true ]; then
      out_path="$EVIDENCE_DIR/stitch-design-tokens.json"
    fi
    if command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const [outPath, status, tokensCount, featDir, tokensOnly] = process.argv.slice(1);
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const isTokensOnly = tokensOnly === "true";
        const data = {
          timestamp: new Date().toISOString(),
          gate: "verify-stitch-design",
          status,
          previous_status: previousStatus,
          reason: status === "skipped" ? "no_ui_declared" : undefined,
          tokens_count: Number(tokensCount) || 0,
          feature_dir: featDir || undefined,
          tokens_only: isTokensOnly,
          full_visual_verification: !isTokensOnly && status === "passed",
          evidence_type: isTokensOnly ? "visual_design_tokens_structure" : "visual_design"
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
      ' "$out_path" "$status" "$tokens_count" "$FEATURE_DIR" "$TOKENS_ONLY" 2>/dev/null || true
    fi
  fi
}

echo "======================================================================"
echo "[VISUAL GATE] Starting Playwright Stitch visual validation"
echo "======================================================================"

if [ "$TOKENS_ONLY" = true ] && [ "$REQUIRE_UI" = true ]; then
  echo "❌ [VISUAL GATE FAILED]: --tokens-only is incompatible with --require-ui."
  echo "   Structural token validation cannot prove that a UI renders or matches the design."
  echo "   Run the full Playwright gate, or drop --require-ui if this feature has no UI."
  exit 2
fi

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
  echo "✅ [TOKENS GATE PASSED]: Stitch tokens.css structure is valid."
  echo "   Structural check only. No rendering, no snapshots, no visual fidelity claim."
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
  if [ "$REQUIRE_UI" = true ]; then
    CONTRACT_FLAGS+=("--require-ui")
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

# ------------------------------------------------------------------------------
# Golden references, derived from the design master
# ------------------------------------------------------------------------------
# The design phase forbids shipping binary screenshots and declares the HTML the
# master, so `designs/<id>.png` never existed and the spec's existence check
# skipped every screen: the "visual fidelity" test passed having asserted
# nothing. The golden is therefore DERIVED from `designs/<id>.html` here, in the
# same browser with the same deterministic render CSS the spec uses, so the
# comparison is real and the HTML stays the only committed source of truth.
GOLDENS_SCRIPT="$SCRIPT_DIR/render-design-goldens.mjs"
GOLDENS_STATUS=0
if [ -f "$GOLDENS_SCRIPT" ] && command -v node >/dev/null 2>&1; then
  echo "Rendering golden references from designs/*.html..."
  FEATURE_DIR="$FEATURE_DIR" node "$GOLDENS_SCRIPT" \
    --feature-dir="$FEATURE_DIR" \
    --json="${EVIDENCE_DIR:-$FEATURE_DIR/evidence}/design-goldens.json" 2>&1 || GOLDENS_STATUS=$?
  if [ "$GOLDENS_STATUS" -ne 0 ]; then
    echo ""
    echo "❌ [VISUAL GATE ERROR]: could not render the reference screenshots."
    echo "   Without a reference there is nothing to compare against, and reporting"
    echo "   'no differences' would be a false green."
    emit_gate_telemetry "failed" "$GOLDENS_STATUS"
    write_evidence "failed" "$TOKEN_COUNT"
    exit 2
  fi
else
  echo "⚠️  [VISUAL GATE ERROR]: render-design-goldens.mjs is not installed or node is missing."
  echo "   The app cannot be compared against the design master without it."
  emit_gate_telemetry "failed" 2
  write_evidence "failed" "$TOKEN_COUNT"
  exit 2
fi

PW_FLAGS=""
if [ "$CALIBRATE" = true ]; then
  # Tolerance 0 forces every screen to report its real ratio: "passed" tells you
  # nothing when the number you need is how far off it actually is.
  PW_FLAGS="--reporter=json"
  export SPECIFY_DESIGN_TOLERANCE=0
fi

CONFIG_FILE=""
for candidate in "playwright.design.config.ts" ".specify/templates/playwright.design.config.ts" ".specify/templates/playwright.design.config.ts.tmpl"; do
  if [ -f "$candidate" ]; then
    CONFIG_FILE="$candidate"
    break
  fi
done

if [ -z "$CONFIG_FILE" ]; then
  echo "❌ [VISUAL GATE ERROR]: no Playwright design config found."
  echo "   Expected 'playwright.design.config.ts' in the project root, or the bundle"
  echo "   template at '.specify/templates/playwright.design.config.ts'."
  emit_gate_telemetry "failed" 2
  write_evidence "failed" "$TOKEN_COUNT"
  exit 2
fi

# Playwright fails with a confusing 'no tests found' when the design audit spec was
# never materialized. Fail loudly with the actionable path instead.
DESIGN_SPEC="$(find tests/design "$FEATURE_DIR" -maxdepth 3 -type f -name '*.spec.ts' 2>/dev/null | head -n 1 || true)"
if [ -z "$DESIGN_SPEC" ]; then
  echo "❌ [VISUAL GATE ERROR]: no Playwright design spec found."
  echo "   Copy '.specify/templates/design-audit.spec.ts' to 'tests/design/design-audit.spec.ts'"
  echo "   (the bundle ships it under .specify/templates) before claiming visual verification."
  emit_gate_telemetry "failed" 2
  write_evidence "failed" "$TOKEN_COUNT"
  exit 2
fi

if [ "$UPDATE_SNAPSHOTS" = true ]; then
  echo "ℹ️  --update-snapshots: goldens were regenerated from designs/*.html (the design master)."
  echo "   The app's current render is never promoted to the baseline."
fi

# ------------------------------------------------------------------------------
# Calibration: measure, do not judge
# ------------------------------------------------------------------------------
# A tolerance that blocks without ever having been measured is how a gate becomes
# a 30-minute window no agent can close. Calibration forces tolerance 0 so every
# screen reports its true ratio, then exits 0 whatever the numbers are.
if [ "$CALIBRATE" = true ]; then
  echo ""
  echo "[CALIBRATION] Comparing the implementation against the design master (report only)."
  CALIBRATION_RAW="$(FEATURE_DIR="$FEATURE_DIR" npx playwright test --config="$CONFIG_FILE" --reporter=json 2>&1 || true)"

  if ! CALIBRATION_TABLE="$(printf '%s' "$CALIBRATION_RAW" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
      const start = raw.indexOf("{");
      if (start === -1) {
        console.log("  (could not parse the Playwright JSON report)");
        process.exit(0);
      }
      let report;
      try {
        report = JSON.parse(raw.slice(start));
      } catch {
        console.log("  (could not parse the Playwright JSON report)");
        process.exit(0);
      }
      const rows = [];
      const failures = [];
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node.errors)) {
          for (const error of node.errors) {
            const message = String(error && error.message ? error.message : "").replace(/\u001b\[[0-9;]*m/g, "");
            failures.push(message);
            const snapshot = /Snapshot:\s*(.+)/.exec(message);
            const diff = /(\d+) pixels \(ratio ([0-9.]+)/.exec(message);
            if (snapshot && diff) {
              rows.push({ screen: snapshot[1].trim(), pixels: Number(diff[1]), ratio: Number(diff[2]) });
            }
          }
        }
        for (const value of Object.values(node)) walk(value);
      };
      walk(report);
      const stats = report.stats || {};
      const failedTests = Number(stats.unexpected) || 0;
      const ranTests = Number(stats.expected) || 0;

      // "No diff rows" is NOT the same as "identical". A navigation error, a
      // missing snapshot or a timeout also produces zero rows, and reporting
      // those as a pixel match is the exact class of false green this whole
      // mode exists to avoid.
      if (rows.length === 0) {
        if (failedTests > 0) {
          console.log(`  ${failedTests} visual test(s) failed WITHOUT producing a pixel diff.`);
          console.log("  That is not a match: the comparison never ran. First error:");
          const first = (failures[0] || "").split("\n").filter(Boolean).slice(0, 4);
          for (const line of first) console.log(`    ${line.trim()}`);
          process.exit(0);
        }
        if (ranTests === 0) {
          console.log("  No visual tests executed.");
          process.exit(0);
        }
        console.log("  Every screen is pixel-identical to its reference.");
        process.exit(0);
      }
      rows.sort((a, b) => b.ratio - a.ratio);
      console.log("  SCREEN                                   RATIO    PIXELS");
      console.log("  " + "-".repeat(58));
      for (const row of rows) {
        console.log("  " + row.screen.padEnd(40) + String(row.ratio).padEnd(9) + row.pixels);
      }
      console.log("");
      console.log("  Screens not listed above matched their reference exactly.");
    });
  ')"; then
    echo "  (could not parse the Playwright JSON report)"
  else
    printf '%s\n' "$CALIBRATION_TABLE"
  fi

  echo ""
  echo "✅ [CALIBRATION COMPLETE]: report only, no gate verdict written."
  echo "   Pick a tolerance from the ratios above (the config default is 0.05) and set"
  echo "   SPECIFY_DESIGN_TOLERANCE, or edit maxDiffPixelRatio in the design config."
  emit_gate_telemetry "calibration" 0
  exit 0
fi

echo "Executing visual fidelity tests with config '$CONFIG_FILE'..."
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
