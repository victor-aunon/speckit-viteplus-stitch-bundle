#!/usr/bin/env bash
# ==============================================================================
# emit-telemetry.sh
# ------------------------------------------------------------------------------
# Structured Telemetry & Observability Emitter for Spec Kit Quality Gates.
# Appends structured JSONL events to .specify/telemetry.jsonl (or specified file).
#
# Events recorded:
#   - gate_execution (gate, status, duration_ms, exit_code, scope, model, subagent)
#   - step_execution (workflow step, role, model, subagent, status, duration_ms)
#                     imported from the active workflow run's state.json
#   - circuit_breaker (event, failures, max_failures, state)
#   - evidence_generated (gate, artifact, feature_dir)
#
# Every event carries provenance: which step ran, which model was used, and
# which subagent/integration process executed it ("none" when not applicable).
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
  --step=<name>           Workflow step id that produced the event (defaults to --gate)
  --role=<role>           Role/persona that executed the step (default: none)
  --model=<name>          AI model used for the step (default: none)
  --subagent=<name>       Subagent / integration process that executed the step
                          (default: none; e.g. pi, claude, gemini)
  --status=<status>       Status (passed, failed, skipped, tripped, reset, healthy)
  --duration-ms=<N>       Duration of gate execution in milliseconds
  --exit-code=<N>         Process exit code (default: 0)
  --scope=<path>          Feature slice / scope directory
  --feature-dir=<path>    Target feature directory (e.g. specs/001-feature)
  --evidence-file=<path>  Path to generated evidence file
  --details=<json>        Additional JSON payload with metrics
  --file=<path>           Target telemetry log file (default: .specify/telemetry.jsonl)
  --import-state[=<path>] Import every workflow step from a run state.json (with
                          model, subagent, role and duration) as step_execution
                          events. Without a path it resolves the active run from
                          SPECIFY_RUN_ID/SPECKIT_RUN_ID or the most recent run
                          under .specify/workflows/runs/.
  --run-id=<id>           Workflow run id used to resolve state.json
  --summary               Display a formatted summary table of recent telemetry events
EOF
}

EVENT_NAME="gate_execution"
GATE_NAME=""
STEP_NAME=""
ROLE_NAME=""
MODEL_NAME=""
SUBAGENT_NAME=""
STATUS="passed"
DURATION_MS=0
EXIT_CODE=0
SCOPE_DIR=""
FEATURE_DIR=""
EVIDENCE_FILE=""
DETAILS_JSON=""
TARGET_FILE=""
RUN_ID=""
STATE_FILE=""
IMPORT_STATE=false
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
    --step=*)
      STEP_NAME="${arg#*=}"
      ;;
    --role=*)
      ROLE_NAME="${arg#*=}"
      ;;
    --model=*)
      MODEL_NAME="${arg#*=}"
      ;;
    --subagent=*)
      SUBAGENT_NAME="${arg#*=}"
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
    --state=*)
      STATE_FILE="${arg#*=}"
      ;;
    --run-id=*)
      RUN_ID="${arg#*=}"
      ;;
    --import-state)
      IMPORT_STATE=true
      ;;
    --import-state=*)
      IMPORT_STATE=true
      STATE_FILE="${arg#*=}"
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

# Attribute the event to a workflow step when one was not provided explicitly.
if [ -z "$STEP_NAME" ] && [ -n "$GATE_NAME" ]; then
  STEP_NAME="$GATE_NAME"
fi

# Environment fallbacks (workflow runners may export these).
if [ -z "$MODEL_NAME" ] && [ -n "${SPECIFY_MODEL:-}" ]; then
  MODEL_NAME="$SPECIFY_MODEL"
fi
if [ -z "$SUBAGENT_NAME" ] && [ -n "${SPECIFY_SUBAGENT:-}" ]; then
  SUBAGENT_NAME="$SPECIFY_SUBAGENT"
fi
if [ -z "$ROLE_NAME" ] && [ -n "${SPECIFY_ROLE:-}" ]; then
  ROLE_NAME="$SPECIFY_ROLE"
fi
if [ -z "$RUN_ID" ] && [ -n "${SPECIFY_RUN_ID:-}" ]; then
  RUN_ID="$SPECIFY_RUN_ID"
fi
if [ -z "$RUN_ID" ] && [ -n "${SPECKIT_RUN_ID:-}" ]; then
  RUN_ID="$SPECKIT_RUN_ID"
fi

# Normalize empty provenance fields to an explicit "none".
if [ -z "$STEP_NAME" ]; then STEP_NAME="none"; fi
if [ -z "$ROLE_NAME" ]; then ROLE_NAME="none"; fi
if [ -z "$MODEL_NAME" ]; then MODEL_NAME="none"; fi
if [ -z "$SUBAGENT_NAME" ]; then SUBAGENT_NAME="none"; fi

# Ensure parent directory exists
LOG_DIR="$(dirname "$TARGET_FILE")"
mkdir -p "$LOG_DIR" 2>/dev/null || true

