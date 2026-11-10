import { describe, it, expect } from 'vitest';
import { databaseNameFromMongoUri } from '@/lib/db/mongodb-uri';
import { getDb } from '@/lib/db/mongodb';
import { withTestDb } from '../helpers/test-db';

describe('integration tests use a private per-worker database (P0)', () => {
  it('the test client and the application client point at the same private *_test database', async () => {
    const configured = databaseNameFromMongoUri(process.env.MONGODB_URI!);
    expect(configured).toMatch(/_test$/);
    const [testClientDb, appDb] = await Promise.all([withTestDb(async (db) => db.databaseName), getDb().then((db) => db.databaseName)]);
    expect(testClientDb).toBe(configured);
    expect(appDb).toBe(configured);
    if (process.env.TEST_DB_ISOLATION !== 'serial' && process.env.CRP_TEST_BASE_MONGODB_URI) {
      expect(configured).not.toBe(databaseNameFromMongoUri(process.env.CRP_TEST_BASE_MONGODB_URI));
      expect(configured).toMatch(/_w\d+_test$/);
    }
  });
});
