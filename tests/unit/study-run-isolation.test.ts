import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PresentationProfileRepository } from '@/lib/repositories/presentation-profile.repository';
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

// The only files allowed to know about Study Runs / invitations / presentation profiles / quota (P1 + P2 + P3 + P4).
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
  'src/lib/services/run-overview.service.ts',
  'src/app/api/invitations/redeem/route.ts',
  'src/app/i/page.tsx',
  'src/components/participant/InvitationEntry.tsx',
  // P3: V2 presentation profile and reading display for Study Run sessions
  'src/types/presentation-profile.ts',
  'src/lib/study-run/presentation-profile.ts',
  'src/lib/study-run/presentation-blocks.ts',
  'src/lib/validation/presentation-profile-schemas.ts',
  'src/lib/repositories/presentation-profile.repository.ts',
  'src/lib/services/presentation-profile.service.ts',
  'src/components/participant/ExperimentalText.tsx',
  'src/app/experiment/reading/page.tsx',
  'src/lib/services/reading.service.ts',
  // P4: single-round completion, participant UI, run-session validity checklist, and quota recording service
  'src/lib/services/study-run-quota.service.ts',
  'src/lib/repositories/research.repository.ts',
  'src/app/api/test/submit/route.ts',
  'src/app/experiment/review/page.tsx',
  'src/app/experiment/test/page.tsx',
  'src/lib/services/validity.service.ts',
  'src/lib/services/validity-review.service.ts',
  // P5: admin-only Study Run management (pages, admin APIs, components, variant lock) and run/variant export columns.
  // None of these is part of the participant flow; the legacy core is verified clean by the next test.
  'src/app/admin/(protected)/study-runs/page.tsx',
  'src/app/admin/(protected)/invitations/page.tsx',
  'src/app/admin/(protected)/questions/page.tsx',
  'src/app/admin/(protected)/sessions/page.tsx',
  'src/app/admin/(protected)/sessions/[id]/page.tsx',
  'src/app/admin/(protected)/statistics/page.tsx',
  'src/app/admin/(protected)/exports/page.tsx',
  'src/app/api/admin/study-runs/route.ts',
  'src/app/api/admin/study-runs/[id]/route.ts',
  'src/app/api/admin/invitations/route.ts',
  'src/app/api/admin/variant-locks/route.ts',
  'src/components/admin/AdminSidebar.tsx',
  'src/components/admin/StudyRunManager.tsx',
  'src/components/admin/InvitationManager.tsx',
  'src/components/admin/QuestionManager.tsx',
  'src/lib/services/variant-lock.service.ts',
  'src/lib/services/export.service.ts',
  'src/lib/services/export-request.service.ts',
  'src/lib/services/research-filters.ts',
  'src/lib/services/analysis.service.ts',
  'src/lib/http.ts',
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
  it('legacy session creation, state machine, scoring and participant cookie are untouched', () => {
    for (const file of [
      'src/lib/services/session.service.ts',
      'src/lib/services/state.service.ts',
      'src/lib/services/scoring.service.ts',
      'src/lib/auth/participant-session.ts',
      'src/lib/auth/participant-guard.ts',
      'src/lib/services/assignment.service.ts',
      // Shared question contract and legacy scoring/analysis/validation must never depend on Study Run code or wording.
      'src/lib/questions/question-spec.ts',
      'src/lib/services/analysis.service.ts',
      'src/lib/services/question.service.ts',
      'src/lib/validation/schemas.ts'
    ]) {
      expect(/study[-_ ]?run|studyRun|invitation|presentationProfile/i.test(readFileSync(path.resolve(process.cwd(), file), 'utf8'))).toBe(false);
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
  it('reading, review and test pages and ReadingService branch only on session.studyRunId while preserving legacy 2-round UI', () => {
    const page = readFileSync(path.resolve(process.cwd(), 'src/app/experiment/reading/page.tsx'), 'utf8');
    expect(page.includes('presentationForRound(session.groupCode!, roundNo)')).toBe(true);
    expect(page.includes('session.studyRunId')).toBe(true);
    const reviewPage = readFileSync(path.resolve(process.cwd(), 'src/app/experiment/review/page.tsx'), 'utf8');
    expect(reviewPage.includes('session.studyRunId')).toBe(true);
    expect(reviewPage.includes('Trước phần câu hỏi — lượt')).toBe(true);
    const testPage = readFileSync(path.resolve(process.cwd(), 'src/app/experiment/test/page.tsx'), 'utf8');
    expect(testPage.includes('session.studyRunId')).toBe(true);
    expect(testPage.includes('Câu hỏi — lượt')).toBe(true);
    const readingService = readFileSync(path.resolve(process.cwd(), 'src/lib/services/reading.service.ts'), 'utf8');
    expect(readingService.includes('presentationForRound(session.groupCode, roundNo)')).toBe(true);
    expect(readingService.includes('session.studyRunId')).toBe(true);
  });
  it('P4 single-round and validity integration points preserve completeSessionIfReady and checkValidity for legacy sessions', () => {
    const repo = readFileSync(path.resolve(process.cwd(), 'src/lib/repositories/research.repository.ts'), 'utf8');
    expect(repo.includes('async completeSessionIfReady(id: string)')).toBe(true);
    expect(repo.includes("currentStage: 'TEST_2', status: 'ACTIVE'")).toBe(true);
    expect(repo.includes('async completeRunSessionIfReady(id: string)')).toBe(true);
    const submit = readFileSync(path.resolve(process.cwd(), 'src/app/api/test/submit/route.ts'), 'utf8');
    expect(submit.includes('if (existingSession.studyRunId)')).toBe(true);
    expect(submit.includes('repo.completeRunSessionIfReady(id)')).toBe(true);
    expect(submit.includes('repo.completeSessionIfReady(id)')).toBe(true);
    const validity = readFileSync(path.resolve(process.cwd(), 'src/lib/services/validity.service.ts'), 'utf8');
    expect(validity.includes('export function checkValidity(')).toBe(true);
    expect(validity.includes('export function checkRunSessionValidity(')).toBe(true);
    const review = readFileSync(path.resolve(process.cwd(), 'src/lib/services/validity-review.service.ts'), 'utf8');
    expect(review.includes('if (bundle.session.studyRunId)')).toBe(true);
    expect(review.includes('checkRunSessionValidity(')).toBe(true);
    expect(review.includes('checkValidity(')).toBe(true);
  });
  it('the Study Run repository has no general update (only CAS admin update, the P2 lock, the legacy-entry lookup and the narrow P4 quota counter CAS)', () => {
    const methods = Object.getOwnPropertyNames(StudyRunRepository.prototype).filter((m) => m !== 'constructor').sort();
    expect(methods).toEqual([
      'applyQuotaCounterTransition',
      'getById',
      'hasOpenRunBlockingLegacyEntry',
      'insert',
      'list',
      'lockIfUnlocked',
      'updateIfVersion'
    ]);
    for (const forbidden of ['arms', 'snapshot', 'code', 'locked', 'version', 'createdBy', 'createdAt', '_id']) {
      expect((STUDY_RUN_ADMIN_WRITABLE_FIELDS as readonly string[]).includes(forbidden)).toBe(false);
    }
  });
  it('the PresentationProfile repository exposes only narrow read and CAS methods (no general update, no mutation of LOCKED profiles)', () => {
    const methods = Object.getOwnPropertyNames(PresentationProfileRepository.prototype).filter((m) => m !== 'constructor').sort();
    expect(methods).toEqual([
      'confirmIfPreviewed',
      'getByContentAndVersion',
      'getById',
      'insert',
      'listByContent',
      'lockIfConfirmed',
      'markPreviewedIfEditable',
      'nextVersion',
      'updateIfEditable'
    ]);
  });
  it('a stray field (e.g. arms) never reaches the database layer', async () => {
    let message = '';
    try { await new StudyRunRepository().updateIfVersion(new ObjectId(), 1, { arms: {} } as never); } catch (error) { message = (error as Error).message; }
    expect(message).toBe('STUDY_RUN_FIELD_NOT_WRITABLE');
  });
});
