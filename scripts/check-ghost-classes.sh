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
#   --css-dir=<path>   Directory containing CSS stylesheets (repeatable or comma-separated;
#                      default: the whole project, so scoped runs keep a global token pool)
#   --dry-run          Run checks without failing
#   --help             Display usage information
# ==============================================================================

set -euo pipefail

SRC_DIR="src"
DRY_RUN=false
FORCE=false
STYLE_ENGINE="auto"
CSS_DIRS=()

for arg in "$@"; do
  case $arg in
    --src-dir=*)
      SRC_DIR="${arg#*=}"
      shift
      ;;
    --css-dir=*)
      IFS=',' read -r -a CSS_DIR_ENTRIES <<< "${arg#*=}"
      for css_dir in "${CSS_DIR_ENTRIES[@]}"; do
        if [ -n "$css_dir" ]; then
          CSS_DIRS+=("$css_dir")
        fi
      done
      shift
      ;;
    --style-engine=*)
      STYLE_ENGINE="${arg#*=}"
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
      echo "  --src-dir=<path>        Path to component source directory (default: src)"
      echo "  --css-dir=<path>        Stylesheet root(s), repeatable or comma-separated (default: whole project)"
      echo "  --style-engine=<engine> Override style engine (auto, tailwind, css-modules, unocss, panda, vanilla-extract, styled-components, emotion, css)"
      echo "  --dry-run               Report violations without exiting with non-zero code"
      echo "  --force                 Enforce static class check even if a dynamic style engine is detected"
      echo "  --help                  Show this help message"
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

