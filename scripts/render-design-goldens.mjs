#!/usr/bin/env node
/**
 * render-design-goldens.mjs
 * -----------------------------------------------------------------------------
 * Turns the design master (HTML) into the golden screenshots Playwright compares
 * the implementation against.
 *
 * WHY THIS EXISTS
 * The design phase declares the HTML the master and explicitly forbids shipping
 * binary screenshots:
 *
 *   "TEXT-ONLY ASSETS RULE: never download binary screenshots, create fake .png
 *    files, or read .png files with file tools. The design master is the HTML
 *    code (<screen-id>.html)."
 *
 * That is the right call -- Stitch returns HTML, so the HTML is the only
 * faithful artifact. But the visual spec compares the app against
 * `designs/<screen-id>.png`, which therefore never existed, so every screen hit
 * `if (!fs.existsSync(goldenImagePath)) continue;` and the "visual fidelity"
 * test passed having asserted nothing.
 *
 * This script closes that gap without contradicting the rule: goldens are
 * DERIVED from the HTML on demand, in the same browser, with the same
 * deterministic render CSS and the same viewport the spec uses. They are build
 * artifacts, not sources of truth -- the HTML is committed, the PNGs are not.
 *
 * Matching the spec requires identical render conditions, so this module is the
 * reference implementation of "render it the way the audit does":
 *   - same viewport, from the screen's manifest entry
 *   - same DETERMINISTIC_RENDER_CSS (font smoothing, no animation, no caret)
 *   - same target (`screen.selector`, falling back to the full page)
 *   - same masks (`screen.maskSelectors`)
 *   - `scale: 'css'`, which is what the config's toHaveScreenshot uses
 *
 * Usage:
 *   node render-design-goldens.mjs --feature-dir=specs/001-x [--snapshot-dir=<dir>]
 *                                  [--tolerance=<ratio>] [--json=<path>] [--help]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Must stay byte-identical to `DETERMINISTIC_RENDER_CSS` in
 * `templates/design-audit.spec.ts.tmpl`. A divergence of a single property makes
 * the reference and the app render differently, which fails every screen for a
 * reason no agent can fix. `tests/render-design-goldens.test.ts` pins it.
 */
export const DETERMINISTIC_RENDER_CSS = `
  *, *::before, *::after {
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
    text-rendering: geometricPrecision !important;
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

/**
 * Default golden directory. It mirrors `snapshotPathTemplate` in
 * `playwright.design.config.ts.tmpl`
 * (`{testDir}/__snapshots__/{testFilePath}/{arg}{ext}`) with testDir
 * `./tests/design` and spec `design-audit.spec.ts`.
 *
 * A project that overrides `snapshotPathTemplate` must pass `--snapshot-dir`
 * (or set SPECIFY_DESIGN_SNAPSHOT_DIR). The gate detects the mismatch instead of
 * failing silently: Playwright reports "A snapshot doesn't exist" for every
 * screen, and `verify-stitch-design.sh` turns that into an actionable message.
 */
export const DEFAULT_SNAPSHOT_DIR = path.join(
  'tests',
  'design',
  '__snapshots__',
  'design-audit.spec.ts'
);

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

function parseArgs(argv) {
  const options = {
    featureDir: process.env.FEATURE_DIR || process.env.SPECIFY_FEATURE_DIR || '',
    snapshotDir: process.env.SPECIFY_DESIGN_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR,
    jsonPath: '',
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--feature-dir=')) options.featureDir = arg.slice('--feature-dir='.length);
    else if (arg.startsWith('--snapshot-dir=')) options.snapshotDir = arg.slice('--snapshot-dir='.length);
    else if (arg.startsWith('--json=')) options.jsonPath = arg.slice('--json='.length);
    else {
      console.error(`Unknown option: ${arg}`);
      return { ...options, error: true };
    }
  }
  return options;
}

function showHelp() {
  console.log(`Usage: render-design-goldens.mjs [options]

Render designs/<screen-id>.html into the golden screenshots the visual audit
compares the implementation against. The HTML is the committed master; these
PNGs are derived build artifacts and must not be committed.

Options:
  --feature-dir=<path>   Feature directory holding designs/ (default: $FEATURE_DIR)
  --snapshot-dir=<path>  Where to write the goldens. Must match the project's
                         snapshotPathTemplate (default: ${DEFAULT_SNAPSHOT_DIR})
  --json=<path>          Also write the per-screen report as JSON
  --help                 Show this message

Exit Codes:
  0   Every screen rendered, or skipped for a reported reason
  1   At least one screen failed to render
  2   Configuration error (no manifest, Playwright not installed)
`);
}

/** Resolve @playwright/test from the project first, then from this script. */
function loadPlaywright(projectRoot) {
  const candidates = [createRequire(path.join(projectRoot, 'package.json')), createRequire(import.meta.url)];
  for (const requireFor of candidates) {
    try {
      const mod = requireFor('@playwright/test');
      if (mod && mod.chromium) return mod.chromium;
    } catch {
      // Try the next resolution root.
    }
  }
  return null;
}

function readManifest(featureDir) {
  const manifestPath = path.join(featureDir, 'designs', 'routes-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { error: `No routes-manifest.json at ${manifestPath}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { error: `routes-manifest.json is not valid JSON: ${error.message}` };
  }
  if (!manifest || !Array.isArray(manifest.screens) || manifest.screens.length === 0) {
    return { error: 'routes-manifest.json has no screens array' };
  }
  return { manifest };
}

