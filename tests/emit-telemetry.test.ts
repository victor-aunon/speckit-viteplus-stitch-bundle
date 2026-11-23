import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('emit-telemetry.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/emit-telemetry.sh');
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
    logFile = path.join(tempDir, 'telemetry.jsonl');
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

  it('should support --help flag and display usage', () => {
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: emit-telemetry.sh');
    expect(output).toContain('--gate=<name>');
    expect(output).toContain('--status=<status>');
    expect(output).toContain('--summary');
  });

  it('should append structured JSON lines with timestamps and gate execution details', () => {
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-quality-gate',
      '--status=passed',
      '--duration-ms=1500',
      '--scope=src/features/billing',
      '--exit-code=0',
      '--details={"oxlint":"passed","types":"passed"}'
    ]);

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);

    const record = JSON.parse(lines[0]);
    expect(record.gate).toBe('check-quality-gate');
    expect(record.status).toBe('passed');
    expect(record.duration_ms).toBe(1500);
    expect(record.exit_code).toBe(0);
    expect(record.scope).toBe('src/features/billing');
    expect(record.details.oxlint).toBe('passed');
    expect(record.timestamp).toBeDefined();
  });

  it('should support --summary to display formatted telemetry table', () => {
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-quality-gate',
      '--status=passed',
      '--duration-ms=1200'
    ]);
    runBash(scriptPath, [
      `--file=${logFile}`,
      '--gate=check-bundle-budget',
      '--status=failed',
      '--duration-ms=850',
      '--exit-code=1'
    ]);

    const summaryOutput = runBash(scriptPath, [`--file=${logFile}`, '--summary']);
    expect(summaryOutput).toContain('[TELEMETRY SUMMARY]');
    expect(summaryOutput).toContain('check-quality-gate');
    expect(summaryOutput).toContain('check-bundle-budget');
    expect(summaryOutput).toContain('passed');
    expect(summaryOutput).toContain('failed');
  });
});
