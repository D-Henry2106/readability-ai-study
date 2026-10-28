import { databaseNameFromMongoUri } from '../../src/lib/db/mongodb-uri';

/** A destructive test may only target an explicitly named *_test/-test database. */
export function requireTestMongoUri(): { uri: string; databaseName: string } {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Database-backed tests require NODE_ENV=test.');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required for tests. Set it in .env.test.local (not .env.local).');
  }

  const databaseName = databaseNameFromMongoUri(uri);
  if (!/(?:^|[_-])test$/i.test(databaseName)) {
    throw new Error('Refusing to run destructive tests: the database name in MONGODB_URI must end in _test or -test.');
  }

  return { uri, databaseName };
}
