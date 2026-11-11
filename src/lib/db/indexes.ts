import { collections } from './collections';

export async function ensureIndexes(): Promise<void> {
  const c = await collections();
  await Promise.all([
    c.sessions.createIndex({ id: 1 }, { unique: true }),
    c.sessions.createIndex({ status: 1 }),
    c.sessions.createIndex({ groupCode: 1 }),
    c.sessions.createIndex({ validityFlag: 1 }),
    c.sessions.createIndex({ createdAt: -1 }),
    c.consents.createIndex({ sessionId: 1 }, { unique: true }),
    c.demographics.createIndex({ sessionId: 1 }, { unique: true }),
    c.readingSessions.createIndex({ sessionId: 1, roundNo: 1 }, { unique: true }),
    c.testAttempts.createIndex({ sessionId: 1, roundNo: 1 }, { unique: true }),
    c.breaks.createIndex({ sessionId: 1 }, { unique: true }),
    c.admins.createIndex({ username: 1 }, { unique: true }),
    c.experimentEvents.createIndex({ sessionId: 1, createdAt: 1 }),
    c.experimentEvents.createIndex({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } }),
    c.contentPackages.createIndex({ code: 1, revision: 1 }, { unique: true }),
    c.contentPackages.createIndex({ phase: 1, status: 1, enabled: 1 }),
    c.sessions.createIndex({ assignedPackageId: 1, phase: 1 }),
    c.contentRevisions.createIndex({ phase: 1, status: 1, revision: -1 }),
    c.questionSets.createIndex({ phase: 1, status: 1, revision: -1 }),
    c.adminAudit.createIndex({ createdAt: -1 }),
    c.experimentConfig.createIndex({ key: 1 }, { unique: true }),
    // Auth/security collections (no research data): lookups by token hash, TTL cleanup one day after expiry.
    c.adminSessions.createIndex({ tokenHash: 1 }, { unique: true }),
    c.adminSessions.createIndex({ username: 1, revokedAt: 1 }),
    c.adminSessions.createIndex({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 86400 }),
    c.rateLimits.createIndex({ key: 1, windowStart: 1 }, { unique: true }),
    c.rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Study Run (P1): unique run code and status lookups.
    c.studyRuns.createIndex({ code: 1 }, { unique: true }),
    c.studyRuns.createIndex({ status: 1 }),
    // Study Run (P2): invitations (token lookup by hash, one session per invitation) and run-aware session lookups.
    c.invitations.createIndex({ tokenHash: 1 }, { unique: true }),
    c.invitations.createIndex({ studyRunId: 1, variant: 1, status: 1 }),
    c.invitations.createIndex({ sessionId: 1 }, { unique: true, sparse: true }),
    c.sessions.createIndex({ invitationId: 1 }, { unique: true, sparse: true }),
    c.sessions.createIndex({ studyRunId: 1, presentationVariant: 1, status: 1, validityFlag: 1 })
  ]);
}