/**
 * Render one screen. Returns a result record rather than throwing, so a single
 * broken reference cannot abort the whole report.
 */
async function renderScreen(chromium, featureDir, snapshotDir, screen) {
  const id = String(screen.id);
  const htmlPath = path.join(featureDir, 'designs', `${id}.html`);
  const outPath = path.join(snapshotDir, `${id}.png`);

  if (!fs.existsSync(htmlPath)) {
    return {
      id,
      status: 'skipped',
      reason: `reference HTML not found: ${path.relative(process.cwd(), htmlPath)}`,
    };
  }

  const viewport = {
    width: Number(screen.viewport?.width) || DEFAULT_VIEWPORT.width,
    height: Number(screen.viewport?.height) || DEFAULT_VIEWPORT.height,
  };

  const browser = await chromium.launch();
  try {
    // deviceScaleFactor: 1 is mandatory for parity: the spec runs under
    // `scale: 'css'`, so a HiDPI context would produce a different pixel grid.
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();

    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
    // Web fonts change text metrics; comparing before they settle produces a
    // reference that can never be matched.
    await page.evaluate(() => document.fonts?.ready ?? null);
    await page.addStyleTag({ content: DETERMINISTIC_RENDER_CSS });

    const masks = Array.isArray(screen.maskSelectors)
      ? screen.maskSelectors.map((selector) => page.locator(selector))
      : [];

    let target = page;
    let usedSelector = null;
    if (typeof screen.selector === 'string' && screen.selector.trim() !== '') {
      const locator = page.locator(screen.selector).first();
      if ((await page.locator(screen.selector).count()) > 0) {
        target = locator;
        usedSelector = screen.selector;
      }
      // A testid the app owns will not exist in the Stitch export. Falling back
      // to the full page is still a comparable reference; failing here would
      // make the gate unusable for any testid-based selector.
    }

    fs.mkdirSync(snapshotDir, { recursive: true });
    await target.screenshot({
      path: outPath,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask: masks,
    });

    await context.close();
    return {
      id,
      status: 'rendered',
      path: path.relative(process.cwd(), outPath),
      viewport,
      selector: usedSelector ?? '<full page>',
      declaredSelector: typeof screen.selector === 'string' ? screen.selector : null,
      fallbackToFullPage:
        typeof screen.selector === 'string' && screen.selector.trim() !== '' && usedSelector === null,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return 0;
  }
  if (options.error) {
    showHelp();
    return 2;
  }
  if (!options.featureDir) {
    console.error('❌ [DESIGN GOLDENS] No feature directory.');
    console.error('   Pass --feature-dir=<path> or set FEATURE_DIR.');
    return 2;
  }

  const featureDir = path.resolve(options.featureDir);
  const { manifest, error } = readManifest(featureDir);
  if (error) {
    console.error(`❌ [DESIGN GOLDENS] ${error}`);
    return 2;
  }

  const chromium = loadPlaywright(process.cwd());
  if (!chromium) {
    console.error('❌ [DESIGN GOLDENS] @playwright/test is not installed in this project.');
    console.error('   Install it with: npm install -D @playwright/test && npx playwright install chromium');
    return 2;
  }

  const snapshotDir = path.resolve(options.snapshotDir);
  const results = [];
  for (const screen of manifest.screens) {
    try {
      results.push(await renderScreen(chromium, featureDir, snapshotDir, screen));
    } catch (error) {
      results.push({
        id: String(screen?.id ?? '<unknown>'),
        status: 'failed',
        reason: error.message.split('\n')[0],
      });
    }
  }

  const rendered = results.filter((r) => r.status === 'rendered').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log(`✓ [DESIGN GOLDENS] rendered ${rendered}, skipped ${skipped}, failed ${failed}`);
  for (const result of results) {
    if (result.status === 'rendered') {
      const note = result.fallbackToFullPage
        ? ` (declared selector "${result.declaredSelector}" not found; used full page)`
        : '';
      console.log(`   ✓ ${result.id} -> ${result.path}  ${result.viewport.width}x${result.viewport.height}${note}`);
    } else {
      console.log(`   ${result.status === 'failed' ? '✗' : '–'} ${result.id}: ${result.reason}`);
    }
  }

  if (options.jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(options.jsonPath)), { recursive: true });
    fs.writeFileSync(
      path.resolve(options.jsonPath),
      `${JSON.stringify({ generated_at: new Date().toISOString(), snapshot_dir: snapshotDir, results }, null, 2)}\n`,
      'utf8'
    );
  }

  return failed > 0 ? 1 : 0;
}

/**
 * True when this module is the process entry point.
 *
 * BOTH sides must be realpath'd. On macOS `/tmp` is a symlink to
 * `/private/tmp`, so a naive `pathToFileURL(argv[1]).href === import.meta.url`
 * comparison is false whenever the script is invoked through the symlinked
 * path -- and the module then exits 0 having done nothing. That is not
 * hypothetical: the gate sat there printing "Rendering golden references..."
 * and producing no goldens, with a clean exit code, so nothing looked wrong.
 */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Only run when executed directly, so tests can import the constants and helpers.
if (isEntryPoint()) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`❌ [DESIGN GOLDENS] ${error.message}`);
      process.exit(1);
    });
}
