import fs from 'node:fs';

/**
 * Remove a temporary directory without turning a cleanup race into a test
 * failure. On Windows, especially after a WSL process touched the directory,
 * the OS can briefly keep a handle open even though the test itself passed.
 */
export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch {
    // Cleanup is best-effort; the assertion result is what matters.
  }
}
