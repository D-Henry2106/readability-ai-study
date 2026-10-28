import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { requireTestMongoUri } from './tests/helpers/test-mongo-env';

Object.assign(process.env, { NODE_ENV: 'test' });
loadEnvConfig(process.cwd());
// Validate before global setup can drop a database or the web server can start.
const { uri: testMongoUri } = requireTestMongoUri();

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- -p 3100',
    url: 'http://127.0.0.1:3100',
    // Never run destructive E2E fixtures against an already-running dev server.
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MONGODB_URI: testMongoUri,
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-only-auth-secret-change-me-1234567890',
      APP_URL: 'http://127.0.0.1:3100'
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
