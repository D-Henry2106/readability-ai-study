import { loadEnvConfig } from '@next/env';

export function loadDevelopmentEnv(): void {
  loadEnvConfig(process.cwd(), true);
}

export function loadTestEnv(): void {
  Object.assign(process.env, { NODE_ENV: 'test' });
  loadEnvConfig(process.cwd());
}
