#!/usr/bin/env bash
# ==============================================================================
# check-contracts.sh
# ------------------------------------------------------------------------------
# Route & Component Contract Integrity Gate for Spec Kit and Stitch.
#
# Validates:
#   1. routes-manifest.json structure, route definitions, selectors, and viewports.
#   2. Fixture file existence for mock network responses.
#   3. Route registration and component import contracts in src/.
#   4. Detection of orphan / unconsumed UI components generated during tasks.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

show_help() {
  cat << 'EOF'
Usage: check-contracts.sh [options]

Deterministic Contract Integrity Gate for Stitch routes and UI components.

Options:
  --help                    Show this help message
  --feature-dir=<path>      Path to feature directory (e.g. specs/001-feature)
  --manifest=<path>         Direct path to routes-manifest.json
  --check-orphans           Scan for unimported/orphan UI components in src/
                            (implied by --require-ui)
  --check-atomic            Enforce Atomic Design (strictly max 1 component per file)
  --require-ui              Fail if routes-manifest.json is missing (do not skip)
  --evidence-dir=<path>     Directory to write machine evidence JSON (default: <feature-dir>/evidence)
  --scope=<path>            Feature slice to audit (default: src). Propagated to
                            check-ghost-classes.sh and orphan/atomic scans
  --dry-run                 Simulate validation without failing

Exit Codes:
  0                         All route and component contracts are valid
  1                         Contract violations, missing fixtures, orphan components, or missing manifest when required
  2                         Missing tools or invalid manifest JSON
EOF
}

FEATURE_DIR=""
MANIFEST_FILE=""
CHECK_ORPHANS=false
CHECK_ATOMIC=false
REQUIRE_UI=false
EVIDENCE_DIR=""
DRY_RUN=false
SCOPE_DIR=""

for arg in "$@"; do
  case "$arg" in
    --help)
      show_help
      exit 0
      ;;
    --feature-dir=*)
      FEATURE_DIR="${arg#*=}"
      ;;
    --manifest=*)
      MANIFEST_FILE="${arg#*=}"
      ;;
    --check-orphans)
      CHECK_ORPHANS=true
      ;;
    --check-atomic)
      CHECK_ATOMIC=true
      ;;
    --require-ui)
      REQUIRE_UI=true
      ;;
    --evidence-dir=*)
      EVIDENCE_DIR="${arg#*=}"
      ;;
    --scope=*)
      SCOPE_DIR="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      ;;
  esac
done

# Resolve UI requirement from environment variable if not passed as CLI argument
if [ "$REQUIRE_UI" = false ] && [ -n "${SPECIFY_HAS_UI:-}" ]; then
  if [ "$SPECIFY_HAS_UI" = "true" ] || [ "$SPECIFY_HAS_UI" = "1" ]; then
    REQUIRE_UI=true
  fi
fi

# Resolve feature directory from environment variable if not passed as CLI argument
if [ -z "$FEATURE_DIR" ] && [ -n "${SPECIFY_FEATURE_DIR:-}" ]; then
  FEATURE_DIR="$SPECIFY_FEATURE_DIR"
fi

# Claiming UI (--require-ui) implies the UI is real: components must be consumed.
if [ "$REQUIRE_UI" = true ]; then
  CHECK_ORPHANS=true
fi

# Autodetect feature directory if not provided
if [ -z "$FEATURE_DIR" ] && [ -z "$MANIFEST_FILE" ]; then
  if [ -d "specs" ]; then
    FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
  fi
fi

if [ -z "$MANIFEST_FILE" ] && [ -n "$FEATURE_DIR" ]; then
  MANIFEST_FILE="$FEATURE_DIR/designs/routes-manifest.json"
fi

# Resolve evidence directory
if [ -z "$EVIDENCE_DIR" ] && [ -n "$FEATURE_DIR" ] && [ -d "$FEATURE_DIR" ]; then
  EVIDENCE_DIR="$FEATURE_DIR/evidence"
fi

START_TIME=$(date +%s 2>/dev/null || echo 0)

