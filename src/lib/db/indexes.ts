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
    c.experimentConfig.createIndex({ key: 1 }, { unique: true })
  ]);
}
