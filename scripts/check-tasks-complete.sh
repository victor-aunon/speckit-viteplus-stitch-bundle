#!/usr/bin/env bash
# ==============================================================================
# check-tasks-complete.sh
# ------------------------------------------------------------------------------
# Completion Gate: a spec-driven feature is only "done" when every task in
# tasks.md is checked. Without this gate a workflow can finish (and every other
# gate can pass) while the implementation is still a scaffold.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: check-tasks-complete.sh [options]

Fails when specs/<feature>/tasks.md still contains unchecked tasks.

Options:
  --help                 Show this help message
  --feature-dir=<path>   Feature directory (default: newest under specs/)
  --tasks=<path>         Direct path to tasks.md
  --evidence-dir=<path>  Directory to write machine evidence JSON
  --allow-incomplete     Do not fail on unchecked tasks (human-approved override)
  --allow-missing        Do not fail when tasks.md does not exist
  --quiet                Only print the final verdict

Exit Codes:
  0                      Every task is checked (or an explicit override was passed)
  1                      Unchecked tasks remain, or tasks.md is missing
  2                      Invalid configuration or unreadable files
EOF
}

FEATURE_DIR=""
TASKS_FILE=""
EVIDENCE_DIR=""
ALLOW_INCOMPLETE=false
ALLOW_MISSING=false
QUIET=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --tasks=*)
      TASKS_FILE="${arg#*=}"
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --allow-incomplete)
      ALLOW_INCOMPLETE=true
      ;;
    --allow-missing)
      ALLOW_MISSING=true
      ;;
    --quiet)
      QUIET=true
      ;;
    *)
      ;;
  esac
done

if [ "$ALLOW_INCOMPLETE" = false ] && [ "${SPECIFY_ALLOW_INCOMPLETE_TASKS:-}" = "true" ]; then
  ALLOW_INCOMPLETE=true
fi

if [ -z "$FEATURE_DIR" ] && [ -z "$TASKS_FILE" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi

if [ -z "$FEATURE_DIR" ] && [ -z "$TASKS_FILE" ] && [ -d "specs" ]; then
  FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
fi

if [ -z "$TASKS_FILE" ] && [ -n "$FEATURE_DIR" ]; then
  TASKS_FILE="$FEATURE_DIR/tasks.md"
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
      --gate="check-tasks-complete" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${details:+--details="$details"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/tasks.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  local total="$2"
  local completed="$3"
  local pending="$4"
  local reason="$5"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      EV_TASKS_FILE="$TASKS_FILE" \
      EV_FEATURE_DIR="$FEATURE_DIR" \
      node -e '
        const fs = require("fs");
        const [outPath, status, total, completed, pending, reason] = process.argv.slice(1);
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-tasks-complete",
          status,
          previous_status: previousStatus,
          reason: reason || undefined,
          tasks_file: process.env.EV_TASKS_FILE || undefined,
          feature_dir: process.env.EV_FEATURE_DIR || undefined,
          tasks_total: Number(total) || 0,
          tasks_completed: Number(completed) || 0,
          tasks_pending: Number(pending) || 0,
          evidence_type: "task_completion"
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
      ' "$EVIDENCE_DIR/tasks.json" "$status" "$total" "$completed" "$pending" "$reason" 2>/dev/null || true
    fi
  fi
}

TOTAL=0
COMPLETED=0
PENDING=0

if [ -n "$TASKS_FILE" ] && [ -f "$TASKS_FILE" ]; then
  # Task lines: "- [ ] T001 ...", "* [x] T002 ..." (markdown checklists).
  TOTAL=$(grep -cE '^[[:space:]]*[-*][[:space:]]+\[[ xX]\][[:space:]]' "$TASKS_FILE" 2>/dev/null || true)
  COMPLETED=$(grep -cE '^[[:space:]]*[-*][[:space:]]+\[[xX]\][[:space:]]' "$TASKS_FILE" 2>/dev/null || true)
  TOTAL="${TOTAL:-0}"
  COMPLETED="${COMPLETED:-0}"
  PENDING=$(( TOTAL - COMPLETED ))
  if [ "$PENDING" -lt 0 ]; then PENDING=0; fi

  if [ "$QUIET" = false ]; then
    echo "======================================================================"
    echo "[TASKS GATE] Task completion audit"
    echo "======================================================================"
    echo "   File      : $TASKS_FILE"
    echo "   Total     : $TOTAL"
    echo "   Completed : $COMPLETED"
    echo "   Pending   : $PENDING"
  fi

  if [ "$TOTAL" -eq 0 ]; then
    if [ "$QUIET" = false ]; then
      echo ""
      echo "⚠️  [TASKS GATE WARNING]: tasks.md declares no checklist items."
    fi
  fi

  if [ "$PENDING" -gt 0 ]; then
    if [ "$ALLOW_INCOMPLETE" = true ]; then
      if [ "$QUIET" = false ]; then
        echo ""
        echo "⚠️  [TASKS GATE]: $PENDING unchecked task(s) allowed by --allow-incomplete (evidence: skipped)."
      fi
      write_evidence "skipped" "$TOTAL" "$COMPLETED" "$PENDING" "allowed_incomplete"
      emit_gate_telemetry "skipped" 0 "{\"tasks_pending\":$PENDING,\"tasks_total\":$TOTAL}"
      exit 0
    fi

    echo ""
    echo "❌ [TASKS GATE FAILED]: $PENDING of $TOTAL task(s) are still unchecked in '${TASKS_FILE}'."
    echo "   Declaring the feature complete with a partial implementation is not allowed."
    grep -nE '^[[:space:]]*[-*][[:space:]]+\[ \]' "$TASKS_FILE" 2>/dev/null | head -n 10 | sed 's/^/   /' || true
    echo "   Finish the tasks, or get explicit human approval and pass --allow-incomplete."
    write_evidence "failed" "$TOTAL" "$COMPLETED" "$PENDING" "unchecked_tasks"
    emit_gate_telemetry "failed" 1 "{\"tasks_pending\":$PENDING,\"tasks_total\":$TOTAL}"
    exit 1
  fi

  if [ "$QUIET" = false ]; then
    echo ""
    echo "✅ [TASKS GATE PASSED]: all $TOTAL task(s) are checked."
  fi
  write_evidence "passed" "$TOTAL" "$COMPLETED" "$PENDING" ""
  emit_gate_telemetry "passed" 0 "{\"tasks_pending\":0,\"tasks_total\":$TOTAL}"
  exit 0
fi

if [ "$ALLOW_MISSING" = true ]; then
  if [ "$QUIET" = false ]; then
    echo "⚠️  [TASKS GATE]: no tasks.md found (${TASKS_FILE:-none}); allowed by --allow-missing (evidence: skipped)."
  fi
  write_evidence "skipped" 0 0 0 "allowed_missing"
  emit_gate_telemetry "skipped" 0 '{"reason":"allowed_missing"}'
  exit 0
fi

echo "❌ [TASKS GATE FAILED]: no tasks.md found (${TASKS_FILE:-none})."
echo "   Completion cannot be proven without a task ledger."
echo "   Generate tasks with 'speckit.tasks', or pass --allow-missing with human approval."
write_evidence "failed" 0 0 0 "missing_tasks"
emit_gate_telemetry "failed" 1 '{"reason":"missing_tasks"}'
exit 1
