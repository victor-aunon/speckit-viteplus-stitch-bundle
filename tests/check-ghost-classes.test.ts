import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

describe('check-ghost-classes.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/check-ghost-classes.sh');

  it('prints usage instructions when passed --help', () => {
    const result = runBash(scriptPath, ['--help']);
    expect(result).toContain('Usage: check-ghost-classes.sh');
    expect(result).toContain('--src-dir');
  });

  it('passes when all JSX classes are declared in a CSS file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-pass-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      const stylesDir = path.join(srcDir, 'styles');
      fs.mkdirSync(stylesDir, { recursive: true });

      fs.writeFileSync(
        path.join(stylesDir, 'main.css'),
        '.card { background: black; }\n.btn-primary { color: white; }\n',
      );

      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="card"><button className="btn-primary">Click</button></div>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('fails when an undeclared ghost class is used in JSX', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-fail-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      const stylesDir = path.join(srcDir, 'styles');
      fs.mkdirSync(stylesDir, { recursive: true });

      fs.writeFileSync(
        path.join(stylesDir, 'main.css'),
        '.card { background: black; }\n',
      );

      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="card"><button className="ghost-button-action">Click</button></div>;\n',
      );

      expect(() => {
        runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      }).toThrow();
    } finally {
      removeDir(tempDir);
    }
  });

  it('does not fail when run with --dry-run even with ghost classes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-dry-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="non-existent-class" />;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`, '--dry-run'], { cwd: tempDir });
      expect(result).toContain('GHOST CLASS DETECTED');
    } finally {
      removeDir(tempDir);
    }
  });
});
