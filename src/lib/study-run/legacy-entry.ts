import { StudyRunRepository, type StudyRunStore } from '@/lib/repositories/study-run.repository';

/**
 * Legacy entry policy (architecture §3.3), enforced only by POST /api/session when it would create a NEW session.
 * Blocked only while at least one run that chose BLOCKED_WHILE_OPEN is OPEN. With no such run nothing changes.
 */
export async function isLegacyEntryBlocked(store: Pick<StudyRunStore, 'hasOpenRunBlockingLegacyEntry'> = new StudyRunRepository()): Promise<boolean> {
  return store.hasOpenRunBlockingLegacyEntry();
}
