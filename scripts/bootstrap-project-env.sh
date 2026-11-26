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
RESOLVED_PROFILE=""

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

# ------------------------------------------------------------------------------
# 3. Baseline package.json scripts (quality gate contracts)
# ------------------------------------------------------------------------------
if [ ! -f "$ROOT/package.json" ]; then
  if PKG_TMPL="$(resolve_template "package.json" 2>/dev/null)"; then
    cp "$PKG_TMPL" "$ROOT/package.json"
    echo "✓ Materialized starter package.json from $(basename "$PKG_TMPL")"
    ACTIONS=$((ACTIONS + 1))
  fi
fi

# The shipped template is the single source of truth for the Vite+ pins.
TOOLCHAIN_TMPL=""
for candidate in "$ROOT/.specify/templates/package.json.tmpl" "$ROOT/.specify/templates/package.json"; do
  if [ -f "$candidate" ]; then
    TOOLCHAIN_TMPL="$candidate"
    break
  fi
done

# Same framework resolution as install.sh: the framework config file is the fact,
# a declared framework dependency is the fallback.
BOOTSTRAP_FRAMEWORK="vite"
for candidate in "next:next.config" "nuxt:nuxt.config" "astro:astro.config" "remix:remix.config" "sveltekit:svelte.config"; do
  CANDIDATE_NAME="${candidate%%:*}"
  CANDIDATE_GLOB="${candidate##*:}"
  if compgen -G "$ROOT/$CANDIDATE_GLOB.*" >/dev/null 2>&1; then
    BOOTSTRAP_FRAMEWORK="$CANDIDATE_NAME"
    break
  fi
done
if [ "$BOOTSTRAP_FRAMEWORK" = "vite" ] && [ -f "$ROOT/package.json" ]; then
  for candidate_dep in '"next"' '"nuxt"' '"astro"' '"@remix-run/dev"' '"@sveltejs/kit"'; do
    if grep -q "$candidate_dep[[:space:]]*:" "$ROOT/package.json" 2>/dev/null; then
      case "$candidate_dep" in
        '"next"') BOOTSTRAP_FRAMEWORK="next" ;;
        '"nuxt"') BOOTSTRAP_FRAMEWORK="nuxt" ;;
        '"astro"') BOOTSTRAP_FRAMEWORK="astro" ;;
        '"@remix-run/dev"') BOOTSTRAP_FRAMEWORK="remix" ;;
        '"@sveltejs/kit"') BOOTSTRAP_FRAMEWORK="sveltekit" ;;
      esac
      break
    fi
  done
fi

