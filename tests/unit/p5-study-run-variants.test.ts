import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { DEVICE, expectCode, makeRedeemHarness } from '../helpers/invitation-fakes';
import { expectStudyRunError, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';
import { makeQuestions } from '../helpers/question-fixtures';
import { VariantLockService } from '@/lib/services/variant-lock.service';

type Harness = ReturnType<typeof makeRedeemHarness>;
const redeem = (h: Harness, token: string, cookieSessionId: string | null = null) => h.redemption().redeem({ token, deviceType: DEVICE, cookieSessionId });
const questionSet = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), revision: 9, label: 'Second set', phase: 'MAIN', questions: makeQuestions(), status: 'PUBLISHED', locked: true,
  createdAt: new Date(0), publishedAt: new Date(0), ...over
});
const addSet = (h: Harness, doc: ReturnType<typeof questionSet>) => { h.state.extraQuestionSets.set(doc._id.toHexString(), doc); return doc._id.toHexString(); };
const create = (h: Harness, questionSetId?: string) => h.service.create(RESEARCHER, {
  code: `RUN-${Math.random().toString(36).slice(2, 8)}`, name: 'r', phase: 'MAIN', packageId: h.packageId.toHexString(), targetSampleSize: 30, ...(questionSetId ? { questionSetId } : {})
});

describe('P5: a Study Run snapshots ONE 15-question set for both V1 and V2', () => {
  it('defaults to the package question set and records its revision', async () => {
    const h = makeRedeemHarness();
    const { run } = await create(h);
    expect(run.snapshot.questionSetId.equals(h.questionSetId)).toBe(true);
    expect(run.snapshot.questionSetRevision).toBe(7);
  });
  it('can use another PUBLISHED 15-question set chosen by the Admin', async () => {
    const h = makeRedeemHarness();
    const id = addSet(h, questionSet());
    const { run } = await create(h, id);
    expect(run.snapshot.questionSetId.toHexString()).toBe(id);
    expect(run.snapshot.questionSetRevision).toBe(9);
  });
  it('refuses a draft, an archived, a wrong-phase and an old 5-question set, and says why', async () => {
    const h = makeRedeemHarness();
    const draft = addSet(h, questionSet({ status: 'DRAFT', locked: false }));
    const archived = addSet(h, questionSet({ archivedAt: new Date() }));
    const pilot = addSet(h, questionSet({ phase: 'PILOT' }));
    const legacy = addSet(h, questionSet({ questions: makeQuestions(5) }));
    expect(await expectStudyRunError(create(h, draft), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409)).toContain('QUESTIONS_NOT_PUBLISHED');
    expect(await expectStudyRunError(create(h, archived), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409)).toContain('QUESTIONS_ARCHIVED');
    expect(await expectStudyRunError(create(h, pilot), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409)).toContain('QUESTIONS_PHASE_MISMATCH');
    expect(await expectStudyRunError(create(h, legacy), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409)).toContain('INVALID_QUESTIONS');
    expect(await expectStudyRunError(create(h, new ObjectId().toHexString()), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409)).toContain('QUESTIONS_NOT_FOUND');
  });
  it('V1 and V2 invitations of one run pin the SAME set and revision, and so do their sessions', async () => {
    const h = makeRedeemHarness();
    const id = addSet(h, questionSet());
    const { runId } = await h.openRun({ questionSetId: id });
    const [v1] = await h.issue(runId, 'V1');
    const [v2] = await h.issue(runId, 'V2');
    for (const issued of [v1, v2]) {
      const stored = h.invitations.docs.get(issued.invitationId)!;
      expect(stored.questionSetId!.toHexString()).toBe(id);
      expect(stored.questionSetRevision).toBe(9);
      expect(JSON.stringify(stored)).not.toContain(issued.token);
    }
    const s1 = h.sessions.get((await redeem(h, v1.token)).sessionId)!;
    const s2 = h.sessions.get((await redeem(h, v2.token)).sessionId)!;
    expect([s1.presentationVariant, s2.presentationVariant]).toEqual(['V1', 'V2']);
    for (const s of [s1, s2]) { expect(s.questionSetId.toHexString()).toBe(id); expect(s.questionSetRevision).toBe(9); }
  });
  it('an invitation issued before P5 (no pin) falls back to the run snapshot', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a] = await h.issue(runId, 'V1');
    const stored = h.invitations.docs.get(a.invitationId)!;
    delete stored.questionSetId; delete stored.questionSetRevision;
    const session = h.sessions.get((await redeem(h, a.token)).sessionId)!;
    expect(session.questionSetId.equals(h.questionSetId)).toBe(true);
    expect(session.questionSetRevision).toBe(7);
  });
});

