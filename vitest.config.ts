import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // These are integration tests: most cases spawn real bash gates, which in turn
    // spawn node for evidence/telemetry. Under a fully parallel suite a 15s budget
    // was too tight for the heavier cases (measured: <5s each in isolation).
    testTimeout: 45000,
    // Each test spawns synchronous bash+node gates. Running one file per core
    // starves the workers and trips vitest's internal RPC timeouts, so cap the
    // pool instead of inflating timers further.
    maxWorkers: 4,
    include: ['tests/**/*.test.ts'],
  },
});
