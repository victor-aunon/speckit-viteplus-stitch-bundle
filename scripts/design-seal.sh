#!/usr/bin/env bash
# ==============================================================================
# design-seal.sh
# ------------------------------------------------------------------------------
# Prints a deterministic content seal for the design master.
#
# Why this exists. `verify-stitch-design.sh` re-renders the golden screenshots
# from `designs/<screen>.html` on every run and then grades the implementation
# against them. If the reference can change between runs, the agent is grading its
# own homework: edit the master until it matches the implementation, re-render, and
# the visual gate reports fidelity.
#
# That is not hypothetical. A real run edited `designs/screen-modal-confirmation-
# dialog.html` (added `min-height: 2.75rem`) at 13:39, the visual gate re-ran at
# 13:44 and passed — against the reference the agent had just moved. The auditor
# never saw it because the audit protocol is explicitly "from-scratch, not a diff
# review".
#
# The seal is taken when the design gate passes (`check-design-artifacts.sh`
# records it in `design-artifacts.json`) and recomputed by the visual gate. A
# changed design is not silently tolerated: the visual gate fails and tells the
# operator to re-seal deliberately. Re-sealing is not forbidden — it is an act
# that lands in the evidence history and in the telemetry, which is the difference
# between a decision and an accident.
#
# Usage:
#   design-seal.sh --designs-dir=<path>
#
# Output: the hex digest on stdout. An empty line when the directory does not
# exist, because "no designs" has to be distinguishable from "unreadable".
# ==============================================================================

set -euo pipefail

DESIGNS_DIR=""

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --designs-dir=*)
      DESIGNS_DIR="${arg#*=}"
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run 'design-seal.sh --help' for usage." >&2
      exit 2
      ;;
  esac
done

if [ -z "$DESIGNS_DIR" ]; then
  echo "Usage: design-seal.sh --designs-dir=<path>" >&2
  exit 2
fi

if [ ! -d "$DESIGNS_DIR" ]; then
  printf '\n'
  exit 0
fi

# Portable content hash: macOS ships `shasum`, GNU/Linux ships `sha256sum`, and
# `cksum` exists everywhere else. Same ladder as repair-loop-guard.sh.
hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    cksum | awk '{print $1 "-" $2}'
  fi
}

# The path is hashed as well as the content, so renaming a screen is a change too.
# `LC_ALL=C sort` keeps the order byte-stable across machines.
(
  cd "$DESIGNS_DIR" || exit 0
  find . -type f -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r file; do
    printf '%s\n' "$file"
    cat -- "$file" 2>/dev/null || true
    printf '\n'
  done
) | hash_stream
