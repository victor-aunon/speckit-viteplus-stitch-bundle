#!/usr/bin/env bash
# ==============================================================================
# check-bundle-preflight.sh
# ------------------------------------------------------------------------------
# Verifies the installed bundle is complete BEFORE any agent time is spent.
#
# The failure mode this exists to kill: a script missing from the install turns
# into a gate that fails forever ("nothing to reconcile", "cannot mark a task"),
# the repair loop spends its three 30-minute windows on a problem no agent can
# fix, and the abort message names the wrong cause. Five seconds of checking
# replaces ninety minutes of guessing.
#
# It is read-only and never repairs anything itself: it prints exactly what is
# missing and the command that fixes it.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"
BUNDLE_ID="viteplus-stitch"

show_help() {
  cat << 'EOF'
Usage: check-bundle-preflight.sh [options]

Read-only completeness check for the installed viteplus-stitch bundle: required
scripts present and executable, node available, Spec Kit layout intact.

It never fixes anything. It prints what is missing and the command that installs
it, so a broken install fails in seconds instead of burning a repair window.

Options:
  --help                 Show this help message
  --quiet                Only print the final verdict
  --skip-node-check      Do not require node (for constrained environments)

Exit Codes:
  0   The bundle is complete
  2   Something required is missing or not executable
EOF
}

QUIET=false
SKIP_NODE=false
for arg in "$@"; do
  case "$arg" in
    --help) show_help; exit 0 ;;
    --quiet) QUIET=true ;;
    --skip-node-check) SKIP_NODE=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

# Every script the workflow invokes. Keep in sync with
# `tests/check-bundle-preflight.test.ts`, which parses workflow.yml and fails if
# this list drifts from what the workflow actually calls.
REQUIRED_SCRIPTS=(
  bootstrap-project-env.sh
  check-blast-radius.sh
  check-bundle-budget.sh
  check-contracts.sh
  check-design-artifacts.sh
  check-dev-entrypoint.sh
  check-env-config.sh
  check-ghost-classes.sh
  check-quality-gate.sh
  check-tasks-complete.sh
  check-verification-verdict.sh
  emit-telemetry.sh
  mark-task-done.sh
  reconcile-task-ledger.sh
  repair-loop-guard.sh
  design-seal.sh
  watch-run.sh
  verify-stitch-design.sh
)
# check-env-config.sh and check-ghost-classes.sh are not invoked by the workflow
# directly; they are called by check-quality-gate.sh and check-contracts.sh
# behind `if [ -f ... ]`, which SKIPS the gate when the script is absent. An
# install where they are missing would pass every gate while silently not
# checking env centralisation or ghost classes.
#
# check-bundle-preflight.sh is deliberately not in its own list: it is the
# checker, and a missing checker must degrade to a warning, not a deadlock.

# Node-executed helpers (not executable bits, but just as required).
REQUIRED_MODULES=(
  reconcile-package-manifest.mjs
  render-design-goldens.mjs
)

MISSING=()
NOT_EXECUTABLE=()

for script in "${REQUIRED_SCRIPTS[@]}"; do
  target="$SCRIPT_DIR/$script"
  if [ ! -f "$target" ]; then
    MISSING+=("$script")
  elif [ ! -x "$target" ]; then
    NOT_EXECUTABLE+=("$script")
  fi
done

for module in "${REQUIRED_MODULES[@]}"; do
  [ -f "$SCRIPT_DIR/$module" ] || MISSING+=("$module")
done

NODE_MISSING=false
if [ "$SKIP_NODE" = false ] && ! command -v node >/dev/null 2>&1; then
  NODE_MISSING=true
fi

PROBLEMS=$(( ${#MISSING[@]} + ${#NOT_EXECUTABLE[@]} ))
if [ "$NODE_MISSING" = true ]; then
  PROBLEMS=$((PROBLEMS + 1))
fi

if [ "$PROBLEMS" -eq 0 ]; then
  if [ "$QUIET" = false ]; then
    echo "✓ [PREFLIGHT] Bundle '$BUNDLE_ID' is complete: ${#REQUIRED_SCRIPTS[@]} scripts, ${#REQUIRED_MODULES[@]} modules, node present."
  fi
  exit 0
fi

echo ""
echo "❌ [PREFLIGHT FAILED] The installed '$BUNDLE_ID' bundle is incomplete."
echo "   This is an installation problem, not a code problem: no agent edit can fix it,"
echo "   and continuing would burn repair windows on gates that cannot pass."
echo ""
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "   Missing (${#MISSING[@]}):"
  printf '     - %s\n' "${MISSING[@]}"
fi
if [ ${#NOT_EXECUTABLE[@]} -gt 0 ]; then
  echo "   Present but not executable (${#NOT_EXECUTABLE[@]}):"
  printf '     - %s\n' "${NOT_EXECUTABLE[@]}"
fi
if [ "$NODE_MISSING" = true ]; then
  echo "   Missing: node (required by the evidence-producing gates)"
fi
echo ""
echo "   Fix it with one of:"
echo "     specify bundle install $BUNDLE_ID     # managed install"
echo "     bash <bundle>/scripts/install.sh      # from the bundle checkout"
echo "     chmod +x .specify/scripts/bash/*.sh   # permissions only"
echo ""
echo "   Then resume: specify workflow resume"
exit 2
