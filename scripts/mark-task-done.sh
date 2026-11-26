#!/usr/bin/env bash
# ==============================================================================
# mark-task-done.sh
# ------------------------------------------------------------------------------
# The ONLY legitimate writer of an untagged `tasks.md` checkbox.
#
# WHY THIS EXISTS
# "Tick a task only after the quality gate passes" was prose. Nothing enforced
# it, so an agent that ticked everything in one sweep at the end was
# indistinguishable from one that verified each task -- and in a real run that is
# exactly what happened, including a task asking for the final commit.
#
# This script turns the rule into a checkable precondition:
#   1. the task exists, is unique, and is not `[verify:*]` (those belong to
#      reconcile-task-ledger.sh and are derived from gate evidence);
#   2. `quality-gate.json` reports `status: "passed"`;
#   3. that pass is not STALE: no source file may be newer than the evidence.
# A green gate that predates your last edit does not cover your last edit.
#
# It then writes the checkbox and appends a line to `task-ticks.jsonl` recording
# which gate run earned the tick, so a hand-edited checkbox has no such record
# and can be spotted.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: mark-task-done.sh --id=<TASK_ID>[,<TASK_ID>...] [options]

Ticks an implementation task in tasks.md after verifying that the quality gate
passed AND that the pass postdates the code it is supposed to cover.

Why the staleness check exists: a green gate from before your last edit proves
nothing about your last edit. Re-run the gate, then mark the task.

Options:
  --help                 Show this help message
  --id=<T001[,T002]>     Task id(s) to mark (required)
  --feature-dir=<path>   Feature directory (default: newest under specs/)
  --tasks=<path>         Direct path to tasks.md
  --evidence-dir=<path>  Directory holding quality-gate.json
  --source-roots=<a,b>   Directories checked for staleness
                         (default: whichever of src,tests,app,pages,lib,components exist)
  --dry-run              Report what would happen without writing anything
  --quiet                Only print the final verdict

Refuses to touch a `[verify:<gate>]` task: those are derived from gate evidence by
reconcile-task-ledger.sh, and editing one by hand makes the ledger disagree with
the gate it mirrors.

Exit Codes:
  0   Task marked (or already marked)
  1   Precondition not met: gate red, gate missing, or the pass is stale
  2   Configuration error: unknown/ambiguous/duplicate id, verify-tagged task
EOF
}

FEATURE_DIR=""
TASKS_FILE=""
EVIDENCE_DIR=""
TASK_IDS=""
SOURCE_ROOTS=""
DRY_RUN=false
QUIET=false

for arg in "$@"; do
  case "$arg" in
    --help) show_help; exit 0 ;;
    --id=*) TASK_IDS="${arg#*=}" ;;
    --feature-dir=*) FEATURE_DIR="${arg#*=}" ;;
    --tasks=*) TASKS_FILE="${arg#*=}" ;;
    --evidence-dir=*) EVIDENCE_DIR="${arg#*=}" ;;
    --source-roots=*) SOURCE_ROOTS="${arg#*=}" ;;
    --dry-run) DRY_RUN=true ;;
    --quiet) QUIET=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

if [ -z "$TASK_IDS" ]; then
  echo "❌ [MARK TASK] --id=<TASK_ID> is required." >&2
  echo "   Run 'mark-task-done.sh --help' for usage." >&2
  exit 2
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

if ! command -v node >/dev/null 2>&1; then
  echo "❌ [MARK TASK] node is required." >&2
  exit 2
fi

if [ -z "$TASKS_FILE" ] || [ ! -f "$TASKS_FILE" ]; then
  echo "❌ [MARK TASK] no tasks.md found (${TASKS_FILE:-none})." >&2
  exit 2
fi

if [ -z "$SOURCE_ROOTS" ]; then
  for candidate in src tests app pages lib components; do
    if [ -d "$candidate" ]; then
      SOURCE_ROOTS="${SOURCE_ROOTS:+$SOURCE_ROOTS,}$candidate"
    fi
  done
fi

EVIDENCE_FILE="${EVIDENCE_DIR:-}/quality-gate.json"
GATE_TIMESTAMP=""
STALE_FILES=""

if [ -n "$EVIDENCE_DIR" ] && [ -f "$EVIDENCE_FILE" ]; then
  GATE_TIMESTAMP="$(node -e '
    try {
      const payload = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (payload && payload.status === "passed") process.stdout.write(String(payload.timestamp || "pass"));
      else process.stdout.write("");
    } catch {
      process.stdout.write("");
    }
  ' "$EVIDENCE_FILE" 2>/dev/null || true)"
fi

if [ -z "$GATE_TIMESTAMP" ]; then
  echo "❌ [MARK TASK] Cannot mark a task without a passing quality gate." >&2
  echo "   Expected '${EVIDENCE_FILE:-<feature>/evidence/quality-gate.json}' with status: \"passed\"." >&2
  echo "   Run: bash .specify/scripts/bash/check-quality-gate.sh" >&2
  echo "   (add --scope=<your slice> when the run declares one: it narrows the" >&2
  echo "    regression suite to that slice, which is what makes a mid-feature pass" >&2
  echo "    reachable at all.)" >&2
  exit 1
fi

