#!/usr/bin/env bash
# ==============================================================================
# check-verification-verdict.sh
# ------------------------------------------------------------------------------
# Machine Verdict Gate: the final verification step is a prompt, and a prompt
# cannot fail a workflow. This gate reads the machine-readable verdict the
# verifier must write (evidence/verification.json) and turns it into an exit code.
#
# A prose report is not evidence. The JSON verdict is the contract.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: check-verification-verdict.sh [options]

Fails the workflow unless the final verification verdict is "pass".

Requires <feature>/evidence/verification.json:
  {
    "verdict": "pass" | "reject",
    "critical": 0, "high": 0, "medium": 0,
    "scenarios_passed": 0, "scenarios_total": 0,
    "reasons": ["..."],
    "auditor": "independent-qc"
  }

Options:
  --help                 Show this help message
  --feature-dir=<path>   Feature directory (default: newest under specs/)
  --verdict-file=<path>  Direct path to verification.json
  --evidence-dir=<path>  Directory to write this gate's evidence JSON
  --allow-missing        Do not fail when verification.json is absent

Exit Codes:
  0                      Verdict is "pass"
  1                      Verdict is "reject", malformed, or missing
  2                      Invalid configuration
EOF
}

FEATURE_DIR=""
VERDICT_FILE=""
EVIDENCE_DIR=""
ALLOW_MISSING=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --verdict-file=*)
      VERDICT_FILE="${arg#*=}"
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --allow-missing)
      ALLOW_MISSING=true
      ;;
    *)
      ;;
  esac
done

if [ -z "$FEATURE_DIR" ] && [ -z "$VERDICT_FILE" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi

if [ -z "$FEATURE_DIR" ] && [ -z "$VERDICT_FILE" ] && [ -d "specs" ]; then
  FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
fi

if [ -z "$VERDICT_FILE" ] && [ -n "$FEATURE_DIR" ]; then
  VERDICT_FILE="$FEATURE_DIR/evidence/verification.json"
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
      --gate="check-verification-verdict" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${details:+--details="$details"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/verification-verdict.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  local verdict="$2"
  local reason="$3"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      EV_VERDICT_FILE="$VERDICT_FILE" \
      EV_FEATURE_DIR="$FEATURE_DIR" \
      node -e '
        const fs = require("fs");
        const [outPath, status, verdict, reason] = process.argv.slice(1);
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-verification-verdict",
          status,
          previous_status: previousStatus,
          verdict: verdict || undefined,
          reason: reason || undefined,
          verdict_file: process.env.EV_VERDICT_FILE || undefined,
          feature_dir: process.env.EV_FEATURE_DIR || undefined,
          evidence_type: "verification_verdict_gate"
        };
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
        fs.appendFileSync(outPath.replace(/\.json$/, ".history.jsonl"), JSON.stringify(data) + "\n", "utf8");
      ' "$EVIDENCE_DIR/verification-verdict.json" "$status" "$verdict" "$reason" 2>/dev/null || true
    fi
  fi
}

fail_gate() {
  local verdict="$1"
  local reason="$2"
  local exit_code="${3:-1}"
  write_evidence "failed" "$verdict" "$reason"
  emit_gate_telemetry "failed" "$exit_code" "{\"verdict\":\"${verdict:-missing}\"}"
  exit "$exit_code"
}

echo "======================================================================"
echo "[VERDICT GATE] Machine-readable verification verdict"
echo "======================================================================"

if [ -z "$VERDICT_FILE" ] || [ ! -f "$VERDICT_FILE" ]; then
  if [ "$ALLOW_MISSING" = true ]; then
    echo "⚠️  [VERDICT GATE]: no verification.json found (${VERDICT_FILE:-none}); allowed by --allow-missing (evidence: skipped)."
    write_evidence "skipped" "" "allowed_missing"
    emit_gate_telemetry "skipped" 0 '{"reason":"allowed_missing"}'
    exit 0
  fi
  echo "❌ [VERDICT GATE FAILED]: no machine verdict found at '${VERDICT_FILE:-none}'."
  echo "   The final verification step MUST write { \"verdict\": \"pass\" | \"reject\" }."
  echo "   A prose report alone cannot pass or fail a workflow."
  fail_gate "missing" "missing_verdict_file"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ [VERDICT GATE ERROR]: node is required to parse the verdict JSON."
  exit 2
fi

PARSED="$(node -e '
  const fs = require("fs");
  const file = process.argv[1];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `invalid JSON: ${err.message}` }));
    process.exit(0);
  }
  const verdict = typeof data.verdict === "string" ? data.verdict.trim().toLowerCase() : "";
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  console.log(JSON.stringify({
    ok: true,
    verdict,
    critical: Number(data.critical) || 0,
    high: Number(data.high) || 0,
    medium: Number(data.medium) || 0,
    scenariosPassed: Number(data.scenarios_passed) || 0,
    scenariosTotal: Number(data.scenarios_total) || 0,
    reasons: reasons.slice(0, 8)
  }));
' "$VERDICT_FILE" 2>/dev/null || echo '{"ok":false,"error":"unreadable verdict"}')"

read_field() {
  printf '%s' "$PARSED" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(raw);
        const value = data[process.argv[1]];
        process.stdout.write(value === undefined || value === null ? "" : String(value));
      } catch {}
    });
  ' "$1" 2>/dev/null || true
}

OK="$(read_field ok)"
if [ "$OK" != "true" ]; then
  echo "❌ [VERDICT GATE FAILED]: could not parse '${VERDICT_FILE}'."
  echo "$(read_field error)"
  fail_gate "invalid" "unparseable_verdict"
fi

VERDICT="$(read_field verdict)"
CRITICAL="$(read_field critical)"
HIGH="$(read_field high)"
MEDIUM="$(read_field medium)"
SCENARIOS_PASSED="$(read_field scenariosPassed)"
SCENARIOS_TOTAL="$(read_field scenariosTotal)"

echo "   File      : $VERDICT_FILE"
echo "   Verdict   : ${VERDICT:-missing}"
echo "   Severity  : critical=$CRITICAL high=$HIGH medium=$MEDIUM"
echo "   Scenarios : ${SCENARIOS_PASSED}/${SCENARIOS_TOTAL} passing"

case "$VERDICT" in
  pass)
    echo ""
    echo "✅ [VERDICT GATE PASSED]: independent verification returned 'pass'."
    write_evidence "passed" "$VERDICT" ""
    emit_gate_telemetry "passed" 0 "{\"verdict\":\"pass\"}"
    exit 0
    ;;
  reject)
    echo ""
    echo "❌ [VERDICT GATE FAILED]: independent verification returned 'reject'."
    printf '%s' "$PARSED" | node -e '
      let raw = "";
      process.stdin.on("data", (chunk) => { raw += chunk; });
      process.stdin.on("end", () => {
        try {
          const data = JSON.parse(raw);
          const reasons = Array.isArray(data.reasons) ? data.reasons : [];
          if (reasons.length > 0) {
            console.log("   Blocking reasons:");
            for (const reason of reasons) console.log(`     - ${reason}`);
          }
        } catch {}
      });
    ' 2>/dev/null || true
    echo "   The workflow cannot be reported as completed with a rejecting audit."
    fail_gate "reject" "verification_rejected"
    ;;
  *)
    echo ""
    echo "❌ [VERDICT GATE FAILED]: verdict must be exactly 'pass' or 'reject' (got '${VERDICT:-empty}')."
    fail_gate "${VERDICT:-invalid}" "invalid_verdict_value"
    ;;
esac
