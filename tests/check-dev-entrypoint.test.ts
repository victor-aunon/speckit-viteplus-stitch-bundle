import { describe, it, expect } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { runBash } from './helpers/bash';
import { removeDir } from './helpers/fs';

/**
 * Runtime entrypoint contract gate.
 *
 * `has_ui` describes the FEATURE, not the project: a backend feature normally
 * lives inside a React/Vite repository where `npm run dev` legitimately boots
 * Vite. These tests pin that model down: the gate must verify the runtime the
 * feature declares and must never ask for the project's own dev script to change.
 */

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'scripts/check-dev-entrypoint.sh');

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-entrypoint-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }
  return dir;
}

function runGate(cwd: string, extraArgs: string[] = []): { output: string; status: number } {
  try {
    const output = runBash(scriptPath, extraArgs, { cwd, stdio: 'pipe' });
    return { output, status: 0 };
  } catch (error: any) {
    return {
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      status: error.status ?? 1,
    };
  }
}

function freePort(): number {
  const server = net.createServer();
  server.listen(0);
  const address = server.address() as net.AddressInfo;
  server.close();
  return address.port;
}

const SERVER_SCRIPT = `
const http = require('node:http');
const port = Number(process.argv[2]);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});
server.listen(port);
`;

const CONTRACT = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify(
    {
      kind: 'http',
      command: 'node server.js',
      readiness: '/health',
      ...overrides,
    },
    null,
    2
  );

