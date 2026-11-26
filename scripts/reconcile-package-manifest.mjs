#!/usr/bin/env node
/**
 * reconcile-package-manifest — idempotent package.json reconciler.
 *
 * Reconciles an EXISTING manifest with what the bundle's quality gate needs:
 * the baseline scripts, and the toolchain packages those scripts actually
 * execute. It never overwrites a script the project already defines.
 *
 * Why this is a file and not a `node -e '...'` heredoc inside the shell scripts:
 * the embedded version was single-quoted bash, so a single apostrophe in a JS
 * comment broke the script at runtime, arguments were positional and invisible,
 * and none of the logic was unit-testable. It is the same rigour the gates ask
 * of application code.
 *
 * Rules encoded here (see README "Toolchain Pins"):
 *   - `vp dev` / `vp build` / `vp test` are built-ins that IGNORE package.json
 *     (https://viteplus.dev/guide/run), so a project whose bundler is a framework
 *     must get the framework command, and a Node service must get `vp pack`.
 *   - `devDependencies.vite` and `overrides.vite` must share the exact same spec
 *     or npm aborts with EOVERRIDE; a plain `vite` range installs a SECOND Vite.
 *   - `overrides.vitest` must be an exact pin, or a dependency pulls a different
 *     Vitest than the bundled runner and the internals split.
 *
 * Every version comes from `templates/package.json.tmpl`, which stays the single
 * source of truth. Nothing here hardcodes a toolchain version.
 *
 * Usage:
 *   node reconcile-package-manifest.mjs \
 *     --manifest <path> --template <path> \
 *     --profile <react|vanilla|api|fullstack|""> \
 *     --framework <vite|next|nuxt|astro|remix|sveltekit> \
 *     --design-script <true|false> --playwright-deps <true|false>
 *
 * Stdout: `unchanged`, `invalid`, or `updated` followed by one line per change.
 * Exit code is always 0: a malformed manifest must not abort a workflow, it is
 * reported so a human can look.
 */
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_BY_FRAMEWORK = {
  next: 'next dev',
  nuxt: 'nuxt dev',
  astro: 'astro dev',
  remix: 'remix vite:dev',
  sveltekit: 'vite dev',
  vite: 'vp dev',
};

const BUILD_BY_FRAMEWORK = {
  next: 'next build',
  nuxt: 'nuxt build',
  astro: 'astro build',
  remix: 'remix vite:build',
  sveltekit: 'vite build',
  vite: 'vp build',
};

// `vp pack` needs an explicit entry unless vite.config.ts declares a `pack`
// block; src/main.ts is the API profile's declared entrypoint (see AGENTS.api).
const API_DEV_ENTRY = 'tsx watch src/main.ts';
const API_BUILD = 'vp pack src/main.ts';

