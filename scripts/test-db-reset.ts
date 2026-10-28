import { MongoClient } from 'mongodb';
import { loadTestEnv } from './load-env';
import { requireTestMongoUri } from '../tests/helpers/test-mongo-env';

async function main(): Promise<void> {
  loadTestEnv();
  const { uri, databaseName } = requireTestMongoUri();

  const client = new MongoClient(uri);
  try {
    await client.connect();
    await client.db().dropDatabase();
    console.log(`Test database reset: ${databaseName}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
