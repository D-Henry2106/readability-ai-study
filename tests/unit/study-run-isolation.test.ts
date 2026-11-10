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

// The only files allowed to know about Study Runs in P1 (AC-03 clause 1, AC-23, AC-27: no participant path, no /api/session).
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
  'src/lib/db/indexes.ts'
]);

describe('P1 isolation: Study Run code is not reachable from participant flow or /api/session', () => {
  it('no other source file (routes, pages, participant services, sessions, cookies) references Study Run', () => {
    const offenders = walk(srcRoot)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !ALLOWED.has(rel(f)))
      .filter((f) => /study[-_ ]?run|studyRun|invitation|presentationVariant|entryMode/i.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
  it('/api/session and the session model are untouched by Study Run', () => {
    for (const file of ['src/app/api/session/route.ts', 'src/lib/services/session.service.ts', 'src/types/research.ts', 'src/lib/auth/participant-session.ts']) {
      expect(/study[-_ ]?run|studyRun|invitation/i.test(readFileSync(path.resolve(process.cwd(), file), 'utf8'))).toBe(false);
    }
  });
  it('the repository exposes only insert, getById, list and a compare-and-set update (no general update, no counter write)', () => {
    const methods = Object.getOwnPropertyNames(StudyRunRepository.prototype).filter((m) => m !== 'constructor').sort();
    expect(methods).toEqual(['getById', 'insert', 'list', 'updateIfVersion']);
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