# ------------------------------------------------------------------------------
# Import workflow steps from the active run state.json (idempotent upsert).
# Writes one step_execution record per step with model/subagent provenance.
# ------------------------------------------------------------------------------
import_state_steps() {
  if ! command -v node >/dev/null 2>&1; then
    echo "ℹ️  emit-telemetry: node is required to import workflow state; skipping." >&2
    return 0
  fi

  node -e '
    const fs = require("fs");
    const path = require("path");
    const [targetFile, stateArg, runIdArg] = process.argv.slice(1);

    const iso = (ms) => {
      const d = new Date(ms);
      if (isNaN(d.getTime())) return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      return d.toISOString().replace(/\.\d{3}Z$/, "Z");
    };

    const readJson = (file) => {
      try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
    };

    const statMtime = (file) => {
      try { return fs.statSync(file).mtimeMs; } catch { return 0; }
    };

    const resolveState = () => {
      if (stateArg) return stateArg;
      const root = path.join(".specify", "workflows", "runs");
      let dirs = [];
      try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return null; }
      const candidates = [];
      for (const dir of dirs) {
        const statePath = path.join(root, dir.name, "state.json");
        if (!fs.existsSync(statePath)) continue;
        const state = readJson(statePath);
        if (!state) continue;
        if (runIdArg && state.run_id !== runIdArg && dir.name !== runIdArg) continue;
        candidates.push({ statePath, mtime: statMtime(statePath) });
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.mtime - a.mtime);
      return candidates[0].statePath;
    };

    const statePath = resolveState();
    if (!statePath) {
      if (runIdArg) {
        console.error(`ℹ️  emit-telemetry: no workflow state.json found for run '${runIdArg}'.`);
      }
      process.exit(0);
    }
    if (!fs.existsSync(statePath)) {
      console.error(`ℹ️  emit-telemetry: state file not found at ${statePath}.`);
      process.exit(0);
    }

    const state = readJson(statePath);
    if (!state || typeof state.step_results !== "object" || state.step_results === null) {
      console.error(`ℹ️  emit-telemetry: state file at ${statePath} has no step_results.`);
      process.exit(0);
    }

    const runDir = path.dirname(statePath);

    // Role/persona per step, extracted from the prompt "ROLE:" line of the
    // workflow definition snapshot stored inside the run directory.
    const roles = {};
    try {
      const yamlText = fs.readFileSync(path.join(runDir, "workflow.yml"), "utf8");
      let current = null;
      for (const line of yamlText.split("\n")) {
        const idMatch = /^\s*-\s+id:\s*(.+?)\s*$/.exec(line);
        if (idMatch) {
          current = idMatch[1].replace(/^["\x27]|["\x27]$/g, "");
          continue;
        }
        if (!current || roles[current]) continue;
        const roleMatch = /^\s*ROLE:\s*(.+?)\s*$/.exec(line);
        if (roleMatch) roles[current] = roleMatch[1];
      }
    } catch {}

    // Per-step durations from the run log (a step may run several times in loops).
    const durations = {};
    const lastTimestamp = {};
    const open = {};
    try {
      const logText = fs.readFileSync(path.join(runDir, "log.jsonl"), "utf8");
      for (const line of logText.split("\n")) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        const stepId = event.step_id;
        const ts = Date.parse(event.timestamp);
        if (!stepId || isNaN(ts)) continue;
        if (event.event === "step_started") {
          open[stepId] = ts;
        } else if (event.event === "step_completed" || event.event === "step_failed") {
          if (open[stepId] !== undefined) {
            durations[stepId] = (durations[stepId] || 0) + (ts - open[stepId]);
            delete open[stepId];
          }
          lastTimestamp[stepId] = Math.max(lastTimestamp[stepId] || 0, ts);
        }
      }
    } catch {}

    const fallbackTs = Date.parse(state.updated_at) || Date.now();
    const records = [];

    for (const [stepId, step] of Object.entries(state.step_results)) {
      if (!step || typeof step !== "object") continue;
      const record = {
        timestamp: iso(lastTimestamp[stepId] || fallbackTs),
        event: "step_execution",
        run_id: state.run_id || path.basename(runDir),
        workflow_id: state.workflow_id || undefined,
        step: stepId,
        step_type: step.type || "unknown",
        role: roles[stepId] || "none",
        model: step.model || "none",
        subagent: step.integration || "none",
        status: step.status || "unknown",
        duration_ms: Math.round(durations[stepId] || 0),
      };
      if (step.output && Number.isFinite(step.output.exit_code)) {
        record.exit_code = step.output.exit_code;
      }
      if (step.error) record.error = step.error;
      records.push(record);
    }

    if (records.length === 0) process.exit(0);

    // Upsert: drop stale step_execution rows for this run, keep everything else.
    let lines = [];
    try {
      lines = fs.readFileSync(targetFile, "utf8").split("\n").filter((l) => l.trim());
    } catch {}

    const importedSteps = new Set(records.map((r) => r.step));
    const kept = lines.filter((line) => {
      try {
        const entry = JSON.parse(line);
        return !(
          entry.event === "step_execution" &&
          (entry.run_id || "") === (records[0].run_id || "") &&
          importedSteps.has(entry.step)
        );
      } catch {
        return true;
      }
    });

    const payload = kept.concat(records.map((r) => JSON.stringify(r))).join("\n") + "\n";
    fs.writeFileSync(targetFile, payload, "utf8");
    console.error(`ℹ️  emit-telemetry: imported ${records.length} workflow step(s) from run ${records[0].run_id}.`);
  ' "$TARGET_FILE" "$STATE_FILE" "$RUN_ID"
}