emit_gate_telemetry() {
  local status="$1"
  local code="$2"
  local end_time=$(date +%s 2>/dev/null || echo 0)
  local dur=$(( (end_time - START_TIME) * 1000 ))
  if [ -f "$SCRIPT_DIR/emit-telemetry.sh" ]; then
    bash "$SCRIPT_DIR/emit-telemetry.sh" \
      --gate="check-contracts" \
      --status="$status" \
      --duration-ms="$dur" \
      --exit-code="$code" \
      ${SCOPE_DIR:+--scope="$SCOPE_DIR"} \
      ${FEATURE_DIR:+--feature-dir="$FEATURE_DIR"} \
      ${EVIDENCE_DIR:+--evidence-file="$EVIDENCE_DIR/contracts.json"} 2>/dev/null || true
  fi
}

write_evidence() {
  local status="$1"
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if command -v node >/dev/null 2>&1; then
      node -e '
        const fs = require("fs");
        const [outPath, status, manifestPath, featDir, scopeDir] = process.argv.slice(1);
        let screenCount = 0;
        try {
          if (manifestPath && fs.existsSync(manifestPath)) {
            const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (Array.isArray(m.screens)) screenCount = m.screens.length;
          }
        } catch {}
        let previousStatus;
        try {
          const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
          if (previous && previous.status) previousStatus = previous.status;
        } catch {}
        const data = {
          timestamp: new Date().toISOString(),
          gate: "check-contracts",
          previous_status: previousStatus,
          status,
          reason: status === "skipped" ? "no_ui_declared" : undefined,
          manifest_file: manifestPath || undefined,
          screens_count: screenCount,
          feature_dir: featDir || undefined,
          scope: scopeDir || undefined,
          evidence_type: "routes_and_component_contracts"
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
      ' "$EVIDENCE_DIR/contracts.json" "$status" "$MANIFEST_FILE" "$FEATURE_DIR" "$SCOPE_DIR" 2>/dev/null || true
    fi
  fi
}

echo "======================================================================"
echo "[CONTRACT GATE] Starting Route & Component Contract Integrity Check"
echo "======================================================================"

if [ -z "$MANIFEST_FILE" ] || [ ! -f "$MANIFEST_FILE" ]; then
  if [ "$REQUIRE_UI" = true ]; then
    echo "❌ [CONTRACT GATE FAILED]: UI contracts are required (--require-ui or SPECIFY_HAS_UI=true),"
    echo "   but routes-manifest.json does not exist: '${MANIFEST_FILE:-none}'."
    echo "   Every feature with UI must declare a valid routes-manifest.json."
    emit_gate_telemetry "failed" 1
    write_evidence "failed"
    exit 1
  fi
  echo "ℹ️  No routes-manifest.json found (${MANIFEST_FILE:-none})."
  echo "ℹ️  Skipping contract verification (no UI routes declared)."
  write_evidence "skipped"
  emit_gate_telemetry "skipped" 0
  exit 0
fi

echo "✓ Manifest detected: $MANIFEST_FILE"

NODE_STATUS=0
node - "$MANIFEST_FILE" "$CHECK_ORPHANS" "$CHECK_ATOMIC" "$DRY_RUN" "$SCOPE_DIR" "$REQUIRE_UI" << 'NODE_SCRIPT' || NODE_STATUS=$?
const fs = require('fs');
const path = require('path');


const [,, manifestPath, checkOrphansStr, checkAtomicStr, dryRunStr, scopeDirArg, requireUiStr] = process.argv;
const checkOrphans = checkOrphansStr === 'true';
const checkAtomic = checkAtomicStr === 'true';
const dryRun = dryRunStr === 'true';
const requireUi = requireUiStr === 'true';
const scanScope = scopeDirArg && fs.existsSync(scopeDirArg) ? scopeDirArg : 'src';

let violations = 0;

function reportError(msg) {
  console.error(`❌ [CONTRACT VIOLATION]: ${msg}`);
  violations++;
}

// 1. Validate manifest JSON structure
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`❌ [CONTRACT GATE ERROR]: Invalid JSON in ${manifestPath}: ${err.message}`);
  process.exit(2);
}

