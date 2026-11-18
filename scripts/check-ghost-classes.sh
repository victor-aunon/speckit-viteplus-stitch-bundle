#!/usr/bin/env bash
# ==============================================================================
# Ghost Classes Quality Gate: Check for Undeclared CSS Classes in JSX/TSX
#
# Scans UI components in src/ for class names referenced in `className`
# attributes and verifies that each referenced class is declared in at least
# one project CSS file or design token stylesheet.
#
# Flags:
#   --src-dir=<path>   Directory containing JSX/TSX components (default: src)
#   --css-dir=<path>   Directory containing CSS stylesheets (default: src and specs/**/designs)
#   --dry-run          Run checks without failing
#   --help             Display usage information
# ==============================================================================

set -euo pipefail

SRC_DIR="src"
DRY_RUN=false
FORCE=false

for arg in "$@"; do
  case $arg in
    --src-dir=*)
      SRC_DIR="${arg#*=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --help)
      echo "Usage: check-ghost-classes.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --src-dir=<path>   Path to component source directory (default: src)"
      echo "  --dry-run          Report violations without exiting with non-zero code"
      echo "  --force            Enforce static class check even if Tailwind CSS is detected"
      echo "  --help             Show this help message"
      exit 0
      ;;
    *)
      ;;
  esac
done

echo "======================================================================"
echo "[GHOST CLASSES GATE] Checking for Undeclared CSS Classes"
echo "======================================================================"

if [ ! -d "$SRC_DIR" ]; then
  echo "ℹ️  Source directory '$SRC_DIR' not found; skipping ghost classes check."
  exit 0
fi

node - "$SRC_DIR" "$DRY_RUN" "$FORCE" << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const [,, srcDirArg, dryRunArg, forceArg] = process.argv;
const dryRun = dryRunArg === 'true';
const force = forceArg === 'true';

// 0. Auto-detect Tailwind CSS
if (!force) {
  let hasTailwind = false;
  let tailwindReason = '';

  // Check config files
  const twConfigs = [
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
    path.join(process.cwd(), 'tailwind.config.js'),
    path.join(process.cwd(), 'tailwind.config.ts'),
    path.join(process.cwd(), 'tailwind.config.cjs'),
    path.join(process.cwd(), 'tailwind.config.mjs'),
  ];
  for (const cfg of twConfigs) {
    if (fs.existsSync(cfg)) {
      hasTailwind = true;
      tailwindReason = `config file '${path.basename(cfg)}' found`;
      break;
    }
  }

  // Check package.json
  if (!hasTailwind && fs.existsSync('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps['tailwindcss'] || deps['@tailwindcss/vite'] || deps['@tailwindcss/postcss']) {
        hasTailwind = true;
        tailwindReason = 'Tailwind CSS dependency in package.json';
      }
    } catch (e) {}
  }

  // Check CSS files for @import "tailwindcss" or @tailwind directives
  if (!hasTailwind) {
    function checkCssForTailwind(dir) {
      if (!fs.existsSync(dir)) return false;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
            if (checkCssForTailwind(fullPath)) return true;
          }
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (/@import\s+["']tailwindcss["']|@tailwind\b|@theme\b/.test(content)) {
            return true;
          }
        }
      }
      return false;
    }

    if (checkCssForTailwind(srcDirArg) || checkCssForTailwind('.')) {
      hasTailwind = true;
      tailwindReason = 'Tailwind CSS @import or directive found in stylesheet';
    }
  }

  if (hasTailwind) {
    console.log(`ℹ️  [GHOST CLASSES GATE]: Tailwind CSS detected in project (${tailwindReason}).`);
    console.log('ℹ️  Utility classes are generated dynamically; skipping static CSS declaration checks.');
    console.log('\n✅ [GHOST CLASSES GATE PASSED]: Tailwind CSS active.');
    process.exit(0);
  }
}

// 1. Collect all CSS classes defined across project CSS files
const definedClasses = new Set();

function collectCssClasses(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        collectCssClasses(fullPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      // Match class selectors: .class-name
      const classRegex = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
      let match;
      while ((match = classRegex.exec(content)) !== null) {
        definedClasses.add(match[1]);
      }
    }
  }
}

collectCssClasses(srcDirArg);
// Also search in specs/**/designs and public
collectCssClasses('specs');
collectCssClasses('public');

// Common dynamic/utility or pseudoclass tokens to allow
const allowedTokens = new Set([
  'active', 'is-done', 'checked', 'dimmed', 'pending',
  'focus', 'hover', 'disabled', 'empty', 'error', 'loading',
]);

// 2. Scan JSX/TSX files in srcDir for className occurrences
let violations = 0;

function scanJsxClasses(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        scanJsxClasses(fullPath);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) {
        continue;
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Extract string literals from className="..." or className={`...`}
      const classNameRegex = /className\s*=\s*(?:["']([^"']+)["']|\{`([^`]+)`\}|\{"([^"]+)"\}|\{'([^']+)'\})/g;
      let match;
      while ((match = classNameRegex.exec(content)) !== null) {
        const rawClassString = match[1] || match[2] || match[3] || match[4] || '';
        // Extract words, ignoring template literals expressions ${...}
        const cleanString = rawClassString.replace(/\$\{[^}]+\}/g, ' ');
        const tokens = cleanString.split(/\s+/).map(t => t.trim()).filter(Boolean);

        for (const token of tokens) {
          // Skip dynamic interpolation leftovers or utility keywords
          if (token.startsWith('$') || token.includes('{') || token.includes('}') || token.includes(':')) {
            continue;
          }
          if (!definedClasses.has(token) && !allowedTokens.has(token)) {
            console.log(`❌ [GHOST CLASS DETECTED]: Class '${token}' used in ${path.relative(process.cwd(), fullPath)} is not defined in any CSS file.`);
            violations++;
          }
        }
      }
    }
  }
}

scanJsxClasses(srcDirArg);

console.log(`✓ Total CSS classes declared in styles: ${definedClasses.size}`);

if (violations > 0) {
  console.log(`\n❌ [GHOST CLASSES GATE FAILED]: ${violations} undeclared class(es) found in JSX.`);
  if (!dryRun) {
    process.exit(1);
  }
} else {
  console.log('\n✅ [GHOST CLASSES GATE PASSED]: All JSX classes have matching CSS declarations.');
}
NODE_SCRIPT
