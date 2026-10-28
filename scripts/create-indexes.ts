import { ensureIndexes } from '../src/lib/db/indexes';
import { getMongoClient } from '../src/lib/db/mongodb';
import { loadDevelopmentEnv } from './load-env';

async function main(): Promise<void> {
  loadDevelopmentEnv();
  try {
    await ensureIndexes();
    console.log('MongoDB indexes created/verified.');
  } finally {
    const client = await getMongoClient().catch(() => null);
    await client?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
