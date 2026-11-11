import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { StudyRunRepository, STUDY_RUN_ADMIN_WRITABLE_FIELDS } from '@/lib/repositories/study-run.repository';
import { ObjectId } from 'mongodb';

const srcRoot = path.resolve(process.cwd(), 'src');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const rel = (file: string) => path.relative(process.cwd(), file).split(path.sep).join('/');

// The only files allowed to know about Study Runs / invitations (P1 + P2). Anything else (legacy routes, pages, services, cookies) must not.
const ALLOWED = new Set([
  'src/types/study-run.ts',
  'src/lib/study-run/capabilities.ts',
  'src/lib/study-run/errors.ts',
  'src/lib/study-run/info-consent.ts',
  'src/lib/study-run/quota.ts',
  'src/lib/validation/study-run-schemas.ts',
  'src/lib/repositories/study-run.repository.ts',
  'src/lib/services/study-run.service.ts',
  'src/lib/db/collections.ts',
  'src/lib/db/indexes.ts',
  // P2: new participant entry and invitation code
  'src/types/invitation.ts',
  'src/lib/study-run/invitation-token.ts',
  'src/lib/study-run/legacy-entry.ts',
  'src/lib/study-run/redeem-handler.ts',
  'src/lib/validation/invitation-schemas.ts',
  'src/lib/repositories/invitation.repository.ts',
  'src/lib/services/invitation.service.ts',
  'src/lib/services/invitation-redemption.service.ts',
  'src/lib/services/run-session.service.ts',
  'src/app/api/invitations/redeem/route.ts',
  'src/app/i/page.tsx',
  'src/components/participant/InvitationEntry.tsx',
  // P2: the specified integration points in existing files (each checked individually below)
  'src/app/api/session/route.ts',
  'src/app/api/demographics/route.ts',
  'src/types/research.ts',
  'src/proxy.ts'
]);

describe('Study Run isolation: legacy flow only touches the specified integration points', () => {
  it('no other source file (legacy routes, pages, services, cookies, state machine) references Study Run or invitations', () => {
    const offenders = walk(srcRoot)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !ALLOWED.has(rel(f)))
      .filter((f) => /study[-_ ]?run|studyRun|invitation|presentationVariant|entryMode/i.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
  it('legacy session creation, state machine and participant cookie are untouched', () => {
    for (const file of ['src/lib/services/session.service.ts', 'src/lib/services/state.service.ts', 'src/lib/auth/participant-session.ts', 'src/lib/auth/participant-guard.ts', 'src/lib/services/assignment.service.ts']) {
      expect(/study[-_ ]?run|studyRun|invitation/i.test(readFileSync(path.resolve(process.cwd(), file), 'utf8'))).toBe(false);
    }
  });
  it('/api/session only gains the legacy-entry check; /api/demographics only skips A/B assignment for run sessions', () => {
    const session = readFileSync(path.resolve(process.cwd(), 'src/app/api/session/route.ts'), 'utf8');
    expect(session.includes("from '@/lib/study-run/legacy-entry'")).toBe(true);
    expect(/study[-_ ]?run|invitation/i.test(session.replace(/^import .*legacy-entry.*$/m, '').replace(/\/\/.*$/gm, '').replace(/isLegacyEntryBlocked/g, ''))).toBe(false);
    const demographics = readFileSync(path.resolve(process.cwd(), 'src/app/api/demographics/route.ts'), 'utf8');
    expect(demographics.includes('session.studyRunId')).toBe(true);
    expect(/invitation|study_runs/i.test(demographics)).toBe(false);
  });
  it('the Study Run repository has no general update and no counter write (only CAS update, the P2 lock and the legacy-entry lookup)', () => {
    const methods = Object.getOwnPropertyNames(StudyRunRepository.prototype).filter((m) => m !== 'constructor').sort();
    expect(methods).toEqual(['getById', 'hasOpenRunBlockingLegacyEntry', 'insert', 'list', 'lockIfUnlocked', 'updateIfVersion']);
    for (const forbidden of ['arms', 'snapshot', 'code', 'locked', 'version', 'createdBy', 'createdAt', '_id']) {
      expect((STUDY_RUN_ADMIN_WRITABLE_FIELDS as readonly string[]).includes(forbidden)).toBe(false);
    }
  });
  it('a stray field (e.g. arms) never reaches the database layer', async () => {
    let message = '';
    try { await new StudyRunRepository().updateIfVersion(new ObjectId(), 1, { arms: {} } as never); } catch (error) { message = (error as Error).message; }
    expect(message).toBe('STUDY_RUN_FIELD_NOT_WRITABLE');
  });
});
