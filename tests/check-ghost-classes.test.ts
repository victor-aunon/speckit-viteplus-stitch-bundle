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

  it('skips ghost classes check and passes when tailwind.config.js is present', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-tw-config-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'tailwind.config.js'), 'module.exports = {};\n');
      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="flex items-center p-4 bg-blue-500 rounded-lg">Tailwind</div>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('Tailwind CSS detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('skips ghost classes check and passes when package.json contains tailwindcss dependency', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-tw-pkg-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ devDependencies: { '@tailwindcss/vite': '^4.0.0' } }),
      );
      fs.writeFileSync(
        path.join(srcDir, 'Button.tsx'),
        'export const Button = () => <button className="px-4 py-2 font-bold text-white bg-indigo-600">Click</button>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('Tailwind CSS detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('skips ghost classes check and passes when CSS stylesheet imports tailwindcss', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-tw-css-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, 'global.css'),
        '@import "tailwindcss";\n',
      );
      fs.writeFileSync(
        path.join(srcDir, 'Layout.tsx'),
        'export const Layout = () => <main className="min-h-screen grid grid-cols-12 gap-4">Content</main>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('Tailwind CSS detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('enforces ghost classes check when --force flag is provided even with tailwind', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-tw-force-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'tailwind.config.js'), 'module.exports = {};\n');
      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="undeclared-ghost-utility">Force Test</div>;\n',
      );

      expect(() => {
        runBash(scriptPath, [`--src-dir=${srcDir}`, '--force'], { cwd: tempDir });
      }).toThrow();
    } finally {
      removeDir(tempDir);
    }
  });

  it('skips ghost classes check when --style-engine explicitly specifies a dynamic engine', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-style-engine-flag-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="dynamic-scoped-class">Component</div>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`, '--style-engine=styled-components'], { cwd: tempDir });
      expect(result).toContain("Style engine 'styled-components' explicitly configured");
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('autodetects UnoCSS and skips static check', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-unocss-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'uno.config.ts'), 'export default {};\n');
      fs.writeFileSync(
        path.join(srcDir, 'Header.tsx'),
        'export const Header = () => <header className="text-red-500 font-bold">Uno</header>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('UnoCSS detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('autodetects Panda CSS and skips static check', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-panda-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'panda.config.ts'), 'export default {};\n');
      fs.writeFileSync(
        path.join(srcDir, 'Box.tsx'),
        'export const Box = () => <div className="panda-box">Panda</div>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('Panda CSS detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('autodetects CSS Modules (*.module.css) and skips static check', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-modules-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'Button.module.css'), '.btn { color: red; }\n');
      fs.writeFileSync(
        path.join(srcDir, 'Button.tsx'),
        'import styles from "./Button.module.css"; export const Button = () => <button className={styles.btn}>Click</button>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('CSS Modules detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('autodetects Vanilla Extract in package.json and skips static check', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-ve-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { '@vanilla-extract/css': '^1.14.0' } }),
      );
      fs.writeFileSync(
        path.join(srcDir, 'Text.tsx'),
        'export const Text = () => <span className="ve-text">Hello</span>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('Vanilla Extract detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('autodetects Styled Components in package.json and skips static check', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-styled-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ dependencies: { 'styled-components': '^6.1.0' } }),
      );
      fs.writeFileSync(
        path.join(srcDir, 'Title.tsx'),
        'export const Title = () => <h1 className="sc-heading">Styled</h1>;\n',
      );

      const result = runBash(scriptPath, [`--src-dir=${srcDir}`], { cwd: tempDir });
      expect(result).toContain('Styled Components detected');
      expect(result).toContain('GHOST CLASSES GATE PASSED');
    } finally {
      removeDir(tempDir);
    }
  });

  it('forces static CSS checking when --style-engine=css is provided even with config present', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-test-force-css-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'tailwind.config.js'), 'module.exports = {};\n');
      fs.writeFileSync(
        path.join(srcDir, 'Card.tsx'),
        'export const Card = () => <div className="undeclared-class">Static Required</div>;\n',
      );

      expect(() => {
        runBash(scriptPath, [`--src-dir=${srcDir}`, '--style-engine=css'], { cwd: tempDir });
      }).toThrow();
    } finally {
      removeDir(tempDir);
    }
  });
});
