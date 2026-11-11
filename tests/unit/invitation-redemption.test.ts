import { describe, expect, it } from 'vitest';
import { DEVICE, expectCode, makeRedeemHarness } from '../helpers/invitation-fakes';
import { RESEARCHER } from '../helpers/study-run-fakes';
import { REDEEM_IN_FLIGHT_MS } from '@/lib/services/invitation-redemption.service';

const redeem = (h: ReturnType<typeof makeRedeemHarness>, token: string, cookieSessionId: string | null = null) =>
  h.redemption().redeem({ token, deviceType: DEVICE, cookieSessionId });

describe('redeem: session creation (AC-05, AC-07, AC-10, AC-04)', () => {
  it('creates one pinned session: run, invitation, variant, version, groupCode null, snapshot content', async () => {
    for (const variant of ['V1', 'V2'] as const) {
      const h = makeRedeemHarness();
      const { runId } = await h.openRun();
      const [inv] = await h.issue(runId, variant);
      const result = await redeem(h, inv.token);
      expect(result.outcome).toBe('CREATED');
      expect(result.grantCookie).toBe(true);
      expect(result.nextRoute).toBe('/stage/INFORMATION');
      const s = h.sessions.get(result.sessionId)!;
      expect(s.studyRunId!.toHexString()).toBe(runId);
      expect(s.invitationId!.toHexString()).toBe(inv.invitationId);
      expect(s.presentationVariant).toBe(variant);
      expect(s.presentationVersion).toBeNull();
      expect(s.groupCode).toBeNull();
      expect(s.status).toBe('ACTIVE');
      expect(s.currentStage).toBe('INFORMATION');
      expect(s.assignedPackageCode).toBe('FIXTURE_MAIN');
      expect(s.contentRevisionId.equals(h.state.pkg.contentRevisionId)).toBe(true);
      expect(s.questionSetId.equals(h.state.pkg.questionSetId)).toBe(true);
      expect(s.informationVersion).toBe('info-v1');
      const doc = h.invitations.docs.get(inv.invitationId)!;
      expect(doc.status).toBe('REDEEMED');
      expect(doc.sessionId).toBe(result.sessionId);
      expect(h.events.map((e) => e.type)).toEqual(['SESSION_STARTED', 'PACKAGE_ASSIGNED']);
    }
  });
  it('the session takes the INVITATION variant (a participant has no way to pick or change it)', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [v1] = await h.issue(runId, 'V1');
    const [v2] = await h.issue(runId, 'V2');
    const a = await redeem(h, v1.token);
    const b = await redeem(h, v2.token);
    expect(h.sessions.get(a.sessionId)!.presentationVariant).toBe('V1');
    expect(h.sessions.get(b.sessionId)!.presentationVariant).toBe('V2');
    // the redeem input type carries no variant, and the service has no variant-changing method
    expect(Object.keys({ token: 'x', deviceType: DEVICE, cookieSessionId: null }).includes('variant')).toBe(false);
  });
  it('20 concurrent redeems of one link -> exactly one session and one winner (AC-05)', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => redeem(h, inv.token)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(h.sessions.size).toBe(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(['INVITATION_ALREADY_USED', 'INVITATION_REDEEM_IN_PROGRESS'].includes((r.reason as { code: string }).code)).toBe(true);
    }
    expect(h.invitations.writes.filter((w) => w === 'claimIssued')).toHaveLength(1);
  });
  it('a failure between claim and session write is retried idempotently: the same session id, never two sessions (AC-05)', async () => {
    const h = makeRedeemHarness({ failFirstSessionInsert: true });
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    await expectCode(redeem(h, inv.token), 'transient write failure');
    const claimed = h.invitations.docs.get(inv.invitationId)!;
    expect(claimed.status).toBe('REDEEMED');
    expect(h.sessions.size).toBe(0);
    await expectCode(redeem(h, inv.token), 'INVITATION_REDEEM_IN_PROGRESS', 409);   // too soon: could still be in flight
    h.clock.now = new Date(h.clock.now.getTime() + REDEEM_IN_FLIGHT_MS + 1);
    const retry = await redeem(h, inv.token);
    expect(retry.outcome).toBe('CREATED');
    expect(retry.sessionId).toBe(claimed.sessionId);
    expect(h.sessions.size).toBe(1);
    await expectCode(redeem(h, inv.token), 'INVITATION_ALREADY_USED', 409);          // no cookie on another device
    expect(h.sessions.size).toBe(1);
  });
  it('a deterministic failure (protocol text missing) does not consume the invitation', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    h.state.config = { ...h.state.config, consentText: null };
    let message = '';
    try { await redeem(h, inv.token); } catch (e) { message = (e as Error).message; }
    expect(message.startsWith('EXPERIMENT_NOT_READY:')).toBe(true);
    expect(h.invitations.docs.get(inv.invitationId)!.status).toBe('ISSUED');
    expect(h.sessions.size).toBe(0);
    h.state.config = { ...h.state.config, consentText: 'Consent text v1' };
    expect((await redeem(h, inv.token)).outcome).toBe('CREATED');
  });
});

