import { MongoClient } from 'mongodb';
import { loadDevelopmentEnv } from './load-env';
import { databaseNameFromMongoUri } from '../src/lib/db/mongodb-uri';

const APP_COLLECTIONS = [
  'sessions',
  'consents',
  'demographics',
  'content_revisions',
  'content_packages',
  'question_sets',
  'reading_sessions',
  'test_attempts',
  'breaks',
  'experiment_events',
  'study_runs',
  'invitations',
  'presentation_profiles',
  'rate_limits',
  'admin_sessions',
  'admin_audit'
] as const;

function printUsage(): void {
  console.log(`
Safe Local Database Cleanup Utility
====================================
Usage:
  Dry-run inspection:
    npm run db:clean:dev -- --dry-run

  Actual cleanup:
    npm run db:clean:dev -- --confirm <EXACT_DATABASE_NAME>

Safety rules:
  1. Only runs in development or test environment (refuses NODE_ENV=production).
  2. Refuses any database with "prod" or "production" in its name or host.
  3. Never drops the database; only deletes application collections.
  4. Requires exact database name confirmation flag.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const confirmIndex = args.indexOf('--confirm');
  const confirmDbName = confirmIndex !== -1 ? args[confirmIndex + 1] : null;

  if (!isDryRun && !confirmDbName) {
    printUsage();
    process.exit(1);
  }

  // 1. Safety check: NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    console.error('ERROR: Refusing to run in production environment (NODE_ENV=production).');
    process.exit(1);
  }

  // Load dev environment
  loadDevelopmentEnv();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI is not set. Please check .env.local.');
    process.exit(1);
  }

  // 2. Validate URI and database name
  let targetDbName: string;
  try {
    targetDbName = databaseNameFromMongoUri(uri);
  } catch (err) {
    console.error(`ERROR: Failed to parse database name from MONGODB_URI: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // 3. Reject production database names and connection targets
  const lowerName = targetDbName.toLowerCase();
  const lowerUri = uri.toLowerCase();
  if (
    lowerName.includes('prod') ||
    lowerName.includes('production') ||
    lowerUri.includes('prod') ||
    lowerUri.includes('production')
  ) {
    console.error(`ERROR: Refusing to clean database "${targetDbName}": Name or target contains "prod"/"production".`);
    process.exit(1);
  }

  console.log(`Target Database: ${targetDbName}`);
  console.log(`Mode:            ${isDryRun ? 'DRY-RUN (No changes will be made)' : 'ACTUAL CLEANUP'}`);

  if (!isDryRun) {
    if (confirmDbName !== targetDbName) {
      console.error(
        `ERROR: Confirmation database name mismatch.\n` +
        `Expected: --confirm ${targetDbName}\n` +
        `Received: --confirm ${confirmDbName}`
      );
      process.exit(1);
    }
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(targetDbName);

    console.log(`\nInspecting application collections in ${targetDbName}:`);
    console.log('--------------------------------------------------');

    let totalDeleted = 0;
    const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);

    for (const colName of APP_COLLECTIONS) {
      if (!existingCollections.includes(colName)) {
        console.log(`- ${colName.padEnd(25)} : (collection not found, skipping)`);
        continue;
      }

      const col = db.collection(colName);
      const count = await col.countDocuments();

      if (isDryRun) {
        console.log(`- ${colName.padEnd(25)} : ${count} document(s) would be deleted`);
      } else {
        const result = await col.deleteMany({});
        console.log(`- ${colName.padEnd(25)} : ${result.deletedCount} document(s) deleted`);
        totalDeleted += result.deletedCount;
      }
    }

    console.log('--------------------------------------------------');
    if (isDryRun) {
      console.log(`Dry-run complete. Run with --confirm ${targetDbName} to execute.`);
    } else {
      console.log(`Cleanup complete. Total documents deleted: ${totalDeleted}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Fatal error during database cleanup:', error instanceof Error ? error.message : error);
  process.exit(1);
});
