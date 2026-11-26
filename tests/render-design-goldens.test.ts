import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { removeDir } from './helpers/fs';

const scriptPath = path.resolve(__dirname, '../scripts/render-design-goldens.mjs');
const specTemplate = path.resolve(__dirname, '../templates/design-audit.spec.ts.tmpl');
const configTemplate = path.resolve(__dirname, '../templates/playwright.design.config.ts.tmpl');
const designGate = path.resolve(__dirname, '../scripts/verify-stitch-design.sh');

function runNode(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: 'utf8' });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Rendering needs a real browser. The bundle does not depend on
 * @playwright/test, so the render cases are skipped unless the environment
 * provides it -- the parsing, argument and parity cases run everywhere.
 */
function playwrightAvailable(): boolean {
  try {
    const require = createRequireLike();
    require.resolve('@playwright/test');
    return true;
  } catch {
    return false;
  }
}

function createRequireLike(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRequire } = require('node:module');
  return createRequire(path.join(process.cwd(), 'package.json'));
}

describe('render-design-goldens.mjs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-goldens-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  const writeManifest = (screens: unknown[]): void => {
    const designs = path.join(tempDir, 'designs');
    fs.mkdirSync(designs, { recursive: true });
    fs.writeFileSync(
      path.join(designs, 'routes-manifest.json'),
      JSON.stringify({ screens }),
      'utf8'
    );
  };

  it('documents its options', () => {
    const { status, stdout } = runNode(['--help'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('--feature-dir');
    expect(stdout).toContain('--snapshot-dir');
    expect(stdout).toContain('--json');
  });

  it('exits 2 without a feature directory', () => {
    const { status, stderr } = runNode([], tempDir);
    expect(status).toBe(2);
    expect(stderr).toContain('No feature directory');
  });

  it('rejects an unknown option', () => {
    const { status } = runNode(['--nope'], tempDir);
    expect(status).toBe(2);
  });

  it('exits 2 when routes-manifest.json is missing', () => {
    fs.mkdirSync(path.join(tempDir, 'designs'), { recursive: true });
    const { status, stderr } = runNode(['--feature-dir=.'], tempDir);
    expect(status).toBe(2);
    expect(stderr).toContain('No routes-manifest.json');
  });

  it('exits 2 when the manifest has no screens', () => {
    writeManifest([]);
    const { status, stderr } = runNode(['--feature-dir=.'], tempDir);
    expect(status).toBe(2);
    expect(stderr).toContain('no screens array');
  });

  it('rejects a manifest that is not valid JSON', () => {
    fs.mkdirSync(path.join(tempDir, 'designs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'designs', 'routes-manifest.json'), '{oops', 'utf8');
    const { status, stderr } = runNode(['--feature-dir=.'], tempDir);
    expect(status).toBe(2);
    expect(stderr).toContain('not valid JSON');
  });

  it('keeps the deterministic render CSS byte-identical to the audit spec', async () => {
    // The reference and the implementation are only comparable if both are
    // rendered under the same font-smoothing and animation rules. A divergence
    // of one property makes every screen differ for a reason no agent can fix.
    const mod = await import(scriptPath);
    const spec = fs.readFileSync(specTemplate, 'utf8');
    expect(spec).toContain(mod.DETERMINISTIC_RENDER_CSS.trim());
  });

  it('pins the golden directory Playwright derives from snapshotPathTemplate', async () => {
    const mod = await import(scriptPath);
    expect(mod.DEFAULT_SNAPSHOT_DIR).toBe(
      path.join('tests', 'design', '__snapshots__', 'design-audit.spec.ts')
    );
    const config = fs.readFileSync(configTemplate, 'utf8');
    expect(config).toContain("testDir: './tests/design'");
    expect(config).toContain('{testDir}/__snapshots__/{testFilePath}/{arg}{ext}');
    // The app must never become the baseline: a missing golden has to fail.
    expect(config).toContain("updateSnapshots: 'none'");
  });

  it('lets the tolerance be calibrated instead of hardcoded', () => {
    const config = fs.readFileSync(configTemplate, 'utf8');
    expect(config).toContain('SPECIFY_DESIGN_TOLERANCE');
  });

  it('no longer lets the audit spec silently skip a missing reference', () => {
    const spec = fs.readFileSync(specTemplate, 'utf8');
    // The old `continue` turned a never-rendered reference into a green pass.
    expect(spec).not.toMatch(/if \(!fs\.existsSync\(goldenImagePath\)\)/);
    expect(spec).toContain('toHaveScreenshot');
  });

  it('is shipped by the installer and wired into the visual gate', () => {
    const installer = fs.readFileSync(path.resolve(__dirname, '../scripts/install.sh'), 'utf8');
    expect(installer).toContain('render-design-goldens.mjs');
    const gate = fs.readFileSync(designGate, 'utf8');
    expect(gate).toContain('render-design-goldens.mjs');
    expect(gate).toContain('--calibrate');
  });

  it('calibration reports ratios without ever failing the gate', () => {
    const gate = fs.readFileSync(designGate, 'utf8');
    // Tolerance 0 is what forces every screen to report its true ratio.
    expect(gate).toContain('SPECIFY_DESIGN_TOLERANCE=0');
    // A failed run that produced no diff must never be reported as a match.
    expect(gate).toContain('failed WITHOUT producing a pixel diff');
  });

  it.skipIf(!playwrightAvailable())('renders a reference screen and skips a missing one', async () => {
    const chromium = await import(scriptPath);
    expect(typeof chromium.DETERMINISTIC_RENDER_CSS).toBe('string');

    fs.mkdirSync(path.join(tempDir, 'designs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'designs', 'dashboard.html'),
      '<!doctype html><html><body><main style="width:200px;height:100px">x</main></body></html>',
      'utf8'
    );
    writeManifest([
      { id: 'dashboard', route: '/', selector: 'main', viewport: { width: 400, height: 300 } },
      { id: 'ghost', route: '/ghost', selector: 'main', viewport: { width: 400, height: 300 } },
    ]);

    const { status, stdout } = runNode(['--feature-dir=.', '--json=report.json'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('rendered 1, skipped 1, failed 0');

    const golden = path.join(
      tempDir,
      'tests/design/__snapshots__/design-audit.spec.ts/dashboard.png'
    );
    expect(fs.existsSync(golden)).toBe(true);
    // Element screenshots are element-sized, exactly like locator.screenshot().
    const header = fs.readFileSync(golden).subarray(16, 24);
    expect(header.readUInt32BE(0)).toBe(200);
    expect(header.readUInt32BE(4)).toBe(100);

    const report = JSON.parse(fs.readFileSync(path.join(tempDir, 'report.json'), 'utf8'));
    expect(report.results.map((r: any) => r.status)).toEqual(['rendered', 'skipped']);
    expect(report.results[1].reason).toContain('reference HTML not found');
  }, 120000);

  it.skipIf(!playwrightAvailable())('falls back to the full page when the selector is app-only', async () => {
    // A data-testid the app owns will not exist in the Stitch export. Failing
    // there would make the gate unusable, so it degrades and reports it.
    fs.mkdirSync(path.join(tempDir, 'designs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'designs', 'screen.html'),
      '<!doctype html><html><body><main>y</main></body></html>',
      'utf8'
    );
    writeManifest([
      {
        id: 'screen',
        route: '/',
        selector: "[data-testid='app-only']",
        viewport: { width: 400, height: 300 },
      },
    ]);

    const { status, stdout } = runNode(['--feature-dir=.'], tempDir);
    expect(status).toBe(0);
    expect(stdout).toContain('declared selector');
    expect(stdout).toContain('used full page');
  }, 120000);
});