function readEvidence(dir: string): any {
  const file = path.join(dir, 'specs/001-shortener/evidence/runtime-entrypoint.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Start a server in a SEPARATE process. `execFileSync` blocks this process's
 * event loop, so an in-process HTTP server could never answer the gate's probe.
 */
function startForeignServer(cwd: string, port: number): ChildProcess {
  const child = spawn(process.execPath, ['server.js', String(port)], {
    cwd,
    stdio: 'ignore',
    detached: false,
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const code = execFileSync(
        'curl',
        ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${port}/health`],
        { encoding: 'utf8', timeout: 2000 }
      );
      if (code.trim() === '200') {
        return child;
      }
    } catch {
      // not ready yet
    }
  }
  return child;
}

describe('Runtime entrypoint contract gate', () => {
  it('should exist, be executable and document its contract in --help', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const output = runBash(scriptPath, ['--help']);
    expect(output).toContain('Usage: check-dev-entrypoint.sh');
    expect(output).toContain('runtime.json');
    expect(output).toContain('--require-contract');
  });

  it('skips with a reason when the feature declares no runtime contract', () => {
    const dir = makeProject({ 'specs/001-shortener/spec.md': '# feature\n' });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(0);
      expect(result.output).toContain('skipped');
    } finally {
      removeDir(dir);
    }
  });

  it('fails when --require-contract is set and no contract exists', () => {
    const dir = makeProject({ 'specs/001-shortener/spec.md': '# feature\n' });
    try {
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(1);
      expect(result.output).toContain('runtime contract');
      expect(result.output).toContain('runtime.json');
    } finally {
      removeDir(dir);
    }
  });

  it('accepts kind=none only when a reason is recorded', () => {
    const withReason = makeProject({
      'specs/001-shortener/runtime.json': JSON.stringify({
        kind: 'none',
        reason: 'domain-only: pure streak calculations, no entrypoint',
      }),
    });
    const withoutReason = makeProject({
      'specs/001-shortener/runtime.json': JSON.stringify({ kind: 'none' }),
    });
    try {
      const accepted = runGate(withReason, ['--require-contract']);
      expect(accepted.status).toBe(0);
      expect(accepted.output).toContain('domain-only');
      expect(readEvidence(withReason).metrics.reason).toContain('domain-only');

      const rejected = runGate(withoutReason, ['--require-contract']);
      expect(rejected.status).toBe(1);
      expect(rejected.output).toContain('reason');
    } finally {
      removeDir(withReason);
      removeDir(withoutReason);
    }
  });

  it('fails on an unsupported runtime kind', () => {
    const dir = makeProject({
      'specs/001-shortener/runtime.json': JSON.stringify({ kind: 'grpc' }),
    });
    try {
      const result = runGate(dir);
      expect(result.status).toBe(1);
      expect(result.output).toContain('grpc');
    } finally {
      removeDir(dir);
    }
  });

  it('passes when the declared command serves HTTP 2xx, without touching the project dev script', () => {
    const port = freePort();
    // The project keeps its React/Vite dev script: only `dev:api` is the runtime.
    const dir = makeProject({
      'package.json': JSON.stringify({
        name: 'react-app-with-api-feature',
        scripts: { dev: 'vp dev', 'dev:api': `node server.js ${port}` },
      }),
      'server.js': SERVER_SCRIPT,
      'specs/001-shortener/runtime.json': CONTRACT({
        command: `node server.js ${port}`,
        port,
      }),
    });
    try {
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(0);
      expect(result.output).toContain('RUNTIME ENTRYPOINT GATE PASSED');
      expect(result.output).toContain('curl -i http://127.0.0.1');

      const evidence = readEvidence(dir);
      expect(evidence.status).toBe('passed');
      expect(evidence.metrics.http_status).toBe(200);
      expect(evidence.metrics.port).toBe(port);

      // The package.json of the project must remain untouched.
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.dev).toBe('vp dev');
    } finally {
      removeDir(dir);
    }
  });

  it('fails when the readiness path does not answer 2xx', () => {
    const port = freePort();
    const dir = makeProject({
      'server.js': SERVER_SCRIPT,
      'specs/001-shortener/runtime.json': CONTRACT({
        command: `node server.js ${port}`,
        port,
        readiness: '/missing',
      }),
    });
    try {
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(1);
      expect(result.output).toContain('404');
      expect(result.output).toContain('expected 2xx');
    } finally {
      removeDir(dir);
    }
  });

  it('fails when the declared command exits before serving', () => {
    const dir = makeProject({
      'specs/001-shortener/runtime.json': CONTRACT({
        command: 'node -e "process.exit(1)"',
        port: freePort(),
      }),
    });
    try {
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(1);
      expect(result.output).toContain('exited before serving');
    } finally {
      removeDir(dir);
    }
  });

  it('rejects a contract that points at a Vite built-in command', () => {
    const dir = makeProject({
      'specs/001-shortener/runtime.json': CONTRACT({ command: 'vp dev', port: freePort() }),
    });
    try {
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(1);
      expect(result.output).toContain('Vite built-in command');
      expect(result.output).toContain('ignores package.json');
      expect(result.output).toContain('dev:api');
    } finally {
      removeDir(dir);
    }
  });

  it('accepts a full-stack framework dev server when the readiness path is specific', () => {
    // Next serves its API routes from `next dev` (`app/api/*/route.ts`), so the
    // command is legitimate; only the readiness path has to be a real API route.
    const dir = makeProject({
      'specs/001-shortener/runtime.json': CONTRACT({
        command: 'next dev',
        port: freePort(),
        readiness: '/api/health',
      }),
    });
    try {
      const result = runGate(dir, ['--require-contract', '--dry-run']);
      expect(result.status).toBe(0);
      expect(result.output).toContain('Dry run completed');
      expect(result.output).toContain('/api/health');
    } finally {
      removeDir(dir);
    }
  });

  it('rejects readiness "/" on a dev-server runtime, because it proves nothing', () => {
    const dir = makeProject({
      'specs/001-shortener/runtime.json': CONTRACT({
        command: 'next dev',
        port: freePort(),
        readiness: '/',
      }),
    });
    try {
      const result = runGate(dir, ['--require-contract', '--dry-run']);
      expect(result.status).toBe(1);
      expect(result.output).toContain('readiness path');
      expect(result.output).toContain('/api/health');
    } finally {
      removeDir(dir);
    }
  });

  it('does not apply the dev-server readiness rule to a dedicated API process', () => {
    const dir = makeProject({
      'specs/001-shortener/runtime.json': CONTRACT({
        command: 'npm run dev:api',
        port: freePort(),
        readiness: '/',
      }),
    });
    try {
      const result = runGate(dir, ['--require-contract', '--dry-run']);
      expect(result.status).toBe(0);
    } finally {
      removeDir(dir);
    }
  });

  it('refuses to certify a server it did not start', () => {
    const port = freePort();
    const dir = makeProject({
      'server.js': SERVER_SCRIPT,
      'specs/001-shortener/runtime.json': CONTRACT({ command: `node server.js ${port}`, port }),
    });
    const squatter = startForeignServer(dir, port);
    try {
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(2);
      expect(result.output).toContain('already answers');
    } finally {
      squatter.kill('SIGKILL');
      removeDir(dir);
    }
  });

  it('fails when kind=http declares no port instead of guessing one', () => {
    const port = freePort();
    const dir = makeProject({
      'server.js': SERVER_SCRIPT,
      'specs/001-shortener/runtime.json': JSON.stringify({
        kind: 'http',
        command: `node server.js ${port}`,
        readiness: '/health',
      }),
    });
    try {
      // No port in the contract and no --port: the gate must stop instead of
      // regex-guessing a number out of the typed env module.
      const result = runGate(dir, ['--require-contract']);
      expect(result.status).toBe(1);
      expect(result.output).toContain('requires a "port"');
      expect(result.output).toContain('src/config/env.ts');

      // ...and --port is the documented escape hatch for ad-hoc verification.
      const overridden = runGate(dir, ['--require-contract', `--port=${port}`]);
      expect(overridden.status).toBe(0);
      expect(overridden.output).toContain('source: flag');
    } finally {
      removeDir(dir);
    }
  });

  it('records append-only evidence across repeated identical runs', () => {
    const reason = 'domain-only: no entrypoint';
    const dir = makeProject({
      'specs/001-shortener/runtime.json': JSON.stringify({ kind: 'none', reason }),
    });
    try {
      runGate(dir, ['--require-contract']);
      runGate(dir, ['--require-contract']);
      const historyPath = path.join(
        dir,
        'specs/001-shortener/evidence/runtime-entrypoint.history.jsonl'
      );
      const lines = fs
        .readFileSync(historyPath, 'utf8')
        .split('\n')
        .filter(Boolean);
      expect(lines.length).toBe(1);
    } finally {
      removeDir(dir);
    }
  });

  it('dry-run resolves the contract without starting anything', () => {
    const dir = makeProject({
      'specs/001-shortener/runtime.json': CONTRACT({
        command: `node server.js ${freePort()}`,
        port: freePort(),
      }),
    });
    try {
      const result = runGate(dir, ['--dry-run', '--require-contract']);
      expect(result.status).toBe(0);
      expect(result.output).toContain('Dry run completed');
    } finally {
      removeDir(dir);
    }
  });
});