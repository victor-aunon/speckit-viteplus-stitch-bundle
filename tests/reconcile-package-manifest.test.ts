import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { reconcile } from '../scripts/reconcile-package-manifest.mjs';
import { removeDir } from './helpers/fs';

const root = path.resolve(__dirname, '..');
const reconciler = path.join(root, 'scripts/reconcile-package-manifest.mjs');
const template = JSON.parse(
  fs.readFileSync(path.join(root, 'templates/package.json.tmpl'), 'utf8')
);

const emptyManifest = () => ({ name: 'fixture', scripts: {} });

interface ReconcileResult {
  changed: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifest: any;
  notes: string[];
}

function reconcileWith(
  manifest: Record<string, unknown>,
  options: Record<string, unknown> = {}
): ReconcileResult {
  return reconcile(JSON.parse(JSON.stringify(manifest)), { template, ...options }) as ReconcileResult;
}

describe('reconcile-package-manifest (pure)', () => {
  it('adds the baseline scripts plus the vp engine', () => {
    const { changed, manifest, notes } = reconcileWith(emptyManifest(), {
      profile: 'react',
      framework: 'vite',
    });

    expect(changed).toBe(true);
    expect(manifest.scripts.dev).toBe('vp dev');
    expect(manifest.scripts.build).toBe('vp build');
    expect(manifest.scripts.test).toBe('vp test');
    expect(manifest.scripts['check-quality']).toContain('check-quality-gate.sh');
    expect(manifest.scripts['verify-design']).toContain('verify-stitch-design.sh');
    expect(manifest.devDependencies['vite-plus']).toBe(template.devDependencies['vite-plus']);
    expect(notes.join('\n')).toContain('vite-plus');
  });

  it('gives an API profile a Node runtime and vp pack, never the Vite app build', () => {
    const { manifest } = reconcileWith(emptyManifest(), { profile: 'api', framework: 'vite' });

    expect(manifest.scripts['dev:api']).toBe('tsx watch src/main.ts');
    expect(manifest.scripts.dev).toBe('npm run dev:api');
    expect(manifest.scripts.build).toBe('vp pack src/main.ts');
    expect(manifest.devDependencies.tsx).toBeDefined();
    // The agnostic config imports neither plugin.
    expect(manifest.devDependencies['@vitejs/plugin-react']).toBeUndefined();
    expect(manifest.scripts['verify-design']).toBeUndefined();
  });

  it('gives every supported framework its own dev and build command', () => {
    const expected: Record<string, [string, string]> = {
      next: ['next dev', 'next build'],
      nuxt: ['nuxt dev', 'nuxt build'],
      astro: ['astro dev', 'astro build'],
      remix: ['remix vite:dev', 'remix vite:build'],
      sveltekit: ['vite dev', 'vite build'],
    };

    for (const [framework, [dev, build]] of Object.entries(expected)) {
      const { manifest } = reconcileWith(emptyManifest(), { profile: 'fullstack', framework });
      expect(manifest.scripts.dev, framework).toBe(dev);
      expect(manifest.scripts.build, framework).toBe(build);
      // Vitest through vp is framework-agnostic.
      expect(manifest.scripts.test, framework).toBe('vp test');
    }
  });

  it('never overwrites a script the project already declares', () => {
    const { manifest } = reconcileWith(
      { name: 'fixture', scripts: { dev: 'custom dev', build: 'custom build', test: 'vitest run' } },
      { profile: 'react', framework: 'vite' }
    );

    expect(manifest.scripts.dev).toBe('custom dev');
    expect(manifest.scripts.build).toBe('custom build');
    expect(manifest.scripts.test).toBe('vitest run');
    // ...but the declared runner must exist, pinned to the bundled version.
    expect(manifest.devDependencies.vitest).toBe(template.overrides.vitest);
  });

  it('rewrites a plain vite range into the core alias, in devDependencies', () => {
    const { manifest, notes } = reconcileWith(
      { name: 'fixture', scripts: {}, dependencies: { vite: '^6.2.0' } },
      { profile: 'react', framework: 'vite' }
    );

    // The section is dropped entirely rather than left as `"dependencies": {}`.
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies.vite).toBe(template.devDependencies.vite);
    expect(manifest.overrides.vite).toBe(template.overrides.vite);
    expect(manifest.overrides.vitest).toBe(template.overrides.vitest);
    expect(notes.join('\n')).toMatch(/~ vite \^6\.2\.0 -> npm:@voidzero-dev/);
  });

  it('only adds the React tooling to the react profile', () => {
    for (const profile of ['vanilla', 'api']) {
      const { manifest } = reconcileWith(emptyManifest(), { profile, framework: 'vite' });
      expect(manifest.devDependencies['@vitejs/plugin-react'], profile).toBeUndefined();
      expect(manifest.devDependencies['@shadcn/lint'], profile).toBeUndefined();
    }

    const { manifest } = reconcileWith(emptyManifest(), { profile: 'react', framework: 'vite' });
    expect(manifest.devDependencies['@vitejs/plugin-react']).toBe(
      template.devDependencies['@vitejs/plugin-react']
    );
  });

  it('seeds an api profile without any React surface', () => {
    const { manifest } = reconcileWith(template as unknown as Record<string, unknown>, {
      profile: 'api',
      framework: 'vite',
      designScript: false,
      seed: true,
    });

    // Scripts are retargeted: vp built-ins cannot serve a Node service.
    expect(manifest.scripts['dev:api']).toBe('tsx watch src/main.ts');
    expect(manifest.scripts.dev).toBe('npm run dev:api');
    expect(manifest.scripts.build).toBe('vp pack src/main.ts');
    // No visual gate on this profile, so neither the script nor its dependencies.
    expect(manifest.scripts['verify-design']).toBeUndefined();
    expect(manifest.devDependencies['@playwright/test']).toBeUndefined();
    expect(manifest.devDependencies['@axe-core/playwright']).toBeUndefined();
    // No React anywhere: the section disappears instead of becoming {}.
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies['@vitejs/plugin-react']).toBeUndefined();
    expect(manifest.devDependencies['@shadcn/lint']).toBeUndefined();
    expect(manifest.overrides['@vitejs/plugin-react']).toBeUndefined();
    expect(manifest.devDependencies.tsx).toBeDefined();
  });

  it('seeds a vanilla profile without React but keeps the visual gate', () => {
    const { manifest } = reconcileWith(template as unknown as Record<string, unknown>, {
      profile: 'vanilla',
      framework: 'vite',
      seed: true,
    });

    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies['@vitejs/plugin-react']).toBeUndefined();
    // A vanilla web project is a Vite app: the built-ins are correct here.
    expect(manifest.scripts.dev).toBe('vp dev');
    expect(manifest.scripts.build).toBe('vp build');
    // It does have a UI, so the visual gate and its tooling stay.
    expect(manifest.scripts['verify-design']).toBeDefined();
    expect(manifest.devDependencies['@playwright/test']).toBeDefined();
  });

  it('leaves a react seed untouched', () => {
    const { changed } = reconcileWith(template as unknown as Record<string, unknown>, {
      profile: 'react',
      framework: 'vite',
      seed: true,
    });

    expect(changed).toBe(false);
  });

  it('retargets a bundle default when the project turns out to be another framework', () => {
    // The React seed installed before the agent scaffolded Next.js: `dev: vp dev`
    // was written by the bundle, so it is not a human decision and must follow
    // the framework. `vp dev` would always start the Vite dev server.
    const { manifest, notes } = reconcileWith(
      { name: 'fixture', scripts: { dev: 'vp dev', build: 'vp build' }, dependencies: { next: '^16' } },
      { profile: '', framework: 'next' }
    );

    expect(manifest.scripts.dev).toBe('next dev');
    expect(manifest.scripts.build).toBe('next build');
    expect(notes.join('\n')).toContain('bundle default, technology changed');
  });

  it('never retargets a script a human wrote', () => {
    const { manifest, notes } = reconcileWith(
      { name: 'fixture', scripts: { dev: 'custom dev --port 4000', build: 'make build' } },
      { profile: '', framework: 'next' }
    );

    expect(manifest.scripts.dev).toBe('custom dev --port 4000');
    expect(manifest.scripts.build).toBe('make build');
    expect(notes.join('\n')).not.toMatch(/~ script (dev|build)/);
  });

  it('is idempotent', () => {
    const first = reconcileWith(emptyManifest(), { profile: 'react', framework: 'vite' });
    const second = reconcile(first.manifest, { template, profile: 'react', framework: 'vite' });

    expect(second.changed).toBe(false);
    expect(second.manifest).toEqual(first.manifest);
  });
});

