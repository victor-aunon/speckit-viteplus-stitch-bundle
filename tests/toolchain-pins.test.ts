import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guard against the failure mode this bundle already shipped once: `vite-plus`
 * and `@voidzero-dev/vite-plus-core` versioned independently, so a caret range on
 * both installs TWO Vite copies and `vp` refuses to boot
 * ("Expected @voidzero-dev/vite-plus-core@X, but found vite@Y").
 *
 * Rules enforced here (see https://viteplus.dev/guide/local-cli):
 *   - `devDependencies.vite` and `overrides.vite` must be the SAME spec, or npm
 *     aborts with EOVERRIDE.
 *   - The core alias must be an exact version: the core version encodes the
 *     bundled Vite version (major.minor = Vite major.minor, patch = Vite patch
 *     * 1000 + release), so a range silently allows a different Vite.
 *   - `overrides.vitest` must be an exact pin, otherwise dependencies and the
 *     bundled runner load different Vitest instances.
 *   - Delegating dependencies (`vite-plus`) must not float either, or the alias
 *     drifts away from the core the installed `vite-plus` actually uses.
 */

const root = path.resolve(__dirname, '..');
const CORE_ALIAS_PREFIX = 'npm:@voidzero-dev/vite-plus-core@';

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

function readManifest(relativePath: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as Manifest;
}

function isExact(spec: string | undefined): boolean {
  return typeof spec === 'string' && /^\d+\.\d+\.\d+/.test(spec) && !/[\^~*]/.test(spec);
}

const template = readManifest('templates/package.json.tmpl');

const exampleManifests = [
  'examples/1-api-service/package.json',
  'examples/2-react-vite/package.json',
  'examples/3-nextjs-app/package.json',
  'examples/4-vanilla-web/package.json',
];

describe('Vite+ toolchain pins', () => {
  it('aliases vite to an exact vite-plus-core version, and repeats it in overrides', () => {
    const alias = template.devDependencies?.vite;

    expect(alias).toBeDefined();
    expect(alias?.startsWith(CORE_ALIAS_PREFIX)).toBe(true);

    const coreVersion = String(alias).slice(CORE_ALIAS_PREFIX.length);
    expect(isExact(coreVersion)).toBe(true);

    // The legacy 1.x core line is what `^1.3.0` used to resolve to; it fails
    // every plugin peer check. Core majors track Vite majors >= 8 today.
    expect(Number(coreVersion.split('.')[0])).toBeGreaterThanOrEqual(8);

    // npm requires a direct dependency and its override to be identical.
    expect(template.overrides?.vite).toBe(alias);
  });

  it('pins vite-plus exactly, matching the core the alias was taken from', () => {
    const vitePlus = template.devDependencies?.['vite-plus'];

    expect(vitePlus).toBeDefined();
    expect(isExact(vitePlus)).toBe(true);
  });

  it('pins the bundled Vitest exactly so one instance is shared', () => {
    const vitestPin = template.overrides?.vitest;

    expect(vitestPin).toBeDefined();
    expect(isExact(vitestPin as string)).toBe(true);
  });

  it('keeps every reference example aligned with the template pins', () => {
    for (const manifestPath of exampleManifests) {
      const manifest = readManifest(manifestPath);

      expect(manifest.devDependencies?.vite, manifestPath).toBe(template.devDependencies?.vite);
      expect(manifest.overrides?.vite, manifestPath).toBe(template.overrides?.vite);
      expect(manifest.overrides?.vitest, manifestPath).toBe(template.overrides?.vitest);
      expect(manifest.devDependencies?.['vite-plus'], manifestPath).toBe(
        template.devDependencies?.['vite-plus']
      );
    }
  });

  it('never gives a non-Vite framework the vp dev/build built-ins', () => {
    const nextExample = readManifest('examples/3-nextjs-app/package.json');

    // `vp dev` always starts the built-in Vite dev server and `vp build` always
    // runs the built-in Vite build, ignoring the declared scripts. Next.js owns
    // both, so neither built-in may appear here.
    expect(nextExample.scripts?.dev).not.toMatch(/\bvp\s+(dev|build)\b/);
    expect(nextExample.scripts?.build).not.toMatch(/\bvp\s+(dev|build)\b/);
    expect(nextExample.scripts?.dev).toBe('next dev');
    expect(nextExample.scripts?.build).toBe('next build');
  });

  it('builds the API example with vp pack, never with the Vite app build', () => {
    const apiExample = readManifest('examples/1-api-service/package.json');

    expect(apiExample.scripts?.build).toMatch(/^vp pack\b/);
    expect(apiExample.scripts?.build).not.toMatch(/\bvp build\b/);
    expect(apiExample.devDependencies?.tsx).toBeDefined();
  });
});
