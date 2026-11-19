import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ALL_CAPABILITIES, RESEARCHER } from '../helpers/study-run-fakes';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { StudyRunService } from '@/lib/services/study-run.service';
import { InvitationService } from '@/lib/services/invitation.service';
import { InvitationRedemptionService, REDEEM_IN_FLIGHT_MS } from '@/lib/services/invitation-redemption.service';
import { InvitationRedemptionRepository } from '@/lib/repositories/invitation.repository';
import { StudyRunRepository } from '@/lib/repositories/study-run.repository';
import { SessionService } from '@/lib/services/session.service';
import { isLegacyEntryBlocked } from '@/lib/study-run/legacy-entry';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';

const cookie = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/auth/participant-session', () => ({
  getParticipantSessionId: async () => cookie.id,
  setParticipantSessionId: async (id: string) => { cookie.id = id; },
  clearParticipantSession: async () => { cookie.id = null; }
}));

const runs = () => new StudyRunService({ capabilities: ALL_CAPABILITIES });
const profiles = () => new PresentationProfileService();
const admin = () => new InvitationService({ baseUrl: () => 'https://study.example' });
const redeem = (token: string, cookieSessionId: string | null = null) => new InvitationRedemptionService().redeem({ token, deviceType: 'desktop', cookieSessionId });