describe('reconcile-package-manifest (CLI)', () => {
  it('writes the manifest and reports every change on stdout', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cli-'));
    const manifestPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ name: 'fixture', scripts: {} }), 'utf8');

    const output = execFileSync(
      process.execPath,
      [reconciler, `--manifest=${manifestPath}`, '--profile=react', '--framework=vite'],
      { encoding: 'utf8' }
    );

    expect(output.split('\n')[0]).toBe('updated');
    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(written.scripts.dev).toBe('vp dev');

    // Second run is a no-op: nothing to reconcile, nothing written.
    const again = execFileSync(process.execPath, [reconciler, `--manifest=${manifestPath}`], {
      encoding: 'utf8',
    });
    expect(again.trim()).toBe('unchanged');

    removeDir(tempDir);
  });

  it('still runs when invoked through a symlinked path', () => {
    // `path.resolve` does not follow symlinks, so a naive "am I the entrypoint?"
    // guard silently no-ops (/tmp -> /private/tmp on macOS, symlinked checkouts).
    // The shell then sees empty output and skips reconciliation without a word.
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-real-'));
    const linkDir = path.join(os.tmpdir(), `reconcile-link-${process.pid}-${Date.now()}`);
    fs.copyFileSync(reconciler, path.join(realDir, 'reconcile-package-manifest.mjs'));
    fs.symlinkSync(realDir, linkDir, 'dir');

    try {
      const manifestPath = path.join(realDir, 'package.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ name: 'fixture', scripts: {} }), 'utf8');

      const output = execFileSync(
        process.execPath,
        [
          path.join(linkDir, 'reconcile-package-manifest.mjs'),
          `--manifest=${manifestPath}`,
          '--profile=react',
        ],
        { encoding: 'utf8' }
      );

      expect(output.split('\n')[0]).toBe('updated');
    } finally {
      fs.unlinkSync(linkDir);
      removeDir(realDir);
    }
  });

  it('reports an unparseable manifest instead of exiting non-zero', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-invalid-'));
    const manifestPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(manifestPath, '{ not json', 'utf8');

    const output = execFileSync(process.execPath, [reconciler, `--manifest=${manifestPath}`], {
      encoding: 'utf8',
    });

    // A broken manifest must not abort a workflow, but it must be visible.
    expect(output.trim()).toBe('invalid');
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('{ not json');

    removeDir(tempDir);
  });
});