if [ -f "$ROOT/package.json" ] && command -v node >/dev/null 2>&1; then
  NODE_PKG_SCRIPT='
    const fs = require("fs");
    const file = process.argv[1];
    const hasUi = process.argv[2] !== "false";
    const profile = process.argv[3] || "";
    const framework = process.argv[4] || "vite";
    const templateFile = process.argv[5] || "";
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      pkg.scripts = pkg.scripts || {};
      pkg.devDependencies = pkg.devDependencies || {};
      const notes = [];
      let changed = false;

      let tpl = {};
      try { tpl = JSON.parse(fs.readFileSync(templateFile, "utf8")); } catch (e) { tpl = {}; }
      const tplDev = tpl.devDependencies || {};
      const tplOverrides = tpl.overrides || {};
      const vitePlusVersion = tplDev["vite-plus"] || "";
      const viteAlias = tplDev.vite || "";
      const vitestPin = tplOverrides.vitest || "";
      const pluginReactVersion = tplDev["@vitejs/plugin-react"] || "";
      const shadcnLintVersion = tplDev["@shadcn/lint"] || "";
      const typescriptVersion = tplDev.typescript || "";
      const tsxVersion = tplDev.tsx || "^4.23.15";

      const devByFramework = {
        next: "next dev", nuxt: "nuxt dev", astro: "astro dev",
        remix: "remix vite:dev", sveltekit: "vite dev", vite: "vp dev",
      };
      const buildByFramework = {
        next: "next build", nuxt: "nuxt build", astro: "astro build",
        remix: "remix vite:build", sveltekit: "vite build", vite: "vp build",
      };

      if (profile === "api" && !pkg.scripts["dev:api"]) {
        pkg.scripts["dev:api"] = "tsx watch src/main.ts";
        changed = true;
      }

      if (!pkg.scripts.dev) {
        pkg.scripts.dev = profile === "api"
          ? "npm run dev:api"
          : (devByFramework[framework] || "vp dev");
        changed = true;
      }

      if (!pkg.scripts.build) {
        // vp build is the built-in Vite production build; it is the wrong command
        // for a Node service (vp pack / tsdown is its documented build) and for any
        // framework whose bundler is its own.
        pkg.scripts.build = profile === "api"
          ? "vp pack src/main.ts"
          : (buildByFramework[framework] || "vp build");
        changed = true;
      }

      if (!pkg.scripts.test) {
        pkg.scripts.test = "vp test";
        changed = true;
      }

      if (!pkg.scripts["check-quality"]) {
        pkg.scripts["check-quality"] = "bash .specify/scripts/bash/check-quality-gate.sh";
        changed = true;
      }

      if (hasUi && !pkg.scripts["verify-design"]) {
        pkg.scripts["verify-design"] = "bash .specify/scripts/bash/verify-stitch-design.sh";
        changed = true;
      }

      const ensureDev = (name, version, reason) => {
        if (!version || pkg.devDependencies[name]) return;
        pkg.devDependencies[name] = version;
        notes.push("+ " + name + "@" + version + (reason ? " (" + reason + ")" : ""));
        changed = true;
      };

      ensureDev("vite-plus", vitePlusVersion, "vp CLI is the quality engine");
      ensureDev("typescript", typescriptVersion, "vp check type-checks");

      if (profile === "api") {
        ensureDev("tsx", tsxVersion, "dev:api runtime");
      } else if (framework === "vite") {
        ensureDev("@vitejs/plugin-react", pluginReactVersion, "vite.config.ts imports it");
        ensureDev("@shadcn/lint", shadcnLintVersion, "vite.config.ts lint plugin");
      }

      const testScript = String(pkg.scripts.test || "");
      if (vitestPin && /(^|[^a-z])vitest([^a-z]|$)/i.test(testScript)) {
        ensureDev("vitest", vitestPin, "declared test script uses it");
      }

      if (hasUi) {
        ensureDev("@playwright/test", "^1.65.1");
        ensureDev("@axe-core/playwright", "^4.14.0");
      }

      if (viteAlias) {
        pkg.dependencies = pkg.dependencies || {};
        const declared = pkg.devDependencies.vite || pkg.dependencies.vite || "";
        if (!declared) {
          pkg.devDependencies.vite = viteAlias;
          notes.push("+ vite -> " + viteAlias);
          changed = true;
        } else if (declared !== viteAlias) {
          // Vite is a build tool, not a runtime dependency: normalise the section
          // as well as the spec so both npm rules (EOVERRIDE + peer resolution)
          // hold. A plain "vite" range here installs a SECOND Vite.
          if (pkg.dependencies.vite) delete pkg.dependencies.vite;
          pkg.devDependencies.vite = viteAlias;
          notes.push("~ vite " + declared + " -> " + viteAlias);
          changed = true;
        }
      }

      pkg.overrides = pkg.overrides || {};
      if (viteAlias && pkg.overrides.vite !== viteAlias) {
        pkg.overrides.vite = viteAlias;
        changed = true;
      }
      if (vitestPin && !pkg.overrides.vitest) {
        pkg.overrides.vitest = vitestPin;
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        process.stdout.write("updated" + (notes.length ? "\n" + notes.join("\n") : ""));
      }
    } catch (e) {
      // invalid JSON, ignore
    }
  '
  PKG_OUT="$(node -e "$NODE_PKG_SCRIPT" "$ROOT/package.json" "$HAS_UI" "$RESOLVED_PROFILE" "$BOOTSTRAP_FRAMEWORK" "$TOOLCHAIN_TMPL" 2>/dev/null || true)"
  if [ "$(printf '%s' "$PKG_OUT" | head -n 1)" = "updated" ]; then
    echo "✓ Ensured baseline scripts and toolchain dependencies in package.json"
    printf '%s\n' "$PKG_OUT" | tail -n +2 | sed '/^$/d; s/^/  /'
    ACTIONS=$((ACTIONS + 1))
  fi
fi

# ------------------------------------------------------------------------------
# 4. Commit untracked tooling baseline if repo already has HEAD
# ------------------------------------------------------------------------------
if [ "$DO_GIT" = true ] && command -v git >/dev/null 2>&1 && [ -e "$ROOT/.git" ]; then
  if git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
    # When .specify/ was freshly installed or templates were materialized in an existing git repo,
    # uncommitted tooling files trigger false-positive scope violations in check-blast-radius.sh.
    if [ -d "$ROOT/.specify" ] && git -C "$ROOT" status --porcelain -- .specify 2>/dev/null | grep -q .; then
      git -C "$ROOT" add .specify 2>/dev/null || true
      for extra_tooling in ".gitignore" "AGENTS.md" "playwright.design.config.ts" "tests/design"; do
        if [ -e "$ROOT/$extra_tooling" ]; then
          git -C "$ROOT" add "$extra_tooling" 2>/dev/null || true
        fi
      done
      if git -C "$ROOT" \
        -c user.name="spec-kit bootstrap" \
        -c user.email="spec-kit@localhost" \
        commit -q -m "chore: baseline specify tooling snapshot" 2>/dev/null; then
        echo "✓ Committed baseline specify tooling (diff-based gates now see a clean tooling baseline)"
        ACTIONS=$((ACTIONS + 1))
      fi
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
