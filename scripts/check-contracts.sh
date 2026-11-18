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
  --check-atomic            Enforce Atomic Design (strictly max 1 component per file)
  --dry-run                 Simulate validation without failing

Exit Codes:
  0                         All route and component contracts are valid
  1                         Contract violations, missing fixtures, or orphan components detected
  2                         Missing tools or invalid manifest JSON
EOF
}

FEATURE_DIR=""
MANIFEST_FILE=""
CHECK_ORPHANS=false
CHECK_ATOMIC=false
DRY_RUN=false

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
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      ;;
  esac
done

# Autodetect feature directory if not provided
if [ -z "$FEATURE_DIR" ] && [ -z "$MANIFEST_FILE" ]; then
  if [ -d "specs" ]; then
    FEATURE_DIR=$(find specs -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1 || true)
  fi
fi

if [ -z "$MANIFEST_FILE" ] && [ -n "$FEATURE_DIR" ]; then
  MANIFEST_FILE="$FEATURE_DIR/designs/routes-manifest.json"
fi

echo "======================================================================"
echo "[CONTRACT GATE] Starting Route & Component Contract Integrity Check"
echo "======================================================================"

if [ -z "$MANIFEST_FILE" ] || [ ! -f "$MANIFEST_FILE" ]; then
  echo "ℹ️  No routes-manifest.json found (${MANIFEST_FILE:-none})."
  echo "ℹ️  Skipping contract verification (no UI routes declared)."
  exit 0
fi

echo "✓ Manifest detected: $MANIFEST_FILE"

# Execute contract validation using Node.js for robust AST & JSON parsing
node - "$MANIFEST_FILE" "$CHECK_ORPHANS" "$CHECK_ATOMIC" "$DRY_RUN" << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const [,, manifestPath, checkOrphansStr, checkAtomicStr, dryRunStr] = process.argv;
const checkOrphans = checkOrphansStr === 'true';
const checkAtomic = checkAtomicStr === 'true';
const dryRun = dryRunStr === 'true';

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

  collectTsx('src');

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

  collectTsxFiles('src');

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

# 4. Enforce Ghost Classes Gate (no undeclared CSS classes in JSX)
GHOST_SCRIPT="$SCRIPT_DIR/check-ghost-classes.sh"
if [ -f "$GHOST_SCRIPT" ]; then
  GHOST_ARGS=()
  if [ "$DRY_RUN" = true ]; then
    GHOST_ARGS+=("--dry-run")
  fi
  if ! bash "$GHOST_SCRIPT" "${GHOST_ARGS[@]}"; then
    exit 1
  fi
fi

exit 0
