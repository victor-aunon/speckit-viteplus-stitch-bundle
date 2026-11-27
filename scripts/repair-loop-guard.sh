#!/usr/bin/env bash
# ==============================================================================
# repair-loop-guard.sh
# ------------------------------------------------------------------------------
# Stops the self-healing repair loop when an iteration cannot make progress.
#
# The repair window is the most expensive step in the workflow: one agent call
# with a 30-minute timeout, repeated up to `max_iterations` times. When a failure
# is not repairable by the loop — the offending file sits inside the blast-radius
# protected set, the gate itself is buggy, or the agent simply stalls — the next
# iteration starts from the same tree and fails the same way. Burning three
# windows to learn what the first one already proved is the single largest
# source of wasted wall-clock time in the run.
#
# This guard fingerprints the working tree at the START of an iteration and
# compares it at the END. An iteration that produced no change cannot be
# followed by a different outcome, so the loop is allowed to stop there.
#
# Verbs:
#   --snapshot   Record the current fingerprint (call at the start of an iteration).
#   --assess     Compare against the snapshot. Exit 1 when nothing changed, so the
#                do-while condition that reads this step stops the loop.
#   --reset      Delete the stored snapshot and reason.
#
# It also measures the iteration, because nothing else did: see `--help`.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

# `.specify/` is git-ignored in the installed project, so loop state lives there
# and never pollutes the working tree it is measuring.
STATE_DIR=".specify/.repair-loop"
VERB=""
WINDOW_STEP="repair_agent"

show_help() {
  cat << 'EOF'
Usage: repair-loop-guard.sh [options]

Detects a repair iteration that changed nothing, so the workflow can stop the
self-healing loop instead of spending its remaining attempts on an identical
failure.

Verbs:
  --snapshot             Record the working-tree fingerprint for this iteration.
  --assess               Compare with the snapshot. Exit 1 when the tree is
                         unchanged (no progress); exit 0 when it changed or when
                         no baseline exists.
  --reset                Delete the stored snapshot and reason.

Options:
  --state-dir=<path>     Directory for the snapshot (default: .specify/.repair-loop)
  --step=<name>          Step name recorded on the `repair_window` telemetry event
                         (default: repair_agent). The verdict loop passes
                         verdict_repair_agent so the two windows stay distinct.
  --help                 Show this message.

The guard also measures the iteration: `--snapshot` records when the repair
window opened and `--assess` emits a `repair_window` telemetry event carrying
the elapsed time. Measuring HERE rather than reading it back from the engine is
deliberate: a real run wrote no `repair_agent` step event at all, so a repair
phase lasting nearly three hours was entirely unattributed and the cost model
had to be guessed. The span covers snapshot -> assess, i.e. the agent window
plus the gate rechecks; the rechecks are seconds, so it is effectively the
agent's own wall clock.

Exit Codes:
  0                Progress detected, or no baseline to compare against.
  1                The iteration produced no change (stalled).
  2                Invalid usage.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help) show_help; exit 0 ;;
    --snapshot) VERB="snapshot" ;;
    --assess) VERB="assess" ;;
    --reset) VERB="reset" ;;
    --state-dir=*) STATE_DIR="${arg#--state-dir=}" ;;
    --step=*) WINDOW_STEP="${arg#--step=}" ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run 'repair-loop-guard.sh --help' for usage." >&2
      exit 2
      ;;
  esac
done

SNAPSHOT_FILE="$STATE_DIR/fingerprint"
REASON_FILE="$STATE_DIR/reason.txt"
WINDOW_START_FILE="$STATE_DIR/window-start"
WINDOW_STEP_FILE="$STATE_DIR/window-step"

if [ -z "$VERB" ]; then
  show_help
  exit 2
fi

if [ "$VERB" = "reset" ]; then
  rm -f "$SNAPSHOT_FILE" "$REASON_FILE" "$WINDOW_START_FILE" "$WINDOW_STEP_FILE" 2>/dev/null || true
  echo "✓ [REPAIR LOOP GUARD] Stored loop state cleared."
  exit 0
fi

