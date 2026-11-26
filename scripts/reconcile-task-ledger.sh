#!/usr/bin/env bash
# ==============================================================================
# reconcile-task-ledger.sh
# ------------------------------------------------------------------------------
# Makes the tagged part of `tasks.md` a DERIVED value of the gate evidence.
#
# WHY THIS EXISTS
# The task checkbox used to be a hand-maintained mirror of gate state: the agent
# was told to tick a box only after `check-quality-gate.sh` exits 0, and that gate
# runs the whole suite and the build, so it cannot pass mid-feature. A compliant
# agent therefore ticked nothing, and polish/verification tasks -- whose content
# IS the gates -- were only markable after the gates passed, i.e. after the point
# where the ledger had already been judged.
#
# Prompting the agent to "reconcile at the end" fixed the deadlock but left the
# checkbox under its control, which is trust, not verification. This script moves
# the tasks that describe a gate out of the agent's hands entirely:
#
#   - [ ] T040 [verify:quality] Run the full suite and fix regressions
#
# A tagged task is ticked when, and only when, the gate it names reports
# `status: "passed"` in the evidence the gate itself wrote. If the gate is red the
# box is UN-ticked, so the ledger cannot keep claiming a verification that has
# since regressed. Untagged tasks are left completely untouched: those are real
# implementation work and only the agent knows whether they are done.
#
# A tag naming an unknown gate is an error, not a silent no-op: a typo would
# otherwise disable the check while looking like coverage.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: reconcile-task-ledger.sh [options]

Ticks (or un-ticks) every `tasks.md` checkbox carrying a `[verify:<gate>]` tag,
based on the evidence that gate wrote. Untagged tasks are never modified.

Tag vocabulary (each maps to an evidence file under <feature>/evidence/):
  [verify:quality]     quality-gate.json
  [verify:contracts]   contracts.json
  [verify:design]      stitch-design.json
  [verify:bundle]      bundle-budget.json
  [verify:runtime]     runtime-entrypoint.json

A tagged task is checked when its gate reports status "passed", and unchecked
otherwise. The ledger therefore cannot disagree with the gates.

Options:
  --help                 Show this help message
  --feature-dir=<path>   Feature directory (default: newest under specs/)
  --tasks=<path>         Direct path to tasks.md
  --evidence-dir=<path>  Directory holding the gate evidence JSON
  --dry-run              Report what would change without writing tasks.md
  --quiet                Only print the final verdict

Exit Codes:
  0   Reconciled (or nothing to reconcile)
  1   A tagged gate is not green; the affected tasks are left unchecked
  2   Configuration error: unknown tag, missing node, unreadable tasks.md
EOF
}

FEATURE_DIR=""
TASKS_FILE=""
EVIDENCE_DIR=""
DRY_RUN=false
QUIET=false

for arg in "$@"; do
  case "$arg" in
    --help) show_help; exit 0 ;;
    --feature-dir=*) FEATURE_DIR="${arg#*=}" ;;
    --tasks=*) TASKS_FILE="${arg#*=}" ;;
    --evidence-dir=*) EVIDENCE_DIR="${arg#*=}" ;;
    --dry-run) DRY_RUN=true ;;
    --quiet) QUIET=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

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
  echo "❌ [TASK LEDGER] node is required to reconcile tasks.md." >&2
  exit 2
fi

if [ -z "$TASKS_FILE" ] || [ ! -f "$TASKS_FILE" ]; then
  if [ "$QUIET" = false ]; then
    echo "ℹ️  [TASK LEDGER]: no tasks.md found (${TASKS_FILE:-none}); nothing to reconcile."
    echo "   The completion gate owns that failure, not this script."
  fi
  exit 0
fi

OUTPUT="$(node - "$TASKS_FILE" "$EVIDENCE_DIR" "$DRY_RUN" << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const [tasksFile, evidenceDir, dryRunArg] = process.argv.slice(2);
const dryRun = dryRunArg === 'true';

/** Tag -> evidence file written by that gate. Keep in sync with show_help(). */
const GATE_EVIDENCE = {
  quality: 'quality-gate.json',
  contracts: 'contracts.json',
  design: 'stitch-design.json',
  bundle: 'bundle-budget.json',
  runtime: 'runtime-entrypoint.json',
};

const source = fs.readFileSync(tasksFile, 'utf8');
const lines = source.split('\n');
const TAG = /\[verify:([A-Za-z0-9_-]+)\]/;
const CHECKBOX = /^(\s*[-*]\s+\[)([ xX])(\]\s.*)$/;

const results = [];
const seen = new Set();
let changed = 0;