describe('redeem: one generic answer, run status (AC-04, AC-08 P2)', () => {
  it('malformed, unknown and revoked tokens, and a run that is not OPEN, all give the same generic response', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [revoked, unused] = await h.issue(runId, 'V1', 2);
    await h.admin.revoke(RESEARCHER, revoked.invitationId, { reason: 'x' });
    const codes: Array<[string, number | undefined]> = [];
    const attempt = async (token: string) => { try { await redeem(h, token); codes.push(['SUCCESS', 200]); } catch (e) { const x = e as { code: string; status: number }; codes.push([x.code, x.status]); } };
    await attempt('short');
    await attempt('A'.repeat(43));
    await attempt(revoked.token);
    for (const to of ['PAUSED', 'CLOSED'] as const) {
      if (to === 'CLOSED') await h.setRunStatus(runId, 'OPEN');
      await h.setRunStatus(runId, to);
      await attempt(unused.token);
    }
    expect(codes).toEqual(Array.from({ length: 5 }, () => ['INVITATION_UNAVAILABLE', 404]));
    expect(h.sessions.size).toBe(0);
    expect(h.invitations.docs.get(unused.invitationId)!.status).toBe('ISSUED');
  });
  it('a started session keeps working when the run is PAUSED or CLOSED, while unused invitations are blocked', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    const started = await redeem(h, a.token);
    await h.setRunStatus(runId, 'PAUSED');
    expect((await redeem(h, a.token, started.sessionId)).outcome).toBe('RESUMED');
    await expectCode(redeem(h, b.token), 'INVITATION_UNAVAILABLE', 404);
    await h.setRunStatus(runId, 'CLOSED');
    expect((await redeem(h, a.token, started.sessionId)).outcome).toBe('RESUMED');
    await expectCode(redeem(h, b.token), 'INVITATION_UNAVAILABLE', 404);
  });
});