if [ "$IMPORT_STATE" = true ]; then
  import_state_steps

  # Import-only invocation: no gate/step event was described, so do not append
  # a meaningless record.
  if [ "$SHOW_SUMMARY" = false ] && [ -z "$GATE_NAME" ] && [ "$EVENT_NAME" = "gate_execution" ] &&
     [ -z "$SCOPE_DIR" ] && [ -z "$FEATURE_DIR" ] && [ -z "$EVIDENCE_FILE" ] &&
     [ -z "$DETAILS_JSON" ]; then
    exit 0
  fi
fi

# Summary mode: print formatted table of recorded events
if [ "$SHOW_SUMMARY" = true ]; then
  if [ ! -f "$TARGET_FILE" ] || [ ! -s "$TARGET_FILE" ]; then
    echo "ℹ️  No telemetry events recorded yet in: $TARGET_FILE"
    exit 0
  fi

  echo "======================================================================================================================"
  echo "[TELEMETRY SUMMARY] Recorded Steps & Gate Executions ($TARGET_FILE)"
  echo "======================================================================================================================"
  printf "%-21s | %-26s | %-20s | %-14s | %-10s | %-10s | %-5s\n" "TIMESTAMP" "STEP" "MODEL" "SUBAGENT" "STATUS" "DURATION" "EXIT"
  echo "----------------------------------------------------------------------------------------------------------------------"

  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const clip = (value, width) => {
        const text = String(value === undefined || value === null || value === "" ? "none" : value);
        return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
      };
      const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const time = (entry.timestamp || "").replace("T", " ").replace("Z", "");
          const step = entry.step || entry.gate || entry.event || "unknown";
          const status = entry.status || "unknown";
          const duration = `${entry.duration_ms || 0}ms`;
          const exitCode = String(entry.exit_code ?? "-");
          console.log(
            [
              clip(time, 21),
              clip(step, 26),
              clip(entry.model || "none", 20),
              clip(entry.subagent || "none", 14),
              clip(status, 10),
              clip(duration, 10),
              clip(exitCode, 5),
            ].join(" | ")
          );
        } catch {}
      }
    ' "$TARGET_FILE"
  else
    cat "$TARGET_FILE"
  fi
  echo "======================================================================================================================"
  exit 0
fi

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
      step,
      role,
      model,
      subagent,
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
      step: step || undefined,
      role: role && role !== "none" ? role : undefined,
      model,
      subagent,
      status,
      duration_ms: Number(durationMs) || 0,
      exit_code: Number(exitCode) || 0,
      scope: scope || undefined,
      feature_dir: featureDir || undefined,
      evidence_file: evidenceFile || undefined,
      details: Object.keys(details).length > 0 ? details : undefined
    };

    fs.appendFileSync(targetFile, JSON.stringify(record) + "\n", "utf8");
  ' "$TARGET_FILE" "$TIMESTAMP" "$EVENT_NAME" "$GATE_NAME" "$STEP_NAME" "$ROLE_NAME" "$MODEL_NAME" "$SUBAGENT_NAME" "$STATUS" "$DURATION_MS" "$EXIT_CODE" "$SCOPE_DIR" "$FEATURE_DIR" "$EVIDENCE_FILE" "$DETAILS_JSON"
else
  # Minimal shell fallback when Node is unavailable
  ESCAPED_SCOPE="$(printf '%s' "$SCOPE_DIR" | sed 's/"/\\"/g')"
  ESCAPED_FEATURE="$(printf '%s' "$FEATURE_DIR" | sed 's/"/\\"/g')"
  printf '{"timestamp":"%s","event":"%s","gate":"%s","step":"%s","model":"%s","subagent":"%s","status":"%s","duration_ms":%d,"exit_code":%d,"scope":"%s","feature_dir":"%s"}\n' \
    "$TIMESTAMP" "$EVENT_NAME" "$GATE_NAME" "$STEP_NAME" "$MODEL_NAME" "$SUBAGENT_NAME" "$STATUS" "$DURATION_MS" "$EXIT_CODE" "$ESCAPED_SCOPE" "$ESCAPED_FEATURE" >> "$TARGET_FILE"
fi

exit 0
