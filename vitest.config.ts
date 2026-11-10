import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

Object.assign(process.env, { NODE_ENV: 'test' });
loadEnvConfig(process.cwd());

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Database round-trips can be slow on shared CI machines; a tight limit only turns slowness into cascading failures.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Database-backed files get one private database per worker; opt out with TEST_DB_ISOLATION=serial.
    fileParallelism: process.env.TEST_DB_ISOLATION !== 'serial',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
