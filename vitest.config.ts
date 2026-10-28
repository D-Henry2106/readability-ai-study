import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

Object.assign(process.env, { NODE_ENV: 'test' });
loadEnvConfig(process.cwd());

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