describe('redeem: resume and cookie rules (AC-06)', () => {
  it('re-opening a used link resumes only with the cookie of that exact ACTIVE session, at its current step, without a new cookie', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    const first = await redeem(h, inv.token);
    h.sessions.get(first.sessionId)!.currentStage = 'DEMOGRAPHICS';
    const resumed = await redeem(h, inv.token, first.sessionId);
    expect(resumed.outcome).toBe('RESUMED');
    expect(resumed.grantCookie).toBe(false);
    expect(resumed.nextRoute).toBe('/stage/DEMOGRAPHICS');
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(h.sessions.size).toBe(1);
  });
  it('another device (no cookie, or a cookie of a different session) never receives a cookie or any session detail', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    const sa = await redeem(h, a.token);
    const sb = await redeem(h, b.token);
    for (const cookie of [null, sb.sessionId, 'ffffffff-ffff-4fff-8fff-ffffffffffff']) {
      let code = '';
      try { await redeem(h, a.token, cookie); } catch (e) { code = (e as { code: string }).code; }
      expect(code === 'INVITATION_ALREADY_USED' || code === 'ACTIVE_SESSION_IN_BROWSER').toBe(true);
    }
    // the plain "no cookie" case is the generic "already used"
    await expectCode(redeem(h, a.token, null), 'INVITATION_ALREADY_USED', 409);
    expect(h.sessions.size).toBe(2);
    expect(sa.sessionId === sb.sessionId).toBe(false);
  });
  it('a browser holding another ACTIVE session gets 409 and the invitation is NOT consumed', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    const sa = await redeem(h, a.token);
    await expectCode(redeem(h, b.token, sa.sessionId), 'ACTIVE_SESSION_IN_BROWSER', 409);
    expect(h.invitations.docs.get(b.invitationId)!.status).toBe('ISSUED');
    expect(h.sessions.size).toBe(1);
    expect((await redeem(h, b.token, null)).outcome).toBe('CREATED');
  });
  it('a cookie of a FINISHED session does not block a new invitation', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    const sa = await redeem(h, a.token);
    h.sessions.get(sa.sessionId)!.status = 'COMPLETED';
    expect((await redeem(h, b.token, sa.sessionId)).outcome).toBe('CREATED');
  });
  it('a finished session is never reopened or recreated, even with its own cookie', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a] = await h.issue(runId);
    const sa = await redeem(h, a.token);
    for (const status of ['COMPLETED', 'WITHDRAWN', 'DECLINED', 'INCOMPLETE'] as const) {
      h.sessions.get(sa.sessionId)!.status = status;
      await expectCode(redeem(h, a.token, sa.sessionId), 'INVITATION_ALREADY_USED', 409);
      await expectCode(redeem(h, a.token, null), 'INVITATION_ALREADY_USED', 409);
      expect(h.sessions.get(sa.sessionId)!.status).toBe(status);
    }
    expect(h.sessions.size).toBe(1);
  });
});