if [ ${#CSS_DIRS[@]} -eq 0 ]; then
  CSS_DIRS=(".")
fi

node - "$SRC_DIR" "$DRY_RUN" "$FORCE" "$STYLE_ENGINE" "${CSS_DIRS[@]}" << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const [,, srcDirArg, dryRunArg, forceArg, styleEngineArg = 'auto'] = process.argv;
// Declaration pool roots: kept project-wide by default so a scoped --src-dir never
// turns globally declared classes into false-positive ghost classes.
const cssDirs = process.argv.slice(6).filter(Boolean);
if (cssDirs.length === 0) cssDirs.push('.');
const dryRun = dryRunArg === 'true';
const force = forceArg === 'true';
const engine = (styleEngineArg || 'auto').toLowerCase();

// 0. Auto-detect or validate Style Engine
if (!force) {
  const dynamicEngines = [
    'tailwind', 'tailwindcss',
    'css-modules', 'modules',
    'unocss',
    'panda', 'pandacss',
    'vanilla-extract',
    'styled-components',
    'emotion',
    'stylex',
    'css-in-js',
  ];

  function verifyTailwindWiring(srcDir) {
    const issues = [];

    // 1. Check Bundler / PostCSS configuration
    const viteConfigs = [
      'vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs',
      path.join(process.cwd(), 'vite.config.ts'), path.join(process.cwd(), 'vite.config.js'),
    ];
    const postcssConfigs = [
      'postcss.config.js', 'postcss.config.ts', 'postcss.config.cjs', 'postcss.config.mjs',
      '.postcssrc', '.postcssrc.json', '.postcssrc.js',
      path.join(process.cwd(), 'postcss.config.js'), path.join(process.cwd(), 'postcss.config.cjs'),
    ];

    let bundlerWired = false;
    for (const vc of viteConfigs) {
      if (fs.existsSync(vc)) {
        const content = fs.readFileSync(vc, 'utf8');
        if (/@tailwindcss\/vite|tailwindcss/i.test(content)) {
          bundlerWired = true;
          break;
        }
      }
    }
    if (!bundlerWired) {
      for (const pc of postcssConfigs) {
        if (fs.existsSync(pc)) {
          const content = fs.readFileSync(pc, 'utf8');
          if (/tailwindcss|@tailwindcss\/postcss/i.test(content)) {
            bundlerWired = true;
            break;
          }
        }
      }
    }

    // 2. Check CSS file with Tailwind directives
    let cssFileWithTailwind = null;
    function findTailwindCss(dir) {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
            const found = findTailwindCss(fullPath);
            if (found) return found;
          }
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (/@import\s+["']tailwindcss["']|@tailwind\b|@theme\b/.test(content)) {
            return fullPath;
          }
        }
      }
      return null;
    }
    cssFileWithTailwind = findTailwindCss(srcDir) || findTailwindCss('.');

    // 3. Check App entrypoint importing the CSS
    let appImportsCss = false;
    const entryCandidates = [
      path.join(srcDir, 'main.tsx'), path.join(srcDir, 'main.jsx'),
      path.join(srcDir, 'index.tsx'), path.join(srcDir, 'index.jsx'),
      path.join(srcDir, 'App.tsx'), path.join(srcDir, 'App.jsx'),
      'index.html', path.join(process.cwd(), 'index.html'),
    ];

    for (const entry of entryCandidates) {
      if (fs.existsSync(entry)) {
        const content = fs.readFileSync(entry, 'utf8');
        if (cssFileWithTailwind) {
          const cssBase = path.basename(cssFileWithTailwind);
          if (content.includes(cssBase) || /\.css['"]/.test(content) || /<link[^>]+rel=["']stylesheet["']/i.test(content)) {
            appImportsCss = true;
            break;
          }
        } else if (/\.css['"]/.test(content) || /<link[^>]+rel=["']stylesheet["']/i.test(content)) {
          appImportsCss = true;
          break;
        }
      }
    }

    if (!bundlerWired) {
      issues.push("Bundler missing Tailwind plugin: neither '@tailwindcss/vite' in vite.config.* nor 'tailwindcss' in postcss.config.* found.");
    }
    if (!cssFileWithTailwind) {
      issues.push("No project stylesheet declares Tailwind directives (e.g. '@import \"tailwindcss\";' for v4 or '@tailwind base;' for v3).");
    }
    if (!appImportsCss) {
      issues.push("Application entrypoint (e.g. src/main.tsx, src/App.tsx, or index.html) does not import any CSS stylesheet.");
    }

    return { isWired: issues.length === 0, issues };
  }

  if (engine === 'css' || engine === 'static') {
    // Explicitly requested static CSS verification
  } else if (engine !== 'auto') {
    if (engine === 'tailwind' || engine === 'tailwindcss') {
      const wiring = verifyTailwindWiring(srcDirArg);
      if (!wiring.isWired) {
        console.error(`❌ [STYLE WIRING VIOLATION]: Tailwind CSS explicitly configured, but the styling pipeline is disconnected:`);
        wiring.issues.forEach(issue => console.error(`   - ${issue}`));
        console.error('\nWithout complete bundler & stylesheet wiring, the browser will receive utility class names without any matching CSS rules!');
        if (!dryRun) {
          process.exit(1);
        }
      } else {
        console.log(`ℹ️  [GHOST CLASSES GATE]: Style engine 'tailwind' explicitly configured.`);
        console.log('✓ Verified: Bundler plugin, Tailwind CSS directives, and application entrypoint are fully wired.');
        console.log('ℹ️  Dynamic/scoped classes in use; skipping static CSS declaration checks.');
        console.log(`\n✅ [GHOST CLASSES GATE PASSED]: tailwind active and properly wired.`);
        process.exit(0);
      }
    } else if (dynamicEngines.includes(engine)) {
      console.log(`ℹ️  [GHOST CLASSES GATE]: Style engine '${engine}' explicitly configured.`);
      console.log('ℹ️  Dynamic/scoped classes in use; skipping static CSS declaration checks.');
      console.log(`\n✅ [GHOST CLASSES GATE PASSED]: ${engine} active.`);
      process.exit(0);
    }
  } else {
    let detectedEngine = '';
    let detectReason = '';

    // 0.A Tailwind CSS configs
    const twConfigs = [
      'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs',
      path.join(process.cwd(), 'tailwind.config.js'), path.join(process.cwd(), 'tailwind.config.ts'),
      path.join(process.cwd(), 'tailwind.config.cjs'), path.join(process.cwd(), 'tailwind.config.mjs'),
    ];
    for (const cfg of twConfigs) {
      if (fs.existsSync(cfg)) {
        detectedEngine = 'Tailwind CSS';
        detectReason = `config file '${path.basename(cfg)}' found`;
        break;
      }
    }

    // 0.B UnoCSS configs
    if (!detectedEngine) {
      const unoConfigs = ['uno.config.js', 'uno.config.ts', 'unocss.config.js', 'unocss.config.ts'];
      for (const cfg of unoConfigs) {
        if (fs.existsSync(cfg) || fs.existsSync(path.join(process.cwd(), cfg))) {
          detectedEngine = 'UnoCSS';
          detectReason = `config file '${cfg}' found`;
          break;
        }
      }
    }

    // 0.C Panda CSS configs
    if (!detectedEngine) {
      const pandaConfigs = ['panda.config.js', 'panda.config.ts', 'panda.config.mjs', 'panda.config.cjs'];
      for (const cfg of pandaConfigs) {
        if (fs.existsSync(cfg) || fs.existsSync(path.join(process.cwd(), cfg))) {
          detectedEngine = 'Panda CSS';
          detectReason = `config file '${cfg}' found`;
          break;
        }
      }
    }

    // 0.D Check package.json dependencies
    if (!detectedEngine && fs.existsSync('package.json')) {
      try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps['tailwindcss'] || deps['@tailwindcss/vite'] || deps['@tailwindcss/postcss']) {
          detectedEngine = 'Tailwind CSS';
          detectReason = 'Tailwind CSS dependency in package.json';
        } else if (deps['unocss'] || deps['@unocss/vite'] || deps['@unocss/postcss']) {
          detectedEngine = 'UnoCSS';
          detectReason = 'UnoCSS dependency in package.json';
        } else if (deps['@pandacss/dev']) {
          detectedEngine = 'Panda CSS';
          detectReason = 'Panda CSS dependency in package.json';
        } else if (deps['@vanilla-extract/css'] || deps['@vanilla-extract/vite-plugin']) {
          detectedEngine = 'Vanilla Extract';
          detectReason = 'Vanilla Extract dependency in package.json';
        } else if (deps['styled-components']) {
          detectedEngine = 'Styled Components';
          detectReason = 'styled-components dependency in package.json';
        } else if (deps['@emotion/react'] || deps['@emotion/styled']) {
          detectedEngine = 'Emotion';
          detectReason = 'Emotion dependency in package.json';
        } else if (deps['@stylexjs/stylex']) {
          detectedEngine = 'StyleX';
          detectReason = 'StyleX dependency in package.json';
        }
      } catch (e) {}
    }

    // 0.E Check CSS files for Tailwind directives
    if (!detectedEngine) {
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

      if (cssDirs.some((dir) => checkCssForTailwind(dir)) || checkCssForTailwind('.')) {
        detectedEngine = 'Tailwind CSS';
        detectReason = 'Tailwind CSS @import or directive found in stylesheet';
      }
    }

    // 0.F Check for CSS Modules (*.module.css / *.module.scss)
    if (!detectedEngine) {
      function checkCssModules(dir) {
        if (!fs.existsSync(dir)) return false;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
              if (checkCssModules(fullPath)) return true;
            }
          } else if (entry.isFile() && /\.module\.(css|scss|sass|less)$/.test(entry.name)) {
            return true;
          }
        }
        return false;
      }
      if (cssDirs.some((dir) => checkCssModules(dir))) {
        detectedEngine = 'CSS Modules';
        detectReason = 'CSS Modules (*.module.css) files detected';
      }
    }

    // 0.G Check for Vanilla Extract files (*.css.ts)
    if (!detectedEngine) {
      function checkVanillaExtract(dir) {
        if (!fs.existsSync(dir)) return false;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
              if (checkVanillaExtract(fullPath)) return true;
            }
          } else if (entry.isFile() && entry.name.endsWith('.css.ts')) {
            return true;
          }
        }
        return false;
      }
      if (cssDirs.some((dir) => checkVanillaExtract(dir))) {
        detectedEngine = 'Vanilla Extract';
        detectReason = 'Vanilla Extract (*.css.ts) files detected';
      }
    }

    if (detectedEngine === 'Tailwind CSS') {
      const wiring = verifyTailwindWiring(srcDirArg);
      if (!wiring.isWired) {
        console.error(`❌ [STYLE WIRING VIOLATION]: Tailwind CSS detected in project (${detectReason}), but the styling pipeline is disconnected:`);
        wiring.issues.forEach(issue => console.error(`   - ${issue}`));
        console.error('\nWithout complete bundler & stylesheet wiring, the browser receives utility class names without any matching CSS rules!');
        console.error('Please connect Tailwind in vite.config.ts / postcss.config.js, import it in CSS, and load the stylesheet in your application entrypoint.');
        if (!dryRun) {
          process.exit(1);
        }
      } else {
        console.log(`ℹ️  [GHOST CLASSES GATE]: Tailwind CSS detected in project (${detectReason}).`);
        console.log('✓ Verified: Bundler plugin, Tailwind CSS directives, and application entrypoint are fully wired.');
        console.log('ℹ️  Utility classes are generated dynamically by the active pipeline; skipping static CSS declaration checks.');
        console.log('\n✅ [GHOST CLASSES GATE PASSED]: Tailwind CSS active and properly wired.');
        process.exit(0);
      }
    } else if (detectedEngine) {
      console.log(`ℹ️  [GHOST CLASSES GATE]: ${detectedEngine} detected in project (${detectReason}).`);
      console.log('ℹ️  Dynamic/scoped classes in use; skipping static CSS declaration checks.');
      console.log(`\n✅ [GHOST CLASSES GATE PASSED]: ${detectedEngine} active.`);
      process.exit(0);
    }
  }
}

// 1. Collect all CSS classes defined across project CSS files
const definedClasses = new Set();

const CSS_SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.output', '.specify'];

function collectCssClasses(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!CSS_SKIP_DIRS.includes(entry.name)) {
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

// The declaration pool is project-wide (specs/**/designs and public included).
cssDirs.forEach((dir) => collectCssClasses(dir));

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
