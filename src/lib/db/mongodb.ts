import { MongoClient, type Db } from 'mongodb';
import { getMongoEnv } from '@/config/env';

declare global {
  var __researchMongoClientPromise: Promise<MongoClient> | undefined;
}

export async function getMongoClient(): Promise<MongoClient> {
  const { MONGODB_URI } = getMongoEnv();

  if (!global.__researchMongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });

    global.__researchMongoClientPromise = client.connect().catch((error) => {
      global.__researchMongoClientPromise = undefined;
      throw error;
    });
  }

  return global.__researchMongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  // MongoClient.db() selects the database declared in the URI path.
  return client.db();
}
