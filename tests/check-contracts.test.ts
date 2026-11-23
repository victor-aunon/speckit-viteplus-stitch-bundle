import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-contracts.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-contracts.sh');
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-test-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  it('script should exist and be executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    const executable = process.platform === 'win32' || (stats.mode & 0o111) > 0;
    expect(executable).toBe(true);
  });

  it('should display help with --help flag', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-contracts.sh');
    expect(output).toContain('--manifest=<path>');
    expect(output).toContain('--check-orphans');
    expect(output).toContain('--dry-run');
  });

  it('should skip gracefully when no routes-manifest.json exists', () => {
    const output = runBash(scriptPath, [`--feature-dir=${tempDir}`]);
    expect(output).toContain('Skipping contract verification (no UI routes declared)');
  });

  it('should fail when manifest contains invalid JSON', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    fs.writeFileSync(manifestPath, '{ broken-json: true', 'utf8');

    try {
      runBash(scriptPath, [`--manifest=${manifestPath}`], { stdio: 'pipe' });
      expect.fail('Should fail on broken JSON');
    } catch (error: any) {
      expect(error.status).toBe(2);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('Invalid JSON');
    }
  });

  it('should validate screen properties and report missing fixtures', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    const manifestContent = {
      screens: [
        {
          id: 'valid-screen',
          route: '/dashboard',
          selector: '#root',
          viewport: { width: 1280, height: 800 },
          fixtures: {
            '/api/data': './fixtures/missing-data.json'
          }
        }
      ]
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2), 'utf8');

    try {
      runBash(scriptPath, [`--manifest=${manifestPath}`], { stdio: 'pipe' });
      expect.fail('Should fail due to missing fixture file');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('declares fixture for');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('missing-data.json');
    }
  });

  it('should pass cleanly when screens and declared fixtures exist', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    const fixturesDir = path.join(tempDir, 'fixtures');
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(path.join(fixturesDir, 'data.json'), '{"ok": true}', 'utf8');

    const manifestContent = {
      screens: [
        {
          id: 'valid-screen',
          route: '/dashboard',
          selector: '#root',
          viewport: { width: 1280, height: 800 },
          fixtures: {
            '/api/data': './fixtures/data.json'
          }
        }
      ]
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2), 'utf8');

    const output = runBash(scriptPath, [`--manifest=${manifestPath}`]);
    expect(output).toContain('Validated 1 screen definition(s)');
    expect(output).toContain('CONTRACT GATE PASSED');
  });

  it('should detect orphan components in src/ when --check-orphans is enabled', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      screens: [{ id: 's1', route: '/home', selector: 'main' }]
    }), 'utf8');

    const srcDir = path.join(tempDir, 'src/components');
    fs.mkdirSync(srcDir, { recursive: true });
    // An orphan component that is never imported
    fs.writeFileSync(path.join(srcDir, 'OrphanCard.tsx'), 'export const OrphanCard = () => <div>Lost</div>;', 'utf8');
    // An active component
    fs.writeFileSync(path.join(srcDir, 'UsedButton.tsx'), 'export const UsedButton = () => <button>Click</button>;', 'utf8');
    // App that only imports UsedButton
    fs.writeFileSync(path.join(tempDir, 'src/App.tsx'), 'import { UsedButton } from "./components/UsedButton";', 'utf8');

    try {
      runBash(scriptPath, [`--manifest=${manifestPath}`, '--check-orphans'], { cwd: tempDir, stdio: 'pipe' });
      expect.fail('Should fail due to orphan component');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('Orphan UI component detected');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('OrphanCard');
    }
  });

  it('should detect Atomic Design violations when a file declares multiple components', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      screens: [{ id: 's1', route: '/home', selector: 'main' }]
    }), 'utf8');

    const srcDir = path.join(tempDir, 'src/components');
    fs.mkdirSync(srcDir, { recursive: true });

    // Multi-component anti-pattern file
    const multiCompContent = `
      import React from 'react';
      const SubHeader = () => <h3>Sub</h3>;
      export const ComplexCard = () => (
        <div>
          <SubHeader />
          <p>Content</p>
        </div>
      );
    `;
    fs.writeFileSync(path.join(srcDir, 'ComplexCard.tsx'), multiCompContent, 'utf8');
    fs.writeFileSync(path.join(tempDir, 'src/App.tsx'), 'import { ComplexCard } from "./components/ComplexCard";', 'utf8');

    try {
      runBash(scriptPath, [`--manifest=${manifestPath}`, '--check-atomic'], { cwd: tempDir, stdio: 'pipe' });
      expect.fail('Should fail due to multi-component atomic design violation');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('Atomic Design Violation');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('SubHeader');
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('ComplexCard');
    }
  });

  it('should propagate --scope to check-ghost-classes.sh so legacy screens do not block the agent', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ screens: [{ id: 's1', route: '/home', selector: 'main' }] }),
      'utf8'
    );

    // Global stylesheet lives outside the slice: it must still count as a declaration pool.
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src/styles.css'), '.card { color: red; }\n', 'utf8');

    const featureDir = path.join(tempDir, 'src/features/billing');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, 'BillingCard.tsx'),
      'export const BillingCard = () => <div className="card">ok</div>;',
      'utf8'
    );

    const legacyDir = path.join(tempDir, 'src/features/legacy');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'LegacyScreen.tsx'),
      'export const LegacyScreen = () => <div className="ghost-legacy-class">legacy</div>;',
      'utf8'
    );

    // Scoped run: only the slice is audited, so the legacy ghost class is ignored.
    const scopedOutput = runBash(scriptPath, [`--manifest=${manifestPath}`, '--scope=src/features/billing'], {
      cwd: tempDir,
    });
    expect(scopedOutput).toContain("Scoped ghost-classes check active: scanning 'src/features/billing' only");
    expect(scopedOutput).toContain('CONTRACT GATE PASSED');
    expect(scopedOutput).not.toContain('ghost-legacy-class');

    // Unscoped run keeps full rigor and flags the inherited violation.
    try {
      runBash(scriptPath, [`--manifest=${manifestPath}`], { cwd: tempDir, stdio: 'pipe' });
      expect.fail('Unscoped run should fail on the legacy ghost class');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(`${error.stdout ?? ''}${error.stderr ?? ''}`).toContain('ghost-legacy-class');
    }
  });

  it('verify-stitch-design.sh should integrate check-contracts.sh with --check-atomic', () => {
    const vPath = path.resolve(__dirname, '../scripts/verify-stitch-design.sh');
    const content = fs.readFileSync(vPath, 'utf8');
    expect(content).toContain('check-contracts.sh');
    expect(content).toContain('--check-orphans');
    expect(content).toContain('--check-atomic');
  });

  it('should fail with exit 1 when UI is required (--require-ui or SPECIFY_HAS_UI=true) and routes-manifest.json is missing', () => {
    try {
      runBash(scriptPath, [`--feature-dir=${tempDir}`, '--require-ui'], { stdio: 'pipe' });
      expect.fail('Should fail when UI is required but manifest is missing');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      expect(combined).toContain('CONTRACT GATE FAILED');
      expect(combined).toContain('UI contracts are required');
    }

    try {
      runBash(scriptPath, [`--feature-dir=${tempDir}`], {
        env: { ...process.env, SPECIFY_HAS_UI: 'true' },
        stdio: 'pipe'
      });
      expect.fail('Should fail when SPECIFY_HAS_UI=true but manifest is missing');
    } catch (error: any) {
      expect(error.status).toBe(1);
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      expect(combined).toContain('CONTRACT GATE FAILED');
      expect(combined).toContain('UI contracts are required');
    }
  });

  it('should write machine evidence to evidence-dir when contracts pass', () => {
    const manifestPath = path.join(tempDir, 'routes-manifest.json');
    const evidenceDir = path.join(tempDir, 'evidence');
    const fixturesDir = path.join(tempDir, 'fixtures');
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(path.join(fixturesDir, 'data.json'), '{"ok": true}', 'utf8');

    const manifestContent = {
      screens: [
        {
          id: 'test-screen',
          route: '/test',
          selector: '#root',
          fixtures: { '/api': './fixtures/data.json' }
        }
      ]
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2), 'utf8');

    const output = runBash(scriptPath, [
      `--manifest=${manifestPath}`,
      `--evidence-dir=${evidenceDir}`
    ]);
    expect(output).toContain('CONTRACT GATE PASSED');

    const evidencePath = path.join(evidenceDir, 'contracts.json');
    expect(fs.existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    expect(evidence.gate).toBe('check-contracts');
    expect(evidence.status).toBe('passed');
    expect(evidence.screens_count).toBe(1);
  });
});
