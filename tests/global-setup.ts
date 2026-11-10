import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { databaseNameFromMongoUri } from '../src/lib/db/mongodb-uri';
import { isTestDatabaseName, workerDatabaseName } from './helpers/test-db-name';

const MAX_WORKER_IDS_TO_CLEAN = 64;

/**
 * Runs once in the main Vitest process. It gives this run a unique id (so two runs, e.g. two CI jobs,
 * never share a database) and, afterwards, drops the per-worker databases that THIS run created.
 * It never touches the base database or any database whose name it did not generate.
 */
export default function setup() {
  if (process.env.TEST_DB_ISOLATION === 'serial') return undefined;
  const runId = randomBytes(3).toString('hex');
  process.env.CRP_TEST_RUN_ID = runId;

  return async function teardown() {
    const baseUri = process.env.MONGODB_URI;
    if (!baseUri) return;
    let baseName: string;
    try { baseName = databaseNameFromMongoUri(baseUri); } catch { return; }
    if (!isTestDatabaseName(baseName)) return;
    const client = new MongoClient(baseUri, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      for (let worker = 1; worker <= MAX_WORKER_IDS_TO_CLEAN; worker += 1) {
        await client.db(workerDatabaseName(baseName, runId, String(worker))).dropDatabase().catch(() => undefined);
      }
    } catch {
      console.warn(`Test database cleanup skipped (run id ${runId}); leftover databases end in _${runId}_w<N>_test.`);
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}
