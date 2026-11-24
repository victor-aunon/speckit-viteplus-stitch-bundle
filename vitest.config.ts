import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // These are integration tests: most cases spawn real bash gates, which in turn
    // spawn node for evidence/telemetry. Under a fully parallel suite a 15s budget
    // was too tight for the heavier cases (measured: <5s each in isolation).
    testTimeout: 45000,
    // Each test spawns synchronous bash+node gates, which blocks the worker's
    // event loop. birpc (vitest's worker RPC) gives up after 60s, so an
    // overloaded pool surfaces "[vitest-worker]: Timeout calling onTaskUpdate"
    // even when every test passes. Two workers keep each blocking call well
    // under that budget.
    maxWorkers: 2,
    include: ['tests/**/*.test.ts'],
  },
});