describe('P5-D: independent V1 / V2 lock, enforced by the backend', () => {
  it('locking V1 blocks issuing and redeeming V1 only; V2 is untouched; unlocking restores V1', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [unusedV1] = await h.issue(runId, 'V1');
    const [unusedV2] = await h.issue(runId, 'V2');
    const locks = new VariantLockService(h.variantLocks, h.deps.audit!, () => h.clock.now);
    await locks.set(RESEARCHER, 'V1', true);

    await expectStudyRunError(h.admin.create(RESEARCHER, { studyRunId: runId, variant: 'V1', count: 1 }), 'VARIANT_LOCKED', 409);
    await expectCode(redeem(h, unusedV1.token), 'INVITATION_UNAVAILABLE', 404);
    expect(h.invitations.docs.get(unusedV1.invitationId)!.status).toBe('ISSUED'); // not consumed
    expect((await h.issue(runId, 'V2')).length).toBe(1);
    expect((await redeem(h, unusedV2.token)).outcome).toBe('CREATED');

    await locks.set(RESEARCHER, 'V1', false);
    expect((await redeem(h, unusedV1.token)).outcome).toBe('CREATED');
    expect((await h.issue(runId, 'V1')).length).toBe(1);
  });
  it('a participant who already started keeps working: resume and recovery never read the lock', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a] = await h.issue(runId, 'V1');
    const started = await redeem(h, a.token);
    await new VariantLockService(h.variantLocks, h.deps.audit!, () => h.clock.now).set(RESEARCHER, 'V1', true);
    h.variantLocks.getVariantLocks = async () => { throw new Error('lock must not be consulted for a started session'); };
    const resumed = await redeem(h, a.token, started.sessionId);
    expect(resumed.outcome).toBe('RESUMED');
    expect(h.sessions.get(started.sessionId)!.status).toBe('ACTIVE');
  });
  it('records who and when, never deletes anything, and only a RESEARCHER may change it', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a] = await h.issue(runId, 'V1');
    const started = await redeem(h, a.token);
    const locks = new VariantLockService(h.variantLocks, h.deps.audit!, () => new Date('2026-11-11T10:00:00Z'));
    const result = await locks.set(RESEARCHER, 'V2', true);
    expect(result.locks.V2).toMatchObject({ locked: true, changedBy: 'researcher' });
    expect(result.locks.V2.changedAt!.toISOString()).toBe('2026-11-11T10:00:00.000Z');
    expect(result.locks.V1.locked).toBe(false);
    expect(h.audits.some((x) => x.action === 'VARIANT_LOCKED' && x.metadata?.variant === 'V2')).toBe(true);
    expect(h.sessions.has(started.sessionId)).toBe(true);
    expect(h.invitations.docs.size).toBe(1);
    await expect(locks.set(SUPERVISOR, 'V1', true)).rejects.toThrow('FORBIDDEN');
  });
});

describe('P5-A: sessions in the same browser', () => {
  it('a WITHDRAWN or COMPLETED cookie session never counts as ACTIVE and its data is kept', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b, c] = await h.issue(runId, 'V1', 3);
    const first = await redeem(h, a.token);
    h.sessions.get(first.sessionId)!.status = 'WITHDRAWN';
    const second = await redeem(h, b.token, first.sessionId);
    expect(second.outcome).toBe('CREATED');
    h.sessions.get(second.sessionId)!.status = 'COMPLETED';
    expect((await redeem(h, c.token, second.sessionId)).outcome).toBe('CREATED');
    expect(h.sessions.get(first.sessionId)!.status).toBe('WITHDRAWN');
    expect(h.sessions.get(second.sessionId)!.status).toBe('COMPLETED');
    expect([a, b, c].map((x) => h.invitations.docs.get(x.invitationId)!.status)).toEqual(['REDEEMED', 'REDEEMED', 'REDEEMED']);
  });
});