# Pathspec excludes shared by every git call below.
#
# `specs/*/evidence` is rewritten by every gate run — each evidence file carries
# a fresh timestamp and an append-only history — so counting it as progress would
# make this detector never fire. Build and report directories are excluded as
# well, so a project that forgot to ignore them cannot turn every
# `--untracked-files=all` walk into a full filesystem crawl.
# NOTE on the trailing `/**`: in a pathspec, `*` does NOT cross a `/` (unlike a
# gitignore pattern), so `:(exclude)specs/*/evidence` alone fails to exclude the
# files inside it. `specs/*/evidence/**` is the form that actually matches.
#
# `specs/*/designs/` is deliberately NOT excluded: generating the design
# artifacts is a legitimate repair for the contracts/visual gates.
EXCLUDES=(
  # All Spec Kit tooling. Normally covered by the `.specify` gitignore rule, but
  # excluded explicitly because a tracked `.specify/` would otherwise make this
  # guard compare its OWN output: the telemetry and state files are rewritten on
  # every run, so the tree would always look changed and the detector would be
  # dead code. No legitimate application repair lives here either — the blast
  # radius protects `.specify/scripts`, `.specify/workflows`, `.specify/memory`
  # and `.specify/templates`, so an agent edit under `.specify/` is a violation,
  # not progress.
  ':(exclude).specify/**'
  # Rewritten by every gate run (fresh timestamp + append-only history), so
  # counting it as progress would make this detector never fire.
  ':(exclude)specs/*/evidence/**'
  ':(exclude)node_modules/**'
  ':(exclude)dist/**'
  ':(exclude)build/**'
  ':(exclude)coverage/**'
  ':(exclude)test-results/**'
  ':(exclude)playwright-report/**'
)

# Print a content-level description of the working tree. Returns 1 (and prints
# nothing) when this is not a git work tree, so the guard can stay out of the way:
# the git-root failure belongs to the quality gate, not to this script.
build_fingerprint() {
  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 1
  fi

  # A COMMIT IS PROGRESS TOO.
  #
  # `git status` and `git diff HEAD` are BOTH empty once the agent commits its
  # work, so a window that ended in a commit looked byte-identical to a window
  # that did nothing. In a real run that produced a false "stalled" verdict after
  # a 13-minute window that had actually fixed things, and the loop stopped right
  # after the most productive iteration. The tip SHA is what distinguishes them.
  git rev-parse HEAD 2>/dev/null || printf '%s\n' 'no-head'

  # Paths and status codes for everything git tracks or sees as untracked.
  git status --porcelain --untracked-files=all -- . "${EXCLUDES[@]}" 2>/dev/null || true

  # Full content diff against the last commit. `|| true` because a repository
  # with no commits yet has no HEAD to diff against; the `git status` line above
  # already reports every path in that case.
  git diff HEAD -- . "${EXCLUDES[@]}" 2>/dev/null || true

  # `git status` lists untracked paths by name only, so editing a brand-new file
  # at the same path would look like no progress. Hash the contents as well.
  git ls-files --others --exclude-standard -- . "${EXCLUDES[@]}" 2>/dev/null \
    | while IFS= read -r untracked; do
        [ -n "$untracked" ] || continue
        [ -f "$untracked" ] || continue
        printf '%s\n' "$untracked"
        cat -- "$untracked" 2>/dev/null || true
        printf '\n'
      done
}

# Portable content hash: macOS ships `shasum`, GNU/Linux ships `sha256sum`, and
# `cksum` exists everywhere else. A weaker hash only risks a missed stall, never
# a false one, because it is compared against itself.
hash_fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    cksum | awk '{print $1 "-" $2}'
  fi
}

