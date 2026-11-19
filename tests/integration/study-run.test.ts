import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjectId } from 'mongodb';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ALL_CAPABILITIES, expectStudyRunError, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { StudyRunService } from '@/lib/services/study-run.service';
import { SessionService } from '@/lib/services/session.service';
import { sha256Hex } from '@/lib/study-run/info-consent';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';

const service = () => new StudyRunService({ capabilities: ALL_CAPABILITIES });
const profiles = () => new PresentationProfileService();
let packageId: string;
let contentId: string;
let questionSetId: string;
const input = (over: Record<string, unknown> = {}) => ({ code: 'run-01', name: 'Run 01', phase: 'MAIN', packageId, questionSetId, targetSampleSize: 30, ...over });
const runs = () => withTestDb((db) => db.collection('study_runs').find({}).toArray());
const audits = () => withTestDb((db) => db.collection('admin_audit').find({ targetType: 'study_run' }).sort({ createdAt: 1 }).toArray());
const hex = (id?: ObjectId) => id!.toHexString();

async function confirmAndBindProfile(runId: string, expectedVersion: number): Promise<number> {
  const { profile } = await profiles().create(RESEARCHER, { contentRevisionId: contentId });
  const pid = hex(profile._id);
  await profiles().preview(RESEARCHER, pid);
  await profiles().confirm(RESEARCHER, pid);
  return (await service().confirmPresentationProfile(RESEARCHER, runId, { expectedVersion, profileId: pid })).run.version;
}