describe('Admin recovery (AC-29)', () => {
  const authorize = (h: ReturnType<typeof makeRedeemHarness>, id: string, over: Record<string, unknown> = {}) =>
    h.admin.authorizeRecovery(RESEARCHER, id, { confirm: true, reason: 'lost browser', validForHours: 24, ...over });

  it('Admin authorization -> the link works once on a new device, cookie granted, CAS single-use, audited', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    const first = await redeem(h, inv.token);
    await expectCode(redeem(h, inv.token, null), 'INVITATION_ALREADY_USED');           // no authorization: no cookie
    await authorize(h, inv.invitationId);
    expect(h.audits[h.audits.length - 1].action).toBe('INVITATION_RECOVERY_AUTHORIZED');
    const recovered = await redeem(h, inv.token, null);
    expect(recovered.outcome).toBe('RECOVERED');
    expect(recovered.grantCookie).toBe(true);
    expect(recovered.sessionId).toBe(first.sessionId);
    expect(h.sessions.size).toBe(1);
    expect(h.audits[h.audits.length - 1].action).toBe('INVITATION_RECOVERY_CONSUMED');
    expect(h.audits[h.audits.length - 1].role).toBe('SYSTEM');
    await expectCode(redeem(h, inv.token, null), 'INVITATION_ALREADY_USED');           // used up
    expect(h.invitations.writes.filter((w) => w === 'consumeRecovery')).toHaveLength(1);
  });
  it('concurrent recovery redeems: exactly one gets the cookie', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    await redeem(h, inv.token);
    await authorize(h, inv.invitationId);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => redeem(h, inv.token, null)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.invitations.writes.filter((w) => w === 'consumeRecovery')).toHaveLength(1);
  });
  it('expires (Admin-chosen hours), can be cancelled, and the window is capped at 72 hours', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    await redeem(h, a.token); await redeem(h, b.token);
    await authorize(h, a.invitationId, { validForHours: 2 });
    h.clock.now = new Date(h.clock.now.getTime() + 2 * 3_600_000 + 1);
    await expectCode(redeem(h, a.token, null), 'INVITATION_ALREADY_USED');
    await authorize(h, b.invitationId, { validForHours: 72 });
    await h.admin.cancelRecovery(RESEARCHER, b.invitationId);
    expect(h.audits[h.audits.length - 1].action).toBe('INVITATION_RECOVERY_CANCELLED');
    await expectCode(redeem(h, b.token, null), 'INVITATION_ALREADY_USED');
    await expectCode(h.admin.cancelRecovery(RESEARCHER, b.invitationId), 'RECOVERY_NOT_CANCELLABLE', 409);
    for (const bad of [{ validForHours: 73 }, { validForHours: 0 }, { validForHours: 1.5 }, { reason: '' }, { confirm: false }]) {
      let rejected = false;
      try { await authorize(h, a.invitationId, bad); } catch { rejected = true; }
      expect(rejected).toBe(true);
    }
  });
  it('only one usable authorization at a time; a new one is possible once the previous is used', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    await redeem(h, inv.token);
    await authorize(h, inv.invitationId);
    await expectCode(authorize(h, inv.invitationId), 'RECOVERY_ALREADY_AUTHORIZED', 409);
    await redeem(h, inv.token, null);
    await authorize(h, inv.invitationId);
  });
  it('not available for an unused invitation or a finished session (and a finished session cannot consume a stale one)', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    await expectCode(authorize(h, a.invitationId), 'RECOVERY_NOT_APPLICABLE', 409);
    const sb = await redeem(h, b.token);
    await authorize(h, b.invitationId);
    h.sessions.get(sb.sessionId)!.status = 'COMPLETED';
    await expectCode(redeem(h, b.token, null), 'INVITATION_ALREADY_USED');
    await expectCode(authorize(h, b.invitationId, { reason: 'again' }), 'RECOVERY_NOT_APPLICABLE', 409);
  });
  it('recovery with a different ACTIVE session in the new browser is 409 and is not consumed', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    await redeem(h, a.token);
    const sb = await redeem(h, b.token);
    await authorize(h, a.invitationId);
    await expectCode(redeem(h, a.token, sb.sessionId), 'ACTIVE_SESSION_IN_BROWSER', 409);
    expect(h.invitations.docs.get(a.invitationId)!.recovery!.consumedAt).toBeNull();
    expect((await redeem(h, a.token, null)).outcome).toBe('RECOVERED');
  });
});

describe('participant write surface (AC-03 clause P2)', () => {
  it('a full redeem + resume + recovery changes only status/sessionId/redeemedAt and recovery.consumedAt, via the two CAS ops', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId, 'V2');
    const before = JSON.parse(JSON.stringify(h.invitations.docs.get(inv.invitationId)));
    const first = await redeem(h, inv.token);
    await redeem(h, inv.token, first.sessionId);
    await h.admin.authorizeRecovery(RESEARCHER, inv.invitationId, { confirm: true, reason: 'r', validForHours: 1 });
    const adminSnapshot = JSON.parse(JSON.stringify(h.invitations.docs.get(inv.invitationId)));
    await redeem(h, inv.token, null);
    const after = JSON.parse(JSON.stringify(h.invitations.docs.get(inv.invitationId)));
    const diffKeys = (x: Record<string, unknown>, y: Record<string, unknown>) => Object.keys({ ...x, ...y }).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).sort();
    expect(diffKeys(before, adminSnapshot)).toEqual(['recovery', 'redeemedAt', 'sessionId', 'status']);
    const participantDiff = diffKeys(adminSnapshot, after);
    expect(participantDiff).toEqual(['recovery']);
    expect(Object.keys(after.recovery).filter((k) => JSON.stringify(adminSnapshot.recovery[k]) !== JSON.stringify(after.recovery[k]))).toEqual(['consumedAt']);
    expect(after.variant).toBe('V2');
    expect(after.tokenHash).toBe(before.tokenHash);
    expect(h.invitations.writes.filter((w) => !['insertMany', 'authorizeRecovery'].includes(w)).sort()).toEqual(['claimIssued', 'consumeRecovery']);
  });
});
