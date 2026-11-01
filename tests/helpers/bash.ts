import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type BashRuntime = {
  command: string;
  isWsl: boolean;
};

let cachedRuntime: BashRuntime | undefined;

function isWindows(): boolean {
  return process.platform === 'win32';
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function isWslExecutable(candidate: string): boolean {
  const normalized = normalizeSlashes(candidate).toLowerCase();
  return (
    normalized.includes('/system32/bash.exe') ||
    normalized.includes('/windowsapps/bash.exe')
  );
}

function whereBashCandidates(): string[] {
  try {
    return execFileSync('where.exe', ['bash'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function knownGitBashCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA;

  return [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    localAppData ? path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : '',
  ].filter(Boolean);
}

function detectWsl(command: string): boolean {
  if (isWslExecutable(command)) {
    return true;
  }

  try {
    const kernel = execFileSync(command, ['-lc', 'uname -r'], { encoding: 'utf8' });
    return /microsoft|wsl/i.test(kernel);
  } catch {
    return false;
  }
}

function resolveBashRuntime(): BashRuntime {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  const override = process.env.SPECKIT_TEST_BASH;
  if (override) {
    cachedRuntime = { command: override, isWsl: detectWsl(override) };
    return cachedRuntime;
  }

  if (!isWindows()) {
    cachedRuntime = { command: 'bash', isWsl: false };
    return cachedRuntime;
  }

  const candidates = [...knownGitBashCandidates(), ...whereBashCandidates()].filter(
    (candidate) => fs.existsSync(candidate)
  );

  // Prefer Git Bash/MSYS/Cygwin over the WSL launcher in System32.
  const nonWsl = candidates.find((candidate) => !isWslExecutable(candidate));
  const command = nonWsl ?? candidates[0] ?? 'bash';

  cachedRuntime = { command, isWsl: detectWsl(command) };
  return cachedRuntime;
}

function toWslPath(windowsPath: string): string {
  const normalized = normalizeSlashes(windowsPath);
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (drive) {
    return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`;
  }
  return normalized;
}

function toBashPath(value: string, runtime: BashRuntime): string {
  if (!isWindows()) {
    return value;
  }
  return runtime.isWsl ? toWslPath(value) : normalizeSlashes(value);
}

function convertArgument(argument: string, runtime: BashRuntime): string {
  const optionPath = /^(--?[\w-]+=)([A-Za-z]:[\\/].*)$/.exec(argument);
  if (optionPath) {
    return `${optionPath[1]}${toBashPath(optionPath[2], runtime)}`;
  }

  if (/^[A-Za-z]:[\\/]/.test(argument)) {
    return toBashPath(argument, runtime);
  }

  return argument;
}

/**
 * Run a bash script without going through a shell.
 *
 * - Avoids Windows/PowerShell path splitting (paths with spaces).
 * - Prefers Git Bash on Windows when available.
 * - Falls back to WSL and converts `C:\...` arguments to `/mnt/c/...`.
 */
export function runBash(
  scriptPath: string,
  args: string[] = [],
  options: Partial<ExecFileSyncOptionsWithStringEncoding> = {}
): string {
  const runtime = resolveBashRuntime();
  const bashScriptPath = toBashPath(scriptPath, runtime);
  const bashArgs = args.map((argument) => convertArgument(argument, runtime));

  return execFileSync(runtime.command, [bashScriptPath, ...bashArgs], {
    encoding: 'utf8',
    ...options,
  }) as string;
}

export function getBashRuntime(): BashRuntime {
  return resolveBashRuntime();
}

export function bashHasCommand(command: string): boolean {
  const runtime = resolveBashRuntime();
  try {
    const output = execFileSync(runtime.command, ['-lc', `command -v ${command}`], {
      encoding: 'utf8',
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}
