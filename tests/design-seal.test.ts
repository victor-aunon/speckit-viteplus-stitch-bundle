import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

/**
 * The design master is the reference the visual gate grades the implementation
 * against, and `verify-stitch-design.sh` re-renders the goldens from it on every
 * run. If that reference can change between runs, the gate grades the
 * implementation against whatever the agent last edited.
 *
 * Real incident: a repair agent added `min-height: 2.75rem` to
 * `designs/screen-modal-confirmation-dialog.html` at 13:39; the visual gate
 * re-ran at 13:44 and passed against the reference the agent had just moved. The
 * auditor never saw it because its protocol is "from-scratch, not a diff review".
 *
 * The seal is taken by `check-design-artifacts.sh` and recomputed by the visual
 * gate. These tests pin the properties the seal has to have for that to work.
 */
describe('design-seal.sh', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/design-seal.sh');
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-seal-'));
  });

  afterEach(() => {
    removeDir(tempDir);
  });

  const seal = (designsDir: string): string =>
    String(runBash(scriptPath, [`--designs-dir=${designsDir}`], { stdio: 'pipe' })).trim();

  const write = (relative: string, content: string): void => {
    const target = path.join(tempDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };

  const designsDir = (): string => path.join(tempDir, 'designs');

  it('exists and documents itself', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(process.platform === 'win32' || (stats.mode & 0o111) > 0).toBe(true);
    expect(String(runBash(scriptPath, ['--help']))).toContain('--designs-dir');
  });

  it('is deterministic for the same tree', () => {
    write('designs/screen-a.html', '<div>a</div>\n');
    write('designs/tokens.css', ':root { --color-primary: #000; }\n');
    expect(seal(designsDir())).toBe(seal(designsDir()));
  });

  it('changes when a screen changes', () => {
    write('designs/screen-a.html', '<div>a</div>\n');
    const before = seal(designsDir());
    write('designs/screen-a.html', '<div>b</div>\n');
    expect(seal(designsDir())).not.toBe(before);
  });

  it('changes when a screen is renamed, and when one is added', () => {
    write('designs/screen-a.html', '<div>a</div>\n');
    const before = seal(designsDir());

    fs.renameSync(path.join(designsDir(), 'screen-a.html'), path.join(designsDir(), 'screen-b.html'));
    const renamed = seal(designsDir());
    expect(renamed).not.toBe(before);

    write('designs/screen-c.html', '<div>c</div>\n');
    expect(seal(designsDir())).not.toBe(renamed);
  });

  it('does not depend on file order in the directory', () => {
    // `LC_ALL=C sort` keeps the digest byte-stable across machines and file
    // systems that hand back directory entries in a different order.
    write('designs/z.html', '<div>z</div>\n');
    write('designs/a.html', '<div>a</div>\n');
    const first = seal(designsDir());
    const nested = path.join(tempDir, 'other', 'designs');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'a.html'), '<div>a</div>\n', 'utf8');
    fs.writeFileSync(path.join(nested, 'z.html'), '<div>z</div>\n', 'utf8');
    expect(seal(nested)).toBe(first);
  });

  it('prints an empty seal when there is no design directory', () => {
    // "No designs" has to be distinguishable from "the seal was not computed".
    expect(seal(path.join(tempDir, 'nope'))).toBe('');
  });

  it('rejects a missing or unknown option instead of sealing the wrong tree', () => {
    expect(() => runBash(scriptPath, [], { stdio: 'pipe' })).toThrow();
    expect(() => runBash(scriptPath, ['--nope=1'], { stdio: 'pipe' })).toThrow();
  });
});
