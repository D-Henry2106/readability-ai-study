import { collections } from '../src/lib/db/collections';
import { disableAdminAccount, MongoAdminAccountStore } from '../src/lib/services/admin-account.service';
import { AdminSessionService, MongoAdminDirectory, MongoAdminSessionStore } from '../src/lib/auth/admin-session-service';
import { AuditService } from '../src/lib/services/audit.service';
import { getMongoClient } from '../src/lib/db/mongodb';
import { loadDevelopmentEnv } from './load-env';

/** Usage: npm run admin:disable -- <username>. Disables the account and revokes all its sessions. Deletes nothing. */
async function main(): Promise<void> {
  loadDevelopmentEnv();
  const username = process.argv[2]?.trim();
  if (!username) throw new Error('Usage: npm run admin:disable -- <username>');
  try {
    await collections();
    const sessions = new AdminSessionService(new MongoAdminSessionStore(), new MongoAdminDirectory(), () => ({ idleMs: 0, absoluteMs: 0 }));
    const result = await disableAdminAccount(
      { username, actor: { username: 'system:cli', role: 'SYSTEM' } },
      { store: new MongoAdminAccountStore(), revokeAllSessions: (u, reason) => sessions.revokeAllForUser(u, reason), audit: new AuditService() }
    );
    console.log(result.disabled ? `Disabled "${username}"; revoked ${result.revokedSessions} session(s).` : `No active account named "${username}" was found.`);
  } finally {
    const client = await getMongoClient().catch(() => null);
    await client?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
