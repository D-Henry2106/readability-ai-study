import { databaseNameFromMongoUri } from '../../src/lib/db/mongodb-uri';

/** MongoDB Atlas shared tiers limit database names to 38 bytes; staying under it is harmless elsewhere. */
export const MAX_DATABASE_NAME_LENGTH = 38;
const TEST_NAME = /(?:^|[_-])test$/i;

export function isTestDatabaseName(name: string): boolean {
  return TEST_NAME.test(name);
}

/**
 * Name of the private database used by one Vitest worker of one test run:
 * `<stem>_<runId>_w<workerId>_test`. It always still ends in `_test`, so the destructive-test guard keeps working.
 */
export function workerDatabaseName(baseName: string, runId: string, workerId: string): string {
  if (!isTestDatabaseName(baseName)) throw new Error('Refusing: the base database name must end in _test or -test.');
  if (!/^[a-z0-9]{3,12}$/.test(runId)) throw new Error('Invalid test run id.');
  if (!/^[0-9]{1,3}$/.test(workerId)) throw new Error('Invalid test worker id.');
  const suffix = `_${runId}_w${workerId}_test`;
  const stem = baseName.replace(/[_-]test$/i, '').slice(0, Math.max(1, MAX_DATABASE_NAME_LENGTH - suffix.length));
  return `${stem}${suffix}`;
}

/** Replaces only the database path segment; host, credentials and options stay exactly as given. */
export function withDatabaseName(uri: string, databaseName: string): string {
  const pattern = /^(mongodb(?:\+srv)?:\/\/[^/?#]+\/)([^?#]+)/i;
  if (!pattern.test(uri)) throw new Error('MONGODB_URI must include a database name after the host.');
  return uri.replace(pattern, (_m, prefix: string) => `${prefix}${encodeURIComponent(databaseName)}`);
}

/**
 * Per-worker URI, derived from the BASE uri every time (never from an already derived one).
 * Returns null when the base is not a test database; the destructive-test guard then refuses to run.
 */
export function deriveWorkerMongoUri(baseUri: string, runId: string, workerId: string): string | null {
  let baseName: string;
  try { baseName = databaseNameFromMongoUri(baseUri); } catch { return null; }
  if (!isTestDatabaseName(baseName)) return null;
  return withDatabaseName(baseUri, workerDatabaseName(baseName, runId, workerId));
}
