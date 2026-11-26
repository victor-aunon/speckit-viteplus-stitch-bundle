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

    expect(manifest.dependencies.vite).toBeUndefined();
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
