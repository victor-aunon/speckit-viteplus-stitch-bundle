#!/usr/bin/env bash
# ==============================================================================
# watch-run.sh
# ------------------------------------------------------------------------------
# Run a workflow and resume it across prompt timeouts.
#
# Why this exists: the workflow engine has no `retry` for a `prompt` step. When a
# model hangs, the step fails with "Prompt timed out after N seconds", the run
# ends, and somebody has to type `specify workflow resume <id>` before it moves
# again. A real run lost two hours that way — not because the pipeline is slow,
# but because it was waiting for a human who was away from the machine.
#
# This is a LANCHER, not a supervisor of correctness. It retries exactly one
# failure mode (a prompt timeout) and refuses every other:
#
#   * only an error containing "timed out" is resumed. Retrying a real failure
#     burns the attempt budget and buries the bug behind a wall of retries.
#   * a run that ends `paused` is left alone. A pause is a phase checkpoint
#     waiting for a person, and resuming it would skip that review.
#   * the number of resumes is capped (`--max-resumes`, default 6), so a model
#     that hangs every single time cannot loop forever.
#
# What it does NOT cover: a hang that never reaches the timeout. The run stays
# `running`, `resume` refuses a running run, and this script is itself blocked
# waiting for the command to return. That has to be fixed in the engine.
#
# Usage:
#   watch-run.sh <workflow-id-or-path> [--input k=v ...]
#   watch-run.sh --resume=<run-id> [--input k=v ...]
#
# Options:
#   --resume=<run-id>     Supervise an existing run instead of starting a new one.
#   --max-resumes=<n>     Give up after n resumes (default 6).
#   --delay=<seconds>     Wait before each resume (default 60).
#   --help                Show this message.
#
# Exit codes:
#   0   the run completed, or it is paused waiting for you
#   1   it failed for a reason that is not a timeout, or the budget ran out
#   2   invalid usage, or the CLI/JSON parser is unavailable
# ==============================================================================

set -uo pipefail

MAX_RESUMES=6
DELAY=60
RESUME_ID=""
PASSTHRU=()

show_help() {
  sed -n '2,44p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      show_help
      exit 0
      ;;
    --resume=*)
      RESUME_ID="${arg#*=}"
      ;;
    --max-resumes=*)
      MAX_RESUMES="${arg#*=}"
      ;;
    --delay=*)
      DELAY="${arg#*=}"
      ;;
    *)
      PASSTHRU+=("$arg")
      ;;
  esac
done

if [ -z "$RESUME_ID" ] && [ ${#PASSTHRU[@]} -eq 0 ]; then
  show_help
  exit 2
fi

if ! command -v specify >/dev/null 2>&1; then
  echo "❌ 'specify' is not on PATH; nothing to supervise." >&2
  exit 2
fi

# Node is a bundle-wide dependency (the reconcilers are Node), and `--json` output
# needs a real parser: a timeout message can contain quotes and colons.
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 'node' is required to parse the workflow's --json output." >&2
  exit 2
fi

# `field <name>` prints one top-level key of a JSON document on stdin, or "".
field() {
  node -e '
    const key = process.argv[1];
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(raw)[key];
        process.stdout.write(value === undefined || value === null ? "" : String(value));
      } catch {
        process.stdout.write("");
      }
    });
  ' "$1"
}

if [ -n "$RESUME_ID" ]; then
  out="$(specify workflow resume "$RESUME_ID" --json ${PASSTHRU[@]+"${PASSTHRU[@]}"} 2>/dev/null)"
else
  out="$(specify workflow run ${PASSTHRU[@]+"${PASSTHRU[@]}"} --json 2>/dev/null)"
fi

run_id="$(printf '%s' "$out" | field run_id)"
status="$(printf '%s' "$out" | field status)"

if [ -z "$run_id" ]; then
  echo "❌ Could not start or resume the run: no run_id in the output." >&2
  printf '%s\n' "$out" | head -5 >&2
  exit 2
fi

for ((attempt = 1; attempt <= MAX_RESUMES; attempt++)); do
  case "$status" in
    completed)
      echo "✓ run $run_id completed"
      exit 0
      ;;
    paused)
      echo "⏸  run $run_id paused — waiting for a human; not resuming"
      exit 0
      ;;
  esac

  error="$(printf '%s' "$out" | field error)"
  case "$error" in
    *"timed out"*) ;;
    *)
      echo "✗ run $run_id failed for a reason that is not a timeout: $error"
      exit 1
      ;;
  esac

  echo "… timeout on $run_id — resume $attempt/$MAX_RESUMES in ${DELAY}s"
  sleep "$DELAY"
  out="$(specify workflow resume "$run_id" --json 2>/dev/null)"
  status="$(printf '%s' "$out" | field status)"
done

echo "✗ gave up on $run_id after $MAX_RESUMES resume(s); the last attempt also timed out"
exit 1