/** Reads the pins from the shipped template. Missing file/keys degrade to empty. */
export function readTemplate(templatePath) {
  if (!templatePath) return {};
  try {
    return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Pure reconciler. Mutates and returns a deep-ish copy of `pkg`.
 * @returns {{ changed: boolean, manifest: object, notes: string[] }}
 */
export function reconcile(pkg, options = {}) {
  const {
    profile = '',
    framework = 'vite',
    template = {},
    // Mirrors install.sh: only the api profile has no visual design gate. The
    // bootstrap passes this explicitly because it keys off has_ui instead.
    designScript = profile !== 'api',
    playwrightDeps = false,
  } = options;

  const tplDev = template.devDependencies || {};
  const tplOverrides = template.overrides || {};

  const vitePlusVersion = tplDev['vite-plus'] || '';
  const viteAlias = tplDev.vite || '';
  const vitestPin = tplOverrides.vitest || '';
  const pluginReactVersion = tplDev['@vitejs/plugin-react'] || '';
  const shadcnLintVersion = tplDev['@shadcn/lint'] || '';
  const typescriptVersion = tplDev.typescript || '';
  const tsxVersion = tplDev.tsx || '^4.23.15';
  const playwrightVersion = tplDev['@playwright/test'] || '^1.65.1';
  const axeVersion = tplDev['@axe-core/playwright'] || '^4.14.0';

  const next = structuredClone(pkg);
  next.scripts = next.scripts || {};
  next.devDependencies = next.devDependencies || {};

  const notes = [];
  let changed = false;

  const ensureDev = (name, version, reason) => {
    if (!version || next.devDependencies[name]) return;
    next.devDependencies[name] = version;
    notes.push(`+ ${name}@${version}${reason ? ` (${reason})` : ''}`);
    changed = true;
  };

  // ---------------------------------------------------------------------------
  // 1. Scripts. The framework runtime owns dev/build; vp built-ins cannot.
  // ---------------------------------------------------------------------------
  if (profile === 'api' && !next.scripts['dev:api']) {
    next.scripts['dev:api'] = API_DEV_ENTRY;
    notes.push(`+ script dev:api = ${API_DEV_ENTRY}`);
    changed = true;
  }

  if (!next.scripts.dev) {
    next.scripts.dev =
      profile === 'api' ? 'npm run dev:api' : DEV_BY_FRAMEWORK[framework] || 'vp dev';
    notes.push(`+ script dev = ${next.scripts.dev}`);
    changed = true;
  }

  if (!next.scripts.build) {
    next.scripts.build =
      profile === 'api' ? API_BUILD : BUILD_BY_FRAMEWORK[framework] || 'vp build';
    notes.push(`+ script build = ${next.scripts.build}`);
    changed = true;
  }

  if (!next.scripts.test) {
    next.scripts.test = 'vp test';
    notes.push(`+ script test = ${next.scripts.test}`);
    changed = true;
  }

  if (!next.scripts['check-quality']) {
    next.scripts['check-quality'] = 'bash .specify/scripts/bash/check-quality-gate.sh';
    notes.push('+ script check-quality');
    changed = true;
  }

  if (designScript && !next.scripts['verify-design']) {
    next.scripts['verify-design'] = 'bash .specify/scripts/bash/verify-stitch-design.sh';
    notes.push('+ script verify-design');
    changed = true;
  }

  // ---------------------------------------------------------------------------
  // 2. Dependencies the scripts above actually execute.
  // ---------------------------------------------------------------------------
  ensureDev('vite-plus', vitePlusVersion, 'vp CLI is the quality engine');
  ensureDev('typescript', typescriptVersion, 'vp check type-checks');

  if (profile === 'api') {
    ensureDev('tsx', tsxVersion, 'dev:api runtime');
  } else if (framework === 'vite' && (profile === 'react' || profile === '')) {
    // Only the React config imports these; the vanilla and agnostic ones do not.
    ensureDev('@vitejs/plugin-react', pluginReactVersion, 'vite.config.ts imports it');
    ensureDev('@shadcn/lint', shadcnLintVersion, 'vite.config.ts lint plugin');
  }

  // A project whose test script is plain `vitest run` owns that runner, so the
  // runner has to exist. Keep it on the exact version vp bundles.
  const testScript = String(next.scripts.test || '');
  if (vitestPin && /(^|[^a-z])vitest([^a-z]|$)/i.test(testScript)) {
    ensureDev('vitest', vitestPin, 'declared test script uses it');
  }

  if (playwrightDeps) {
    ensureDev('@playwright/test', playwrightVersion, 'visual audit gate');
    ensureDev('@axe-core/playwright', axeVersion, 'accessibility audit');
  }

  // ---------------------------------------------------------------------------
  // 3. Vite+ aliasing. A plain `vite` next to `vite-plus` installs a second Vite
  //    and vp refuses to boot.
  // ---------------------------------------------------------------------------
  if (viteAlias) {
    next.dependencies = next.dependencies || {};
    const declared = next.devDependencies.vite || next.dependencies.vite || '';

    if (!declared) {
      next.devDependencies.vite = viteAlias;
      notes.push(`+ vite -> ${viteAlias}`);
      changed = true;
    } else if (declared !== viteAlias) {
      // Vite is a build tool, not a runtime dependency: normalise the section as
      // well as the spec so npm's EOVERRIDE and peer rules both hold.
      if (next.dependencies.vite) delete next.dependencies.vite;
      next.devDependencies.vite = viteAlias;
      notes.push(`~ vite ${declared} -> ${viteAlias}`);
      changed = true;
    }
  }

  next.overrides = next.overrides || {};
  if (viteAlias && next.overrides.vite !== viteAlias) {
    next.overrides.vite = viteAlias;
    notes.push(`~ overrides.vite -> ${viteAlias}`);
    changed = true;
  }
  if (vitestPin && !next.overrides.vitest) {
    next.overrides.vitest = vitestPin;
    notes.push(`+ overrides.vitest = ${vitestPin}`);
    changed = true;
  }

  return { changed, manifest: next, notes };
}

function parseArgs(argv) {
  const args = { playwrightDeps: false, profile: '', framework: 'vite' };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;

    // Accept both `--flag=value` (what the shell scripts pass) and
    // `--flag value`, so a caller can never be silently ignored.
    const separator = raw.indexOf('=');
    const flag = separator === -1 ? raw : raw.slice(0, separator);
    const value = separator === -1 ? argv[i + 1] : raw.slice(separator + 1);
    if (separator === -1) i += 1;

    switch (flag) {
      case '--manifest':
        args.manifest = value;
        break;
      case '--template':
        args.templatePath = value;
        break;
      case '--profile':
        args.profile = value ?? '';
        break;
      case '--framework':
        args.framework = value || 'vite';
        break;
      case '--design-script':
        args.designScript = value !== 'false';
        break;
      case '--playwright-deps':
        args.playwrightDeps = value === 'true';
        break;
      default:
        break;
    }
  }

  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.manifest) {
    process.stdout.write('invalid\n');
    return 0;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  } catch {
    // A malformed manifest is reported, never silently ignored, and never fatal.
    process.stdout.write('invalid\n');
    return 0;
  }

  const result = reconcile(pkg, {
    profile: args.profile,
    framework: args.framework,
    template: readTemplate(args.templatePath),
    designScript: args.designScript,
    playwrightDeps: args.playwrightDeps,
  });

  if (!result.changed) {
    process.stdout.write('unchanged\n');
    return 0;
  }

  fs.writeFileSync(
    path.resolve(args.manifest),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(['updated', ...result.notes].join('\n') + '\n');
  return 0;
}

/**
 * Only run the CLI when executed directly, so tests can import `reconcile`.
 *
 * `path.resolve` is NOT enough: it does not follow symlinks, so invoking the
 * script through a symlinked directory (/tmp -> /private/tmp on macOS, or any
 * symlinked checkout) compared two different-looking paths, main() never ran,
 * and the shell saw empty output and skipped reconciliation SILENTLY. Compare
 * real paths on both sides.
 */
function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
