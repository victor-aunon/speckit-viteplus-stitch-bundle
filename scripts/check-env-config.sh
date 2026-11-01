#!/usr/bin/env bash
# ==============================================================================
# check-env-config.sh
# ------------------------------------------------------------------------------
# Environment Configuration Quality Gate.
#
# Enforces two rules:
#   1. Application code must never read environment variables directly.
#   2. All environment access must live in one typed config module that exports
#      the values consumed by the application.
#
# Default config module: src/config/env.ts
# ==============================================================================

set -eo pipefail

show_help() {
  cat << 'EOF'
Usage: check-env-config.sh [options]

Fails when application code reads process.env / import.meta.env directly.
Environment access is only allowed inside a typed environment config module.

Options:
  --help                     Show this help message
  --env-config=<path>        Typed env config module (default: src/config/env.ts)
  --path=<path>              Additional path to scan (repeatable; default: src/app/packages/features or .)
  --require-config           Fail when the typed env config module does not exist

Exit Codes:
  0                          No direct env access outside the typed config module
  1                          Direct env access detected or invalid env config module
EOF
}

ENV_CONFIG="src/config/env.ts"
SCAN_PATHS=()
REQUIRE_CONFIG=false

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --env-config=*)
      ENV_CONFIG="${arg#*=}"
      ;;
    --path=*)
      SCAN_PATHS+=("${arg#*=}")
      ;;
    --require-config)
      REQUIRE_CONFIG=true
      ;;
    *)
      ;;
  esac
done

if [ ${#SCAN_PATHS[@]} -eq 0 ]; then
  for candidate in src app packages features; do
    if [ -d "$candidate" ]; then
      SCAN_PATHS+=("$candidate")
    fi
  done
  if [ ${#SCAN_PATHS[@]} -eq 0 ]; then
    SCAN_PATHS=(".")
  fi
fi

ENV_PATTERN="process[[:space:]]*\\.[[:space:]]*env|process[[:space:]]*\\[[[:space:]]*[\"']env[\"'][[:space:]]*\\]|import[[:space:]]*\\.[[:space:]]*meta[[:space:]]*\\.[[:space:]]*env|require[[:space:]]*\\([[:space:]]*[\"']process[\"'][[:space:]]*\\)[[:space:]]*\\.[[:space:]]*env|\\{[^}]*\\benv\\b[^}]*\\}[[:space:]]*=[[:space:]]*process\\b"

is_excluded_file() {
  local base
  base="$(basename "$1")"
  case "$base" in
    *.test.*|*.spec.*|*.d.ts)
      return 0
      ;;
    vite.config.*|vitest.config.*|playwright.config.*|playwright.*.config.*|tailwind.config.*|postcss.config.*|eslint.config.*|next.config.*|nuxt.config.*|svelte.config.*|webpack.config.*|rollup.config.*|tsup.config.*|jest.config.*|babel.config.*)
      return 0
      ;;
  esac
  return 1
}

normalize_path() {
  local path="$1"
  path="${path#./}"
  printf '%s' "$path"
}

ENV_CONFIG_NORMALIZED="$(normalize_path "$ENV_CONFIG")"
VIOLATIONS=0
CONFIG_ERRORS=0

echo "======================================================================"
echo "[ENV CONFIG GATE] Checking environment variable access"
echo "======================================================================"
echo "✓ Typed env config module: $ENV_CONFIG"

FILES=()
for scan_path in "${SCAN_PATHS[@]}"; do
  if [ ! -e "$scan_path" ]; then
    continue
  fi
  while IFS= read -r -d '' file; do
    FILES+=("$file")
  done < <(
    find "$scan_path" \
      \( -type d \( -name node_modules -o -name dist -o -name build -o -name coverage \
        -o -name .git -o -name .specify -o -name .next -o -name out \
        -o -name __tests__ -o -name tests \) -prune \) -o \
      \( -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
        -o -name '*.mts' -o -name '*.cts' -o -name '*.mjs' -o -name '*.cjs' \) -print0 \) \
      2>/dev/null
  )
done

for file in "${FILES[@]}"; do
  normalized_file="$(normalize_path "$file")"

  if [ "$normalized_file" = "$ENV_CONFIG_NORMALIZED" ]; then
    continue
  fi
  if is_excluded_file "$normalized_file"; then
    continue
  fi

  matches="$(grep -nE "$ENV_PATTERN" "$file" 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    echo ""
    echo "❌ Direct environment access found in: $normalized_file"
    printf '%s\n' "$matches" | sed 's/^/     /'
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ -f "$ENV_CONFIG" ]; then
  echo "✓ Found typed env config module"

  if ! grep -Eq "$ENV_PATTERN" "$ENV_CONFIG"; then
    echo "❌ Env config module does not read process.env or import.meta.env."
    echo "   Fix: read and validate every variable inside $ENV_CONFIG."
    CONFIG_ERRORS=$((CONFIG_ERRORS + 1))
  fi

  if ! grep -Eq 'export[[:space:]]+(const|let)[[:space:]]+' "$ENV_CONFIG"; then
    echo "❌ Env config module does not export the resolved values."
    echo "   Fix: export a typed object (for example: export const env: Env = ...)."
    CONFIG_ERRORS=$((CONFIG_ERRORS + 1))
  elif ! grep -Eq 'export[[:space:]]+(const|let)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*:[[:space:]]*[A-Za-z_$]|satisfies[[:space:]]+[A-Za-z_$]|[[:space:]]as[[:space:]]+[A-Z_$]' "$ENV_CONFIG"; then
    echo "❌ Env config module is not explicitly typed."
    echo "   Fix: annotate the export (export const env: Env = ...) or use satisfies Env."
    CONFIG_ERRORS=$((CONFIG_ERRORS + 1))
  fi
else
  if [ "$VIOLATIONS" -gt 0 ] || [ "$REQUIRE_CONFIG" = true ]; then
    echo ""
    echo "❌ Missing typed env config module: $ENV_CONFIG"
    echo "   Create it and import from it instead of reading env variables in application code."
    CONFIG_ERRORS=$((CONFIG_ERRORS + 1))
  else
    echo "ℹ️  No environment access detected; typed env config module is optional."
  fi
fi

if [ "$VIOLATIONS" -gt 0 ] || [ "$CONFIG_ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ [ENV CONFIG GATE FAILED]: Environment variable rules are violated."
  echo "   Only $ENV_CONFIG may read env variables, and it must export typed values."
  exit 1
fi

echo ""
echo "✅ [ENV CONFIG GATE PASSED]: Environment access is centralized in $ENV_CONFIG."
exit 0