async function openRun(legacyEntry: 'UNCHANGED' | 'BLOCKED_WHILE_OPEN' = 'UNCHANGED'): Promise<string> {
  const pkg = (await withTestDb((db) => db.collection('content_packages').findOne({ code: 'FIXTURE_MAIN' })))!;
  let run = (await runs().create(RESEARCHER, { code: 'run-01', name: 'Run 01', phase: 'MAIN', packageId: String(pkg._id), targetSampleSize: 30 })).run;
  const id = String(run._id);
  run = (await runs().confirmQuota(RESEARCHER, id, { expectedVersion: run.version, quotaPerArm: 15 })).run;
  run = (await runs().confirmEntryPolicy(RESEARCHER, id, { expectedVersion: run.version, legacyEntry })).run;
  run = (await runs().confirmInfoConsentReview(RESEARCHER, id, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
  const existingProfile = await withTestDb((db) =>
    db.collection('presentation_profiles').findOne({ contentRevisionId: pkg.contentRevisionId, status: { $in: ['CONFIRMED', 'LOCKED'] } })
  );
  let profileId = existingProfile ? String(existingProfile._id) : '';
  if (!profileId) {
    const created = await profiles().create(RESEARCHER, { contentRevisionId: String(pkg.contentRevisionId) });
    profileId = String(created.profile._id);
    await profiles().preview(RESEARCHER, profileId);
    await profiles().confirm(RESEARCHER, profileId);
  }
  run = (await runs().confirmPresentationProfile(RESEARCHER, id, { expectedVersion: run.version, profileId })).run;
  await runs().transition(RESEARCHER, id, { expectedVersion: run.version, to: 'OPEN' });
  return id;
}
const issue = async (runId: string, variant: 'V1' | 'V2' = 'V1', count = 1) => (await admin().create(RESEARCHER, { studyRunId: runId, variant, count })).issued;
const sessionsOf = () => withTestDb((db) => db.collection('sessions').find({ studyRunId: { $exists: true } }).toArray());

describe('Invitations and participant entry on a real MongoDB (P2)', () => {
  beforeEach(async () => { cookie.id = null; await resetAndSeedReady(); });

  it('creates the P2 indexes (unique token hash, one session per invitation)', async () => {
    const inv = await withTestDb((db) => db.collection('invitations').indexes());
    expect(inv.some((i) => i.unique === true && i.key.tokenHash === 1)).toBe(true);
    expect(inv.some((i) => i.unique === true && i.sparse === true && i.key.sessionId === 1)).toBe(true);
    expect(inv.some((i) => i.key.studyRunId === 1 && i.key.variant === 1 && i.key.status === 1)).toBe(true);
    const ses = await withTestDb((db) => db.collection('sessions').indexes());
    expect(ses.some((i) => i.unique === true && i.sparse === true && i.key.invitationId === 1)).toBe(true);
    expect(ses.some((i) => i.key.studyRunId === 1 && i.key.presentationVariant === 1 && i.key.status === 1 && i.key.validityFlag === 1)).toBe(true);
  });

  it('AC-04: the database (every collection, including audit) never contains the raw token', async () => {
    const runId = await openRun();
    const [inv] = await issue(runId, 'V1');
    await redeem(inv.token);
    const dump = await withTestDb(async (db) => JSON.stringify(await Promise.all((await db.listCollections().toArray()).map((c) => db.collection(c.name).find({}).toArray()))));
    expect(dump.includes(inv.token)).toBe(false);
    expect(dump.includes(inv.link)).toBe(false);
    const stored = (await withTestDb((db) => db.collection('invitations').find({}).toArray()))[0];
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.status).toBe('REDEEMED');
  });

  it('AC-05/07/10/14: 20 concurrent redeems -> one session, pinned run/invitation/variant/profile, groupCode null, run & profile locked', async () => {
    const runId = await openRun();
    const [inv] = await issue(runId, 'V2');
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => redeem(inv.token)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const sessions = await sessionsOf();
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(String(s.studyRunId)).toBe(runId);
    expect(String(s.invitationId)).toBe(inv.invitationId);
    expect(s.presentationVariant).toBe('V2');
    expect(s.presentationVersion).toBe(1);
    expect(Boolean(s.presentationProfileId)).toBe(true);
    expect(s.groupCode).toBeNull();
    expect(s.currentStage).toBe('INFORMATION');
    const stored = (await withTestDb((db) => db.collection('invitations').findOne({})))!;
    expect(stored.sessionId).toBe(s.id);
    // the run and its V2 profile are locked by the first invitation
    const lockedRun = await runs().get(RESEARCHER, runId);
    expect(lockedRun.locked).toBe(true);
    const lockedProfile = await profiles().get(RESEARCHER, String(lockedRun.presentation.V2.profileId));
    expect(lockedProfile.status).toBe('LOCKED');
  });

  it('AC-05: a claimed invitation whose session was never written is completed idempotently with the same id', async () => {
    const runId = await openRun();
    const [inv] = await issue(runId);
    const stored = (await withTestDb((db) => db.collection('invitations').findOne({})))!;
    const claimed = await new InvitationRedemptionRepository().claimIssued(stored._id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', new Date());
    expect(claimed!.status).toBe('REDEEMED');
    await expect(redeem(inv.token)).rejects.toMatchObject({ code: 'INVITATION_REDEEM_IN_PROGRESS' });
    await withTestDb((db) => db.collection('invitations').updateOne({ _id: stored._id }, { $set: { redeemedAt: new Date(Date.now() - REDEEM_IN_FLIGHT_MS - 1000) } }));
    const res = await redeem(inv.token);
    expect(res.sessionId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await sessionsOf()).toHaveLength(1);
    await expect(redeem(inv.token)).rejects.toMatchObject({ code: 'INVITATION_ALREADY_USED' });
  });

  it('AC-06/08: resume needs the cookie of that session; run PAUSED blocks unused invitations only', async () => {
    const runId = await openRun();
    const [a, b] = await issue(runId, 'V1', 2);
    const first = await redeem(a.token);
    const run = await runs().get(RESEARCHER, runId);
    await runs().transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'PAUSED' });
    expect((await redeem(a.token, first.sessionId)).outcome).toBe('RESUMED');
    await expect(redeem(a.token, null)).rejects.toMatchObject({ code: 'INVITATION_ALREADY_USED' });
    await expect(redeem(b.token, null)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    await expect(redeem(b.token, first.sessionId)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    expect(await sessionsOf()).toHaveLength(1);
  });

  it('AC-29: recovery is Admin-only, time-boxed, audited and single-use even under concurrency', async () => {
    const runId = await openRun();
    const [inv] = await issue(runId);
    await redeem(inv.token);
    await expect(admin().authorizeRecovery({ username: 'sup', role: 'SUPERVISOR' }, inv.invitationId, { confirm: true, reason: 'x', validForHours: 1 })).rejects.toThrow('FORBIDDEN');
    await admin().authorizeRecovery(RESEARCHER, inv.invitationId, { confirm: true, reason: 'lost browser', validForHours: 72 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => redeem(inv.token)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const actions = (await withTestDb((db) => db.collection('admin_audit').find({ targetType: 'invitation' }).toArray())).map((a) => a.action);
    expect(actions.filter((a) => a === 'INVITATION_RECOVERY_AUTHORIZED')).toHaveLength(1);
    expect(actions.filter((a) => a === 'INVITATION_RECOVERY_CONSUMED')).toHaveLength(1);
    expect(await sessionsOf()).toHaveLength(1);
  });

  it('AC-28: BLOCKED_WHILE_OPEN is read from the database and only while an OPEN run chose it', async () => {
    expect(await isLegacyEntryBlocked(new StudyRunRepository())).toBe(false);
    const runId = await openRun('BLOCKED_WHILE_OPEN');
    expect(await isLegacyEntryBlocked(new StudyRunRepository())).toBe(true);
    const run = await runs().get(RESEARCHER, runId);
    await runs().transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'PAUSED' });
    expect(await isLegacyEntryBlocked(new StudyRunRepository())).toBe(false);
  });

  it('AC-28: /api/session refuses a NEW legacy session only while blocked; resume and the unchanged policy still work', async () => {
    const { POST } = await import('@/app/api/session/route');
    const call = () => POST(new NextRequest('https://study.example/api/session', { method: 'POST', body: JSON.stringify({ deviceType: 'desktop' }), headers: { 'content-type': 'application/json' } }));
    const legacy = await new SessionService().create('desktop');
    const runId = await openRun('BLOCKED_WHILE_OPEN');
    cookie.id = null;
    const blocked = await call();
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe('LEGACY_ENTRY_BLOCKED');
    cookie.id = legacy.id;
    expect((await call()).status).toBe(200);                               // existing session resumes
    const run = await runs().get(RESEARCHER, runId);
    await runs().transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'CLOSED' });
    cookie.id = null;
    expect((await call()).status).toBe(200);                               // policy no longer in effect
  });

  it('AC-10: demographics does not assign A/B to a Study Run session; legacy sessions are still assigned', async () => {
    const { POST } = await import('@/app/api/demographics/route');
    const demographics = { ageRange: null, gender: null, fieldOfStudy: null, yearOfStudy: null, aiUsageFrequency: null, onlineReadingFrequency: null };
    const call = () => POST(new NextRequest('https://study.example/api/demographics', { method: 'POST', body: JSON.stringify(demographics), headers: { 'content-type': 'application/json' } }));
    const runId = await openRun();
    const [inv] = await issue(runId, 'V1');
    const run = await redeem(inv.token);
    await withTestDb((db) => db.collection('sessions').updateOne({ id: run.sessionId }, { $set: { currentStage: 'DEMOGRAPHICS' } }));
    cookie.id = run.sessionId;
    const response = await call();
    if (response.status !== 200) throw new Error(`demographics returned ${response.status}: ${await response.text()}`);
    const runSession = (await withTestDb((db) => db.collection('sessions').findOne({ id: run.sessionId })))!;
    expect(runSession.groupCode).toBeNull();
    expect(await withTestDb((db) => db.collection('experiment_events').countDocuments({ sessionId: run.sessionId, type: 'GROUP_ASSIGNED' }))).toBe(0);
    const legacy = await new SessionService().create('desktop');
    await withTestDb((db) => db.collection('sessions').updateOne({ id: legacy.id }, { $set: { currentStage: 'DEMOGRAPHICS' } }));
    cookie.id = legacy.id;
    expect((await call()).status).toBe(200);
    expect((await withTestDb((db) => db.collection('sessions').findOne({ id: legacy.id })))!.groupCode === null).toBe(false);
  });
});