if (!manifest || !Array.isArray(manifest.screens)) {
  reportError("routes-manifest.json must declare a top-level 'screens' array.");
} else if (manifest.screens.length === 0) {
  reportError("routes-manifest.json 'screens' array must not be empty.");
} else {
  const manifestDir = path.dirname(manifestPath);

  manifest.screens.forEach((screen, index) => {
    const screenLabel = screen.id || `screen[${index}]`;

    if (!screen.id || typeof screen.id !== 'string') {
      reportError(`Screen at index ${index} must have a non-empty string 'id'.`);
    }

    if (!screen.route || typeof screen.route !== 'string' || !screen.route.startsWith('/')) {
      reportError(`Screen '${screenLabel}' route must be a valid path starting with '/' (got: '${screen.route}').`);
    }

    if (!screen.selector || typeof screen.selector !== 'string') {
      reportError(`Screen '${screenLabel}' must declare a DOM 'selector' string.`);
    }

    if (screen.viewport) {
      if (typeof screen.viewport.width !== 'number' || screen.viewport.width <= 0 ||
          typeof screen.viewport.height !== 'number' || screen.viewport.height <= 0) {
        reportError(`Screen '${screenLabel}' viewport must contain positive numeric 'width' and 'height'.`);
      }
    }

    // Validate fixture paths if declared
    if (screen.fixtures && typeof screen.fixtures === 'object') {
      for (const [endpoint, fixtureRelPath] of Object.entries(screen.fixtures)) {
        const candidate1 = path.resolve(manifestDir, fixtureRelPath);
        const candidate2 = path.resolve(process.cwd(), fixtureRelPath);
        if (!fs.existsSync(candidate1) && !fs.existsSync(candidate2)) {
          reportError(`Screen '${screenLabel}' declares fixture for '${endpoint}' but file does not exist: '${fixtureRelPath}'.`);
        }
      }
    }
  });

  console.log(`✓ Validated ${manifest.screens.length} screen definition(s) in manifest.`);

  // 1b. When the feature claims UI, every declared selector must exist in the
  // rendered source. A manifest that only validates against itself is a ghost
  // contract: it can never fail, even if no component declares the selector.
  if (requireUi) {
    const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function collectSources(root) {
      const files = [];
      if (!fs.existsSync(root)) return files;
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!['node_modules', 'dist', 'build', '.git', '__tests__', 'tests', 'designs'].includes(entry.name)) walk(full);
          } else if (entry.isFile() && /\.(tsx?|jsx?|html)$/.test(entry.name)) {
            files.push(fs.readFileSync(full, 'utf8'));
          }
        }
      };
      walk(root);
      return files;
    }

    const sourceText = collectSources(scanScope).join('\n');

    if (sourceText.trim().length === 0) {
      reportError(`UI contracts are required, but no renderable source files were found in '${scanScope}'. A manifest without components proves nothing.`);
    } else {
      const selectorExists = (selector) => {
        const testId = /\[data-testid\s*=\s*["']?([^"'\]]+?)["']?\s*\]/.exec(selector);
        if (testId) {
          return new RegExp(`data-testid\\s*=\\s*["'\`]${escapeRe(testId[1])}["'\`]`).test(sourceText);
        }
        const id = /^#([A-Za-z0-9_-]+)$/.exec(selector.trim());
        if (id) {
          return new RegExp(`id\\s*=\\s*["'\`]${escapeRe(id[1])}["'\`]`).test(sourceText);
        }
        const cls = /^\.([A-Za-z0-9_-]+)$/.exec(selector.trim());
        if (cls) {
          return new RegExp(`(?:class(Name)?\\s*=\\s*["'\`][^"'\`]*\\b${escapeRe(cls[1])}\\b)`).test(sourceText);
        }
        const tag = /^([a-zA-Z][A-Za-z0-9]*)$/.exec(selector.trim());
        if (tag) {
          return new RegExp(`<${escapeRe(tag[1])}[\\s>/]`, 'i').test(sourceText);
        }
        return true; // compound selectors are verified by Playwright, not by grep
      };

      manifest.screens.forEach((screen) => {
        if (!screen.selector || typeof screen.selector !== 'string') return;
        if (!selectorExists(screen.selector)) {
          reportError(`Ghost selector: screen '${screen.id || '?'}' declares '${screen.selector}', but it does not exist in '${scanScope}'.`);
        }
      });

      if (violations === 0) {
        console.log(`✓ All declared selectors exist in '${scanScope}'.`);
      }
    }
  }
}

