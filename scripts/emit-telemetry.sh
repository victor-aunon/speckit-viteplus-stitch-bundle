#!/usr/bin/env bash
# ==============================================================================
# emit-telemetry.sh
# ------------------------------------------------------------------------------
# Structured Telemetry & Observability Emitter for Spec Kit Quality Gates.
# Appends structured JSONL events to .specify/telemetry.jsonl (or specified file).
#
# Events recorded:
#   - gate_execution (gate, status, duration_ms, exit_code, scope)
#   - circuit_breaker (event, failures, max_failures, state)
#   - evidence_generated (gate, artifact, feature_dir)
# ==============================================================================

set -eo pipefail

show_help() {
  cat << 'EOF'
Usage: emit-telemetry.sh [options]

Structured Telemetry & Observability Emitter for Spec Kit Quality Gates.

Options:
  --help                  Show this help message
  --event=<name>          Event name (default: gate_execution)
  --gate=<name>           Gate name (e.g. check-quality-gate, check-contracts)
  --status=<status>       Status (passed, failed, skipped, tripped, reset, healthy)
  --duration-ms=<N>       Duration of gate execution in milliseconds
  --exit-code=<N>         Process exit code (default: 0)
  --scope=<path>          Feature slice / scope directory
  --feature-dir=<path>    Target feature directory (e.g. specs/001-feature)
  --evidence-file=<path>  Path to generated evidence file
  --details=<json>        Additional JSON payload with metrics
  --file=<path>           Target telemetry log file (default: .specify/telemetry.jsonl)
  --summary               Display a formatted summary table of recent telemetry events
EOF
}

EVENT_NAME="gate_execution"
GATE_NAME=""
STATUS="passed"
DURATION_MS=0
EXIT_CODE=0
SCOPE_DIR=""
FEATURE_DIR=""
EVIDENCE_FILE=""
DETAILS_JSON=""
TARGET_FILE=""
SHOW_SUMMARY=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --event=*)
      EVENT_NAME="${arg#*=}"
      ;;
    --gate=*)
      GATE_NAME="${arg#*=}"
      ;;
    --status=*)
      STATUS="${arg#*=}"
      ;;
    --duration-ms=*)
      DURATION_MS="${arg#*=}"
      ;;
    --exit-code=*)
      EXIT_CODE="${arg#*=}"
      ;;
    --scope=*)
      SCOPE_DIR="${arg#*=}"
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --evidence-file=*)
      EVIDENCE_FILE="${arg#*=}"
      ;;
    --details=*)
      DETAILS_JSON="${arg#*=}"
      ;;
    --file=*)
      TARGET_FILE="${arg#*=}"
      ;;
    --summary)
      SHOW_SUMMARY=true
      ;;
    *)
      ;;
  esac
done

# Resolve default telemetry log destination
if [ -z "$TARGET_FILE" ]; then
  if [ -n "${SPECIFY_TELEMETRY_FILE:-}" ]; then
    TARGET_FILE="$SPECIFY_TELEMETRY_FILE"
  elif [ -d ".specify" ]; then
    TARGET_FILE=".specify/telemetry.jsonl"
  else
    TARGET_FILE="${TMPDIR:-/tmp}/speckit-telemetry.jsonl"
  fi
fi

# Summary mode: print formatted table of recorded events
if [ "$SHOW_SUMMARY" = true ]; then
  if [ ! -f "$TARGET_FILE" ] || [ ! -s "$TARGET_FILE" ]; then
    echo "ℹ️  No telemetry events recorded yet in: $TARGET_FILE"
    exit 0
  fi

  echo "======================================================================"
  echo "[TELEMETRY SUMMARY] Recorded Gate Executions ($TARGET_FILE)"
  echo "======================================================================"
  printf "%-24s | %-20s | %-10s | %-12s | %-8s\n" "TIMESTAMP" "GATE" "STATUS" "DURATION" "EXIT"
  echo "----------------------------------------------------------------------"

  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const time = (entry.timestamp || "").replace("T", " ").replace("Z", "");
          const gate = (entry.gate || entry.event || "unknown").slice(0, 20);
          const status = (entry.status || "unknown").slice(0, 10);
          const duration = `${entry.duration_ms || 0}ms`;
          const exitCode = String(entry.exit_code ?? 0);
          console.log(`${time.padEnd(24)} | ${gate.padEnd(20)} | ${status.padEnd(10)} | ${duration.padEnd(12)} | ${exitCode.padEnd(8)}`);
        } catch {}
      }
    ' "$TARGET_FILE"
  else
    cat "$TARGET_FILE"
  fi
  echo "======================================================================"
  exit 0
fi

# Ensure parent directory exists
LOG_DIR="$(dirname "$TARGET_FILE")"
mkdir -p "$LOG_DIR" 2>/dev/null || true

# Format ISO-8601 UTC timestamp
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")"

# Assemble JSON event safely using Node.js or portable fallback
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const [
      targetFile,
      timestamp,
      event,
      gate,
      status,
      durationMs,
      exitCode,
      scope,
      featureDir,
      evidenceFile,
      detailsRaw
    ] = process.argv.slice(1);

    let details = {};
    if (detailsRaw) {
      try { details = JSON.parse(detailsRaw); } catch {}
    }

    const record = {
      timestamp,
      event,
      gate: gate || undefined,
      status,
      duration_ms: Number(durationMs) || 0,
      exit_code: Number(exitCode) || 0,
      scope: scope || undefined,
      feature_dir: featureDir || undefined,
      evidence_file: evidenceFile || undefined,
      details: Object.keys(details).length > 0 ? details : undefined
    };

    fs.appendFileSync(targetFile, JSON.stringify(record) + "\n", "utf8");
  ' "$TARGET_FILE" "$TIMESTAMP" "$EVENT_NAME" "$GATE_NAME" "$STATUS" "$DURATION_MS" "$EXIT_CODE" "$SCOPE_DIR" "$FEATURE_DIR" "$EVIDENCE_FILE" "$DETAILS_JSON"
else
  # Minimal shell fallback when Node is unavailable
  ESCAPED_SCOPE="$(printf '%s' "$SCOPE_DIR" | sed 's/"/\\"/g')"
  ESCAPED_FEATURE="$(printf '%s' "$FEATURE_DIR" | sed 's/"/\\"/g')"
  printf '{"timestamp":"%s","event":"%s","gate":"%s","status":"%s","duration_ms":%d,"exit_code":%d,"scope":"%s","feature_dir":"%s"}\n' \
    "$TIMESTAMP" "$EVENT_NAME" "$GATE_NAME" "$STATUS" "$DURATION_MS" "$EXIT_CODE" "$ESCAPED_SCOPE" "$ESCAPED_FEATURE" >> "$TARGET_FILE"
fi

exit 0