# Staleness: a green gate that predates the code proves nothing about the code.
# `find -newer` compares mtimes, so the gate must be the last thing that ran.
if [ -n "$SOURCE_ROOTS" ]; then
  IFS=',' read -r -a ROOTS <<< "$SOURCE_ROOTS"
  for root in "${ROOTS[@]}"; do
    [ -d "$root" ] || continue
    while IFS= read -r stale; do
      [ -n "$stale" ] || continue
      STALE_FILES="${STALE_FILES:+$STALE_FILES$'\n'}$stale"
    done < <(find "$root" -type f -newer "$EVIDENCE_FILE" \
      -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/coverage/*' \
      2>/dev/null || true)
  done
fi

if [ -z "$SOURCE_ROOTS" ]; then
  echo "⚠️  [MARK TASK] No source roots found (src, tests, app, pages, lib, components):" >&2
  echo "   the staleness check could not run, so this tick is NOT proven to postdate the code." >&2
  echo "   Pass --source-roots=<dir,...> to check the directories this project actually uses." >&2
fi

if [ -n "$STALE_FILES" ]; then
  echo "❌ [MARK TASK] The passing gate is STALE: source files changed after it ran." >&2
  echo "   A green gate from before your last edit does not cover your last edit." >&2
  printf '%s\n' "$STALE_FILES" | head -n 10 | sed 's/^/   - /' >&2
  echo "   Re-run: bash .specify/scripts/bash/check-quality-gate.sh" >&2
  exit 1
fi

MARK_OUTPUT="$(node - "$TASKS_FILE" "$TASK_IDS" "$DRY_RUN" << 'NODE_SCRIPT'
const fs = require('fs');

const [tasksFile, idsArg, dryRunArg] = process.argv.slice(2);
const dryRun = dryRunArg === 'true';
const ids = idsArg.split(',').map((entry) => entry.trim()).filter(Boolean);

const source = fs.readFileSync(tasksFile, 'utf8');
const lines = source.split('\n');
const CHECKBOX = /^(\s*[-*]\s+\[)([ xX])(\]\s.*)$/;
const VERIFY_TAG = /\[verify:[A-Za-z0-9_-]+\]/;

const actionable = [];
const errors = [];

for (const id of ids) {
  const idPattern = new RegExp(`(^|[^A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`);
  const matches = [];
  lines.forEach((line, index) => {
    if (!CHECKBOX.test(line)) return;
    if (idPattern.test(line)) matches.push(index);
  });

  if (matches.length === 0) {
    errors.push(`${id}: not found in ${tasksFile}`);
    continue;
  }
  if (matches.length > 1) {
    errors.push(`${id}: ambiguous, matches ${matches.length} task lines`);
    continue;
  }

  const index = matches[0];
  const line = lines[index];
  if (VERIFY_TAG.test(line)) {
    errors.push(`${id}: carries a [verify:*] tag — derive it from gate evidence with reconcile-task-ledger.sh, do not mark it here`);
    continue;
  }

  const checkbox = CHECKBOX.exec(line);
  const already = checkbox[2] === 'x' || checkbox[2] === 'X';
  if (already) {
    actionable.push({ id, line: index + 1, action: 'already' });
    continue;
  }
  if (!dryRun) {
    lines[index] = checkbox[1] + 'x' + checkbox[3];
  }
  actionable.push({ id, line: index + 1, action: 'ticked' });
}

if (errors.length > 0) {
  console.log(JSON.stringify({ status: 'error', errors }));
  process.exit(2);
}

if (!dryRun && actionable.some((entry) => entry.action === 'ticked')) {
  fs.writeFileSync(tasksFile, lines.join('\n'), 'utf8');
}

console.log(JSON.stringify({ status: 'ok', dry_run: dryRun, results: actionable }));
NODE_SCRIPT
)" || MARK_STATUS=$?
MARK_STATUS="${MARK_STATUS:-0}"

if [ "$QUIET" = false ]; then
  echo "$MARK_OUTPUT" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
      let report;
      try {
        report = JSON.parse(raw.trim());
      } catch {
        console.log(raw);
        return;
      }
      if (report.errors) {
        for (const error of report.errors) console.log(`❌ [MARK TASK] ${error}`);
        return;
      }
      for (const entry of report.results) {
        console.log(`✓ [MARK TASK] ${entry.action === "already" ? "already checked" : "marked"} ${entry.id} (line ${entry.line})`);
      }
    });
  '
fi

if [ "$MARK_STATUS" -ne 0 ]; then
  exit 2
fi

# The audit trail: a hand-edited checkbox leaves no record here, which is the
# whole point of routing ticks through a script.
if [ -n "$EVIDENCE_DIR" ] && [ "$DRY_RUN" = false ] && printf '%s' "$MARK_OUTPUT" | grep -q '"action":"ticked"'; then
  mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
  TASK_IDS="$TASK_IDS" GATE_TIMESTAMP="$GATE_TIMESTAMP" node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = process.argv[1];
    const ids = process.env.TASK_IDS.split(",").map((entry) => entry.trim()).filter(Boolean);
    const record = {
      timestamp: new Date().toISOString(),
      gate_timestamp: process.env.GATE_TIMESTAMP,
      tasks: ids,
      evidence_type: "task_tick",
    };
    fs.appendFileSync(path.join(dir, "task-ticks.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  ' "$EVIDENCE_DIR" 2>/dev/null || true
fi

exit 0
