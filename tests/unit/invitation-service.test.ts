import { describe, expect, it } from 'vitest';
import { expectCode, makeRedeemHarness } from '../helpers/invitation-fakes';
import { RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';
import { generateInvitationToken, hashInvitationToken, isWellFormedInvitationToken, buildInvitationLink } from '@/lib/study-run/invitation-token';

describe('invitation token (AC-04)', () => {
  it('is 256-bit random base64url (43 chars), unique, and hashed with SHA-256 hex', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInvitationToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) { expect(isWellFormedInvitationToken(t)).toBe(true); expect(t).toHaveLength(43); }
    const t = [...tokens][0];
    expect(hashInvitationToken(t)).toHaveLength(64);
    expect(hashInvitationToken(t)).toBe(hashInvitationToken(t));
    expect(hashInvitationToken(t) === t).toBe(false);
  });
  it('builds a fragment link and rejects malformed tokens', () => {
    expect(buildInvitationLink('https://x.example/', 'abc')).toBe('https://x.example/i#abc');
    for (const bad of ['', 'short', 'a'.repeat(44), 'a'.repeat(42) + '!', null, undefined, 5]) expect(isWellFormedInvitationToken(bad)).toBe(false);
  });
});

describe('InvitationService: create / revoke / replace (AC-04, AC-20, AC-03 P2)', () => {
  it('returns each link once, stores only the hash, and never writes the token anywhere (store, audit)', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const issued = await h.issue(runId, 'V2', 3);
    expect(issued).toHaveLength(3);
    for (const i of issued) {
      expect(i.link).toBe(`https://study.example/i#${i.token}`);
      expect(isWellFormedInvitationToken(i.token)).toBe(true);
    }
    const stored = JSON.stringify([...h.invitations.docs.values()]);
    const audit = JSON.stringify(h.audits);
    for (const i of issued) {
      expect(stored.includes(i.token)).toBe(false);
      expect(audit.includes(i.token)).toBe(false);
      expect(audit.includes(hashInvitationToken(i.token))).toBe(false);
      expect(stored.includes(hashInvitationToken(i.token))).toBe(true);
    }
    expect([...h.invitations.docs.values()].every((d) => d.status === 'ISSUED' && d.variant === 'V2' && d.recovery === null)).toBe(true);
    const listed = JSON.stringify(await h.admin.list(RESEARCHER, runId));
    expect(listed.includes('tokenHash')).toBe(false);
    expect(h.audits.filter((a) => a.action === 'INVITATION_ISSUED')).toHaveLength(3);
  });
  it('the first invitation locks the run (once); further invitations do not', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    expect((await h.service.get(RESEARCHER, runId)).locked).toBe(false);
    await h.issue(runId, 'V1', 1);
    const afterFirst = await h.service.get(RESEARCHER, runId);
    expect(afterFirst.locked).toBe(true);
    await h.issue(runId, 'V2', 2);
    expect((await h.service.get(RESEARCHER, runId)).version).toBe(afterFirst.version);
    expect(h.audits.filter((a) => a.action === 'STUDY_RUN_LOCKED')).toHaveLength(1);
  });
  it('only RESEARCHER writes; SUPERVISOR may list; nothing is created automatically (also not when quota is reached)', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [inv] = await h.issue(runId);
    const before = h.invitations.docs.size;
    const calls: Array<() => Promise<unknown>> = [
      () => h.admin.create(SUPERVISOR, { studyRunId: runId, variant: 'V1', count: 1 }),
      () => h.admin.revoke(SUPERVISOR, inv.invitationId, { reason: 'x' }),
      () => h.admin.replace(SUPERVISOR, inv.invitationId, {}),
      () => h.admin.authorizeRecovery(SUPERVISOR, inv.invitationId, { confirm: true, reason: 'x', validForHours: 1 }),
      () => h.admin.cancelRecovery(SUPERVISOR, inv.invitationId)
    ];
    for (const c of calls) await expectCode(c(), 'FORBIDDEN');
    expect(h.invitations.docs.size).toBe(before);
    expect(await h.admin.list(SUPERVISOR, runId)).toHaveLength(1);
    // quota "reached": counters at target, still only the Admin's explicit call creates more
    h.store.setArmsForTest(h.store.docs.values().next().value!._id!, { V1: { validIncluded: 15, supplementalValid: 0 }, V2: { validIncluded: 15, supplementalValid: 0 } });
    expect(h.invitations.docs.size).toBe(before);
    await h.issue(runId, 'V1', 1);
    expect(h.invitations.docs.size).toBe(before + 1);
  });
  it('validates count, variant and label (no personal data)', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    for (const bad of [{ count: 0 }, { count: 201 }, { count: 1.5 }, { variant: 'A' }, { label: 'a@b.com' }, { label: 'call 0912345678' }, { label: '' }]) {
      let rejected = false;
      try { await h.admin.create(RESEARCHER, { studyRunId: runId, variant: 'V1', count: 1, ...bad }); } catch { rejected = true; }
      expect(rejected).toBe(true);
    }
    expect(h.invitations.docs.size).toBe(0);
    await h.admin.create(RESEARCHER, { studyRunId: runId, variant: 'V1', count: 1, label: 'Lớp A - đợt 1' });
    expect(h.invitations.docs.size).toBe(1);
  });
  it('revoke: ISSUED -> REVOKED with reason + audit; a revoked or redeemed invitation cannot be revoked again', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a, b] = await h.issue(runId, 'V1', 2);
    const r = await h.admin.revoke(RESEARCHER, a.invitationId, { reason: 'sent to wrong person' });
    expect(r.invitation.status).toBe('REVOKED');
    expect(r.invitation.revokedBy).toBe('researcher');
    expect(h.audits[h.audits.length - 1].action).toBe('INVITATION_REVOKED');
    await expectCode(h.admin.revoke(RESEARCHER, a.invitationId, { reason: 'again' }), 'INVITATION_NOT_ISSUED', 409);
    await h.redemption().redeem({ token: b.token, deviceType: 'desktop', cookieSessionId: null });
    await expectCode(h.admin.revoke(RESEARCHER, b.invitationId, { reason: 'late' }), 'INVITATION_ALREADY_REDEEMED', 409);
    await expectCode(h.redemption().redeem({ token: a.token, deviceType: 'desktop', cookieSessionId: null }), 'INVITATION_UNAVAILABLE', 404);
  });
  it('replace: same run and variant, records replacesInvitationId, only after REVOKE/REDEEMED; never auto', async () => {
    const h = makeRedeemHarness();
    const { runId } = await h.openRun();
    const [a] = await h.issue(runId, 'V2', 1);
    await expectCode(h.admin.replace(RESEARCHER, a.invitationId, {}), 'INVITATION_REVOKE_FIRST', 409);
    await h.admin.revoke(RESEARCHER, a.invitationId, { reason: 'lost' });
    const { issued } = await h.admin.replace(RESEARCHER, a.invitationId, {});
    const doc = h.invitations.docs.get(issued.invitationId)!;
    expect(doc.variant).toBe('V2');
    expect(doc.status).toBe('ISSUED');
    expect(doc.replacesInvitationId!.toHexString()).toBe(a.invitationId);
    expect(doc.studyRunId.toHexString()).toBe(runId);
    const res = await h.redemption().redeem({ token: issued.token, deviceType: 'desktop', cookieSessionId: null });
    expect(h.sessions.get(res.sessionId)!.presentationVariant).toBe('V2');
  });
  it('unknown run or invitation is 404', async () => {
    const h = makeRedeemHarness();
    await expectCode(h.admin.create(RESEARCHER, { studyRunId: 'a'.repeat(24), variant: 'V1', count: 1 }), 'STUDY_RUN_NOT_FOUND', 404);
    await expectCode(h.admin.revoke(RESEARCHER, 'b'.repeat(24), { reason: 'x' }), 'INVITATION_NOT_FOUND', 404);
    await expectCode(h.admin.revoke(RESEARCHER, 'nope', { reason: 'x' }), 'INVITATION_NOT_FOUND', 404);
  });
});
