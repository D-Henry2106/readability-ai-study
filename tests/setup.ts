import { afterAll } from 'vitest';
import { deriveWorkerMongoUri } from './helpers/test-db-name';

if (!process.env.AUTH_SECRET) {
  Object.assign(process.env, { AUTH_SECRET: 'test-only-auth-secret-change-me-1234567890' });
}

// Each Vitest worker gets a private database derived from the base *_test URI, so test files that run in
// parallel (and separate test runs) can never drop each other's data. TEST_DB_ISOLATION=serial opts out
// (single shared database; vitest.config.ts then also disables file parallelism).
const baseUri = process.env.CRP_TEST_BASE_MONGODB_URI ?? process.env.MONGODB_URI;
if (baseUri && process.env.TEST_DB_ISOLATION !== 'serial') {
  const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '1';
  const derived = deriveWorkerMongoUri(baseUri, process.env.CRP_TEST_RUN_ID ?? 'local', workerId);
  if (derived) {
    process.env.CRP_TEST_BASE_MONGODB_URI = baseUri;
    process.env.MONGODB_URI = derived;
  }
}

// Close the application's cached MongoDB client when a test file finishes (no dangling connections).
afterAll(async () => {
  const pending = globalThis.__researchMongoClientPromise;
  if (!pending) return;
  globalThis.__researchMongoClientPromise = undefined;
  await (await pending.catch(() => null))?.close().catch(() => undefined);
});
