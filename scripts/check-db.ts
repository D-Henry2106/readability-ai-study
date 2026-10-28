import { loadDevelopmentEnv } from './load-env';
import { getMongoClient, getDb } from '../src/lib/db/mongodb';

async function main(): Promise<void> {
  loadDevelopmentEnv();
  const client = await getMongoClient();
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    console.log(`MongoDB connection OK. Database: ${db.databaseName}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('MongoDB connection failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