const gateState = (gate) => {
  const file = GATE_EVIDENCE[gate];
  if (!file) return { known: false };
  const full = path.join(evidenceDir || '', file);
  if (!fs.existsSync(full)) return { known: true, passed: false, reason: `no evidence (${file})` };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    return { known: true, passed: false, reason: `${file} is not valid JSON` };
  }
  // `passed` is written by the gate only after every check succeeded; any other
  // status (failed/skipped) means the verification described by the task was not
  // established, so the box must not stay ticked.
  const passed = payload && payload.status === 'passed';
  return { known: true, passed, reason: payload && payload.status ? `${file}: ${payload.status}` : `${file}: no status` };
};

const unknownTags = [];

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const checkbox = CHECKBOX.exec(line);
  if (!checkbox) continue;
  const tag = TAG.exec(line);
  if (!tag) continue;

  const gate = tag[1];
  const state = gateState(gate);
  if (!state.known) {
    unknownTags.push(gate);
    continue;
  }
  seen.add(gate);

  const desired = state.passed ? 'x' : ' ';
  const current = checkbox[2];
  if ((current === 'x' || current === 'X') === (desired === 'x')) {
    results.push({ line: index + 1, gate, ticked: state.passed, action: 'unchanged', reason: state.reason });
    continue;
  }

  if (!dryRun) {
    lines[index] = checkbox[1] + desired + checkbox[3];
  }
  changed += 1;
  results.push({
    line: index + 1,
    gate,
    ticked: state.passed,
    action: state.passed ? 'ticked' : 'unticked',
    reason: state.reason,
  });
}

if (unknownTags.length > 0) {
  console.log(
    JSON.stringify({
      status: 'error',
      error: `unknown [verify:*] tag(s): ${[...new Set(unknownTags)].join(', ')}`,
      known: Object.keys(GATE_EVIDENCE),
    })
  );
  process.exit(2);
}

if (!dryRun && changed > 0) {
  fs.writeFileSync(tasksFile, lines.join('\n'), 'utf8');
}

const failing = results.filter((entry) => !entry.ticked);
console.log(
  JSON.stringify({
    status: failing.length > 0 ? 'incomplete' : 'reconciled',
    dry_run: dryRun,
    changed,
    gates: [...seen],
    results,
  })
);
NODE_SCRIPT
)" || RECONCILE_STATUS=$?
RECONCILE_STATUS="${RECONCILE_STATUS:-0}"

# Surface the machine report without dropping it: the workflow stores this in the
# step output and the evidence artifact below.
if [ "$QUIET" = false ]; then
  echo "$OUTPUT" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
      let report;
      try {
        report = JSON.parse(raw.trim());
      } catch {
        console.log(raw);
        return;
      }
      if (report.error) {
        console.log(`❌ [TASK LEDGER] ${report.error}`);
        console.log(`   Known gates: ${report.known.join(", ")}`);
        return;
      }
      console.log(`[TASK LEDGER] ${report.dry_run ? "(dry-run) " : ""}tagged tasks: ${report.results.length}, changed: ${report.changed}`);
      for (const entry of report.results) {
        const mark = entry.ticked ? "✓" : "✗";
        console.log(`   ${mark} line ${entry.line} [verify:${entry.gate}] ${entry.action} — ${entry.reason}`);
      }
      if (report.results.length === 0) {
        console.log("   No [verify:*] tasks declared; every task is the agent'"'"'s responsibility.");
      }
    });
  '
fi

# Evidence is written by this script, not by hand, so the next run can tell the
# difference between "the ledger was reconciled" and "someone edited checkboxes".
if [ -n "$EVIDENCE_DIR" ] && [ "$DRY_RUN" = false ] && [ "$RECONCILE_STATUS" -eq 0 ]; then
  mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
  printf '%s\n' "$OUTPUT" > "$EVIDENCE_DIR/task-ledger.json" 2>/dev/null || true
fi

if [ "$RECONCILE_STATUS" -ne 0 ]; then
  echo "" >&2
  echo "❌ [TASK LEDGER] Could not reconcile: a [verify:*] tag names a gate this bundle does not define." >&2
  echo "   A typo here would silently disable the check while looking like coverage," >&2
  echo "   so it is a hard error. Valid tags: quality, contracts, design, bundle, runtime." >&2
  exit 2
fi

# A red tagged gate leaves its box unchecked; that is the honest state, and the
# completion gate will fail on it. Report it as such instead of pretending the
# ledger is finished.
if printf '%s' "$OUTPUT" | grep -q '"status":"incomplete"'; then
  exit 1
fi

exit 0
