#!/usr/bin/env bash
# ==============================================================================
# bootstrap-project-env.sh
# ------------------------------------------------------------------------------
# Deterministic, idempotent project bootstrap for the quality gates.
#
# Some gate failures are not application bugs and no LLM should be asked to
# "fix" them by hand:
#   - The project does not own its git repository (gates would audit an ancestor).
#   - The Playwright design config / audit spec templates were never materialized,
#     making the visual gate impossible to pass.
#
# This script fixes both, never overwrites existing files, and never fails the
# workflow: the gates remain the authority on whether the project is ready.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: bootstrap-project-env.sh [options]

Idempotent environment bootstrap for the quality gates.

Options:
  --help               Show this help message
  --root=<path>        Project root (default: current working directory)
  --designs-dir=<path> Feature designs directory (default: newest specs/*/designs)
  --no-git             Do not initialize a git repository
  --no-templates       Do not materialize Playwright/design-audit templates
  --quiet              Only print actions, not the summary

What it does:
  1. Creates a .git repository when the project root has none, and records a
     baseline commit so diff-based gates have a HEAD to compare against.
  2. Ensures node_modules/, dist/, .specify/workflows/runs/ and
     .specify/telemetry.jsonl are git-ignored before the baseline commit.
  3. Copies the Playwright design config and design-audit spec from
     .specify/templates/ so the visual gate can actually run.

Exit Codes:
  0  Bootstrap completed (with or without actions)
EOF
}

ROOT="$PWD"
DESIGNS_DIR=""
DO_GIT=true
DO_TEMPLATES=true
QUIET=false
PROFILE=""
HAS_UI=""

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --root=*)
      ROOT="${arg#*=}"
      ;;
    --designs-dir=*)
      DESIGNS_DIR="${arg#*=}"
      ;;
    --profile=*)
      PROFILE="${arg#*=}"
      ;;
    --has-ui=*)
      HAS_UI="${arg#*=}"
      ;;
    --no-git)
      DO_GIT=false
      ;;
    --no-templates)
      DO_TEMPLATES=false
      ;;
    --quiet)
      QUIET=true
      ;;
    *)
      ;;
  esac
done

if [ ! -d "$ROOT" ]; then
  echo "❌ [BOOTSTRAP ERROR]: project root does not exist: $ROOT"
  exit 2
fi

echo "======================================================================"
echo "[BOOTSTRAP] Deterministic project environment"
echo "======================================================================"
echo "   Root: $ROOT"

ACTIONS=0

# ------------------------------------------------------------------------------
# 1. Git ownership + baseline commit
# ------------------------------------------------------------------------------
if [ "$DO_GIT" = true ] && command -v git >/dev/null 2>&1; then
  if [ ! -e "$ROOT/.git" ]; then
    if git -C "$ROOT" init -q 2>/dev/null; then
      echo "✓ Initialized git repository at $ROOT"
      ACTIONS=$((ACTIONS + 1))
    else
      echo "⚠️  [BOOTSTRAP WARNING]: could not initialize git repository at $ROOT."
    fi
  fi

  if [ -e "$ROOT/.git" ]; then
    # Never stage dependencies or build output into a baseline snapshot.
    GITIGNORE="$ROOT/.gitignore"
    # Run state and telemetry are local artifacts: state.json stores the stdout
    # and stderr of every prompt/command step (agent transcripts), so committing
    # them leaks context into the repository and bloats the baseline.
    for ignore_entry in "node_modules/" "dist/" ".specify/workflows/runs/" ".specify/telemetry.jsonl"; do
      if [ ! -f "$GITIGNORE" ]; then
        printf '%s\n' "$ignore_entry" >> "$GITIGNORE"
        echo "✓ Created .gitignore with $ignore_entry"
        ACTIONS=$((ACTIONS + 1))
      elif ! grep -qxF "$ignore_entry" "$GITIGNORE" 2>/dev/null; then
        printf '%s\n' "$ignore_entry" >> "$GITIGNORE"
        echo "✓ Added $ignore_entry to .gitignore"
        ACTIONS=$((ACTIONS + 1))
      fi
    done

    if ! git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
      git -C "$ROOT" add -A 2>/dev/null || true
      if git -C "$ROOT" \
        -c user.name="spec-kit bootstrap" \
        -c user.email="spec-kit@localhost" \
        commit -q --allow-empty -m "chore: baseline snapshot before spec-driven implementation" 2>/dev/null; then
        echo "✓ Recorded baseline commit (diff-based gates now have a HEAD)"
        ACTIONS=$((ACTIONS + 1))
      else
        echo "⚠️  [BOOTSTRAP WARNING]: could not record a baseline commit; diff-based gates may be blind."
      fi
    fi
  fi
fi

# ------------------------------------------------------------------------------
# 2. Template assets (AGENTS.md & Playwright design assets)
# ------------------------------------------------------------------------------
if [ "$DO_TEMPLATES" = true ]; then
  TEMPLATES_DIR="$ROOT/.specify/templates"

  resolve_template() {
    local name="$1"
    if [ -f "$TEMPLATES_DIR/$name" ]; then
      printf '%s' "$TEMPLATES_DIR/$name"
      return 0
    fi
    if [ -f "$TEMPLATES_DIR/$name.tmpl" ]; then
      printf '%s' "$TEMPLATES_DIR/$name.tmpl"
      return 0
    fi
    return 1
  }

  # A. Profile-tailored AGENTS.md
  RESOLVED_PROFILE="$PROFILE"
  if [ -z "$RESOLVED_PROFILE" ]; then
    if [ "$HAS_UI" = "false" ]; then
      RESOLVED_PROFILE="api"
    fi
  fi

  if [ -n "$RESOLVED_PROFILE" ]; then
    AGENTS_TMPL="AGENTS.${RESOLVED_PROFILE}.md"
  else
    AGENTS_TMPL="AGENTS.md"
  fi

  if [ ! -f "$ROOT/AGENTS.md" ]; then
    if AGENTS_SRC="$(resolve_template "$AGENTS_TMPL")"; then
      cp "$AGENTS_SRC" "$ROOT/AGENTS.md"
      echo "✓ Materialized AGENTS.md (${RESOLVED_PROFILE:-default} profile) from $(basename "$AGENTS_SRC")"
      ACTIONS=$((ACTIONS + 1))
    elif AGENTS_SRC="$(resolve_template "AGENTS.md")"; then
      cp "$AGENTS_SRC" "$ROOT/AGENTS.md"
      echo "✓ Materialized AGENTS.md from $(basename "$AGENTS_SRC")"
      ACTIONS=$((ACTIONS + 1))
    fi
  fi

  # B. Playwright design assets (UI features only)
  if [ "$HAS_UI" = "false" ]; then
    if [ "$QUIET" = false ]; then
      echo "ℹ️  Non-UI feature/project (has-ui=false); skipping Playwright asset materialization."
    fi
  else
    if [ -z "$DESIGNS_DIR" ] && [ -d "$ROOT/specs" ]; then
      DESIGNS_DIR="$(find "$ROOT/specs" -mindepth 2 -maxdepth 2 -type d -name designs 2>/dev/null | sort -r | head -n 1 || true)"
    fi

    if [ -n "$DESIGNS_DIR" ] && [ -d "$DESIGNS_DIR" ]; then
      if [ ! -f "$ROOT/playwright.design.config.ts" ]; then
        if CONFIG_SRC="$(resolve_template "playwright.design.config.ts")"; then
          cp "$CONFIG_SRC" "$ROOT/playwright.design.config.ts"
          echo "✓ Materialized playwright.design.config.ts from $(basename "$CONFIG_SRC")"
          ACTIONS=$((ACTIONS + 1))
        else
          echo "⚠️  [BOOTSTRAP WARNING]: no Playwright design config template found in $TEMPLATES_DIR."
        fi
      fi

      if [ ! -f "$ROOT/tests/design/design-audit.spec.ts" ]; then
        if SPEC_SRC="$(resolve_template "design-audit.spec.ts")"; then
          mkdir -p "$ROOT/tests/design"
          cp "$SPEC_SRC" "$ROOT/tests/design/design-audit.spec.ts"
          echo "✓ Materialized tests/design/design-audit.spec.ts from $(basename "$SPEC_SRC")"
          ACTIONS=$((ACTIONS + 1))
        else
          echo "⚠️  [BOOTSTRAP WARNING]: no design-audit spec template found in $TEMPLATES_DIR."
        fi
      fi
    elif [ "$QUIET" = false ]; then
      echo "ℹ️  No designs directory found; skipping Playwright asset materialization."
    fi
  fi
fi

echo ""
if [ "$ACTIONS" -eq 0 ]; then
  echo "✓ [BOOTSTRAP] Nothing to do; the environment is already in place."
else
  echo "✅ [BOOTSTRAP] Applied $ACTIONS deterministic fix(es)."
fi
exit 0