describe('Study Run core on a real MongoDB (P1)', () => {
  beforeEach(async () => {
    const seeded = await resetAndSeedReady();
    contentId = String(seeded.contentId);
    questionSetId = String(seeded.questionSetId);
    packageId = String((await withTestDb((db) => db.collection('content_packages').findOne({ code: 'FIXTURE_MAIN' })))!._id);
  });

  it('creates the run with counters at 0, no stored quota, and the unique code index rejects duplicates', async () => {
    const { run } = await service().create(RESEARCHER, input());
    const [stored] = await runs();
    expect(stored.status).toBe('DRAFT');
    expect(stored.arms).toEqual({ V1: { validIncluded: 0, supplementalValid: 0 }, V2: { validIncluded: 0, supplementalValid: 0 } });
    expect(stored.quotaPerArm).toBeNull();
    expect(stored.version).toBe(1);
    expect(String(stored.snapshot.packageId)).toBe(packageId);
    const indexes = await withTestDb((db) => db.collection('study_runs').indexes());
    expect(indexes.some((i) => i.unique === true && i.key.code === 1)).toBe(true);
    expect(indexes.some((i) => i.key.status === 1)).toBe(true);
    await expectStudyRunError(service().create(RESEARCHER, input()), 'STUDY_RUN_CODE_EXISTS', 409);
    expect(await runs()).toHaveLength(1);
    expect(run.code).toBe('RUN-01');
  });

  it('AC-02: SUPERVISOR is FORBIDDEN on writes and the database (runs and audit) is unchanged', async () => {
    const { run } = await service().create(RESEARCHER, input());
    const before = JSON.stringify([await runs(), await audits()]);
    await expectStudyRunError(service().create(SUPERVISOR, input({ code: 'other' })), 'FORBIDDEN');
    await expectStudyRunError(service().confirmQuota(SUPERVISOR, hex(run._id), { expectedVersion: 1, quotaPerArm: 15 }), 'FORBIDDEN');
    await expectStudyRunError(service().transition(SUPERVISOR, hex(run._id), { expectedVersion: 1, to: 'OPEN' }), 'FORBIDDEN');
    expect(JSON.stringify([await runs(), await audits()])).toBe(before);
    expect((await service().get(SUPERVISOR, hex(run._id))).code).toBe('RUN-01');
  });

  it('AC-02: two concurrent writes with the same expectedVersion -> exactly one wins, the other gets 409', async () => {
    const { run } = await service().create(RESEARCHER, input());
    const attempts = await Promise.allSettled([
      service().confirmQuota(RESEARCHER, hex(run._id), { expectedVersion: 1, quotaPerArm: 15 }),
      service().confirmEntryPolicy(RESEARCHER, hex(run._id), { expectedVersion: 1, legacyEntry: 'UNCHANGED' })
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { code: string; status: number }).code).toBe('STUDY_RUN_VERSION_CONFLICT');
    expect((rejected[0].reason as { status: number }).status).toBe(409);
    expect((await runs())[0].version).toBe(2);
  });

  it('AC-01: quota is stored only after confirmation; changing the sample size resets it; arms stay 0', async () => {
    const { run } = await service().create(RESEARCHER, input());
    const confirmed = await service().confirmQuota(RESEARCHER, hex(run._id), { expectedVersion: 1, quotaPerArm: 15 });
    expect((await runs())[0].quotaPerArm).toBe(15);
    await service().updateSampleSize(RESEARCHER, hex(run._id), { expectedVersion: confirmed.run.version, targetSampleSize: 40 });
    const [stored] = await runs();
    expect(stored.targetSampleSize).toBe(40);
    expect(stored.quotaPerArm).toBeNull();
    expect(stored.arms.V1.validIncluded + stored.arms.V2.validIncluded + stored.arms.V1.supplementalValid + stored.arms.V2.supplementalValid).toBe(0);
  });

  it('AC-01: sample size cannot drop below validIncluded (atomic guard, state unchanged)', async () => {
    const { run } = await service().create(RESEARCHER, input());
    await withTestDb((db) => db.collection('study_runs').updateOne({ _id: run._id }, { $set: { 'arms.V1.validIncluded': 8 } }));
    await expectStudyRunError(service().updateSampleSize(RESEARCHER, hex(run._id), { expectedVersion: 1, targetSampleSize: 14 }), 'STUDY_RUN_SAMPLE_SIZE_BELOW_VALID_INCLUDED', 409);
    const [stored] = await runs();
    expect(stored.targetSampleSize).toBe(30);
    expect(stored.version).toBe(1);
    await service().updateSampleSize(RESEARCHER, hex(run._id), { expectedVersion: 1, targetSampleSize: 16 });
    expect((await runs())[0].targetSampleSize).toBe(16);
  });

  it('AC-26: stores who/when/versions/SHA-256, audits, and leaves the configuration texts untouched', async () => {
    const { run } = await service().create(RESEARCHER, input());
    const configBefore = JSON.stringify(await withTestDb((db) => db.collection('experiment_config').findOne({ key: 'active' })));
    await service().confirmInfoConsentReview(RESEARCHER, hex(run._id), { expectedVersion: 1, statement: INFO_CONSENT_REVIEW_STATEMENT });
    const [stored] = await runs();
    expect(stored.infoConsentReview.confirmedBy).toBe('researcher');
    expect(stored.infoConsentReview.informationVersion).toBe('test-info-v1');
    expect(stored.infoConsentReview.informationSha256).toBe(sha256Hex('Fixture participant information.'));
    expect(stored.infoConsentReview.consentSha256).toBe(sha256Hex('Fixture consent text for automated testing.'));
    expect(stored.infoConsentReview.debriefSha256).toBe(sha256Hex('Fixture debrief text.'));
    expect(JSON.stringify(await withTestDb((db) => db.collection('experiment_config').findOne({ key: 'active' })))).toBe(configBefore);
    expect((await audits()).map((a) => a.action)).toEqual(['STUDY_RUN_CREATED', 'STUDY_RUN_INFO_CONSENT_REVIEWED']);
    // editing the consent text afterwards only produces a warning state
    await withTestDb((db) => db.collection('experiment_config').updateOne({ key: 'active' }, { $set: { consentText: 'Edited consent.' } }));
    expect(await service().infoConsentState(RESEARCHER, hex(run._id))).toBe('CHANGED');
    expect((await runs())[0].status).toBe('DRAFT');
  });

  it('AC-27: full lifecycle with production capabilities (all four true in P4); missing capabilities still refuse OPEN', async () => {
    const { run } = await service().create(RESEARCHER, input());
    let v = (await service().confirmQuota(RESEARCHER, hex(run._id), { expectedVersion: 1, quotaPerArm: 15 })).run.version;
    v = (await service().confirmEntryPolicy(RESEARCHER, hex(run._id), { expectedVersion: v, legacyEntry: 'BLOCKED_WHILE_OPEN' })).run.version;
    v = (await service().confirmInfoConsentReview(RESEARCHER, hex(run._id), { expectedVersion: v, statement: INFO_CONSENT_REVIEW_STATEMENT })).run.version;
    v = await confirmAndBindProfile(hex(run._id), v);
    const gated = new StudyRunService({
      capabilities: { ...ALL_CAPABILITIES, singleRoundFlow: false, quotaRecording: false }
    });
    const details = await expectStudyRunError(gated.transition(RESEARCHER, hex(run._id), { expectedVersion: v, to: 'OPEN' }), 'STUDY_RUN_NOT_READY', 409);
    expect(details).toContain('CAPABILITY:singleRoundFlow');
    expect(details).toContain('CAPABILITY:quotaRecording');
    expect(details.includes('CAPABILITY:invitationRedemption')).toBe(false);
    expect(details.includes('CAPABILITY:presentationProfile')).toBe(false);
    expect((await runs())[0].status).toBe('DRAFT');
    const production = new StudyRunService();
    const opened = await production.transition(RESEARCHER, hex(run._id), { expectedVersion: v, to: 'OPEN' });
    const paused = await production.transition(RESEARCHER, hex(run._id), { expectedVersion: opened.run.version, to: 'PAUSED' });
    const closed = await production.transition(RESEARCHER, hex(run._id), { expectedVersion: paused.run.version, to: 'CLOSED' });
    await production.transition(RESEARCHER, hex(run._id), { expectedVersion: closed.run.version, to: 'OPEN', reason: 'recruit more' });
    expect((await runs())[0].status).toBe('OPEN');
    expect((await audits()).filter((a) => a.action === 'STUDY_RUN_STATUS_CHANGED')).toHaveLength(4);
  });

  it('AC-27 / AC-23: an OPEN run with BLOCKED_WHILE_OPEN does not change the legacy SessionService.create path', async () => {
    const { run } = await service().create(RESEARCHER, input());
    let v = (await service().confirmQuota(RESEARCHER, hex(run._id), { expectedVersion: 1, quotaPerArm: 15 })).run.version;
    v = (await service().confirmEntryPolicy(RESEARCHER, hex(run._id), { expectedVersion: v, legacyEntry: 'BLOCKED_WHILE_OPEN' })).run.version;
    v = (await service().confirmInfoConsentReview(RESEARCHER, hex(run._id), { expectedVersion: v, statement: INFO_CONSENT_REVIEW_STATEMENT })).run.version;
    v = await confirmAndBindProfile(hex(run._id), v);
    await service().transition(RESEARCHER, hex(run._id), { expectedVersion: v, to: 'OPEN' });
    expect((await runs())[0].status).toBe('OPEN');
    // SessionService.create is what creates legacy sessions; it must still create a normal legacy session.
    const session = await new SessionService().create('desktop');
    expect(session.currentStage).toBe('INFORMATION');
    expect(session.groupCode).toBeNull();
    const stored = await withTestDb((db) => db.collection('sessions').findOne({ id: session.id }));
    expect(Object.keys(stored!).filter((k) => /studyRun|invitation|presentationVariant|quotaStatus/.test(k))).toEqual([]);
  });
});