# Emit the measured window. Best-effort on purpose: telemetry must never decide
# whether the loop continues, so every failure path here returns 0 and the caller
# still exits with the stall verdict.
emit_window_telemetry() {
  local started step now elapsed_ms
  started="$(cat "$WINDOW_START_FILE" 2>/dev/null || true)"
  # Reject anything that is not a plain epoch, including an empty file: arithmetic
  # on it inside `$(( ))` under `set -u`/`set -e` would abort the step.
  case "$started" in
    ''|*[!0-9]*) return 0 ;;
  esac

  step="$(cat "$WINDOW_STEP_FILE" 2>/dev/null || true)"
  [ -n "$step" ] || step="$WINDOW_STEP"

  now="$(date +%s)"
  elapsed_ms=$(( (now - started) * 1000 ))
  [ "$elapsed_ms" -ge 0 ] 2>/dev/null || elapsed_ms=0

  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --event=repair_window \
      --step="$step" \
      --status=end \
      --duration-ms="$elapsed_ms" \
      >/dev/null 2>&1 || true
  fi

  echo "⏱️  [REPAIR LOOP GUARD] Repair window ($step) lasted $(( elapsed_ms / 1000 ))s."
  return 0
}

cmd_snapshot() {
  local raw
  # Start the clock before any early return, so a non-git project still reports
  # how long the iteration took.
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  date +%s > "$WINDOW_START_FILE" 2>/dev/null || true
  printf '%s' "$WINDOW_STEP" > "$WINDOW_STEP_FILE" 2>/dev/null || true

  if ! raw="$(build_fingerprint)"; then
    rm -f "$SNAPSHOT_FILE" "$REASON_FILE" 2>/dev/null || true
    echo "ℹ️  [REPAIR LOOP GUARD] Not a git work tree; progress detection disabled for this iteration."
    return 0
  fi

  printf '%s' "$raw" | hash_fingerprint > "$SNAPSHOT_FILE" 2>/dev/null || true
  rm -f "$REASON_FILE" 2>/dev/null || true
  echo "✓ [REPAIR LOOP GUARD] Captured the iteration baseline and opened the window."
  return 0
}

cmd_assess() {
  # Measure first, so the window is recorded for every outcome (stall, progress
  # or no baseline) instead of only for the cases that would have been logged.
  emit_window_telemetry

  if [ ! -s "$SNAPSHOT_FILE" ]; then
    echo "ℹ️  [REPAIR LOOP GUARD] No baseline captured; letting the loop continue."
    return 0
  fi

  local previous raw current
  previous="$(cat "$SNAPSHOT_FILE" 2>/dev/null || true)"

  if ! raw="$(build_fingerprint)"; then
    echo "ℹ️  [REPAIR LOOP GUARD] Not a git work tree; letting the loop continue."
    return 0
  fi
  current="$(printf '%s' "$raw" | hash_fingerprint)"

  if [ "$previous" = "$current" ]; then
    mkdir -p "$STATE_DIR" 2>/dev/null || true
    {
      echo "This iteration produced no observable progress: the working tree is"
      echo "unchanged and HEAD did not move."
      echo "Repeating the same window would reproduce the same failure, so the"
      echo "remaining repair attempts were not spent."
      echo ""
      echo "What counts as progress: any change to the tracked/untracked tree"
      echo "(excluding .specify/**, specs/*/evidence/** and build output) or a new"
      echo "commit. Rewriting only the evidence files does NOT count, by design."
      echo ""
      echo "Treat this failure as NOT repairable by the autonomous loop, unless the"
      echo "window genuinely could not touch anything:"
      echo "  1. Read the evidence under specs/<feature>/evidence/ and the gate output"
      echo "     above; the real cause is almost always named there."
      echo "  2. If the offending file is in a protected path (see"
      echo "     check-blast-radius.sh), change the supporting configuration instead"
      echo "     of the protected file, or escalate to a human."
      echo "  3. Fix the root cause, then resume with 'specify workflow resume'."
    } > "$REASON_FILE" 2>/dev/null || true

    echo "⚠️  [REPAIR LOOP STALLED] The repair agent produced no change to the working tree."
    echo "   Re-running an identical window would repeat the same failure, so the loop"
    echo "   stops here instead of spending the remaining repair attempts."
    return 1
  fi

  echo "✓ [REPAIR LOOP GUARD] The iteration changed the working tree; the loop may retry."
  return 0
}

case "$VERB" in
  snapshot) cmd_snapshot; exit 0 ;;
  assess) cmd_assess || exit 1; exit 0 ;;
  *) show_help; exit 2 ;;
esac