// 2. Scan for orphan UI components in src/ if requested
if (checkOrphans && fs.existsSync('src')) {
  console.log("Scanning src/ for orphan UI components...");
  const componentFiles = [];

  function collectTsx(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '.git', '__tests__', 'tests'].includes(entry.name)) {
          collectTsx(fullPath);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
        const base = path.basename(entry.name, path.extname(entry.name));
        // Skip entry points and tests
        if (!['main', 'index', 'App', 'routes', 'router'].includes(base) &&
            !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
          componentFiles.push({ fullPath, baseName: base, relativePath: path.relative(process.cwd(), fullPath) });
        }
      }
    }
  }

  collectTsx(scanScope);

  // Read all src files to detect imports
  const allSrcContent = [];
  function collectContent(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '.git'].includes(entry.name)) {
          collectContent(fullPath);
        }
      } else if (entry.isFile() && /\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
        allSrcContent.push({ path: fullPath, content: fs.readFileSync(fullPath, 'utf8') });
      }
    }
  }
  collectContent('src');

  componentFiles.forEach(comp => {
    let imported = false;
    for (const file of allSrcContent) {
      if (file.path === comp.fullPath) continue;
      // Check if imported by name or path
      if (file.content.includes(comp.baseName)) {
        imported = true;
        break;
      }
    }

    if (!imported) {
      reportError(`Orphan UI component detected: '${comp.relativePath}' is never imported or consumed in the application.`);
    }
  });
}

// 3. Scan for Atomic Design violations (max 1 component per file)
if (checkAtomic && fs.existsSync('src')) {
  console.log("Scanning src/ for Atomic Design (multi-component per file) violations...");
  const allComponentFiles = [];

  function collectTsxFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '.git', '__tests__', 'tests'].includes(entry.name)) {
          collectTsxFiles(fullPath);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
        if (!entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
          allComponentFiles.push({ fullPath, relativePath: path.relative(process.cwd(), fullPath) });
        }
      }
    }
  }

  collectTsxFiles(scanScope);

  // Matches top-level function ComponentName or const ComponentName = ...
  const COMPONENT_DECLARATION_REGEX = /(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\(|(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*(?::\s*[^=]+)?\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>)/g;

  allComponentFiles.forEach(fileObj => {
    const content = fs.readFileSync(fileObj.fullPath, 'utf8');
    // Only check files that declare JSX elements
    if (!/<[a-zA-Z0-9_\.]+/g.test(content)) {
      return;
    }

    const declaredComponents = [];
    let match;
    while ((match = COMPONENT_DECLARATION_REGEX.exec(content)) !== null) {
      const name = match[1] || match[2];
      if (name && !declaredComponents.includes(name)) {
        declaredComponents.push(name);
      }
    }

    if (declaredComponents.length > 1) {
      reportError(`Atomic Design Violation in '${fileObj.relativePath}': Declares ${declaredComponents.length} components (${declaredComponents.join(', ')}). Enforce Atomic Design: exactly 1 component per file.`);
    }
  });
}

if (violations > 0 && !dryRun) {
  console.error(`\n❌ [CONTRACT GATE FAILED]: ${violations} contract violation(s) detected.`);
  console.error("Please align routes-manifest.json and component contracts before visual testing.");
  process.exit(1);
} else if (violations > 0 && dryRun) {
  console.log(`\n⚠️ [CONTRACT GATE DRY-RUN]: ${violations} violation(s) detected (dry-run mode).`);
  process.exit(0);
}

console.log("\n✅ [CONTRACT GATE PASSED]: Route and component contracts are strictly satisfied.");
NODE_SCRIPT

if [ $NODE_STATUS -ne 0 ]; then
  emit_gate_telemetry "failed" "$NODE_STATUS"
  write_evidence "failed"
  exit $NODE_STATUS
fi

# 4. Enforce Ghost Classes Gate (no undeclared CSS classes in JSX)
GHOST_SCRIPT="$SCRIPT_DIR/check-ghost-classes.sh"
if [ -f "$GHOST_SCRIPT" ]; then
  GHOST_ARGS=()
  if [ "$DRY_RUN" = true ]; then
    GHOST_ARGS+=("--dry-run")
  fi
  # Brownfield safety: inherit the feature scope so legacy screens outside the
  # slice cannot fail the gate.
  if [ -n "$SCOPE_DIR" ]; then
    GHOST_ARGS+=("--src-dir=$SCOPE_DIR")
    echo "ℹ️  Scoped ghost-classes check active: scanning '$SCOPE_DIR' only"
  fi
  if ! bash "$GHOST_SCRIPT" "${GHOST_ARGS[@]}"; then
    emit_gate_telemetry "failed" 1
    write_evidence "failed"
    exit 1
  fi
fi

write_evidence "passed"
emit_gate_telemetry "passed" 0
exit 0
