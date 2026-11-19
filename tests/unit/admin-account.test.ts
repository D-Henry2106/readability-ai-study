import { describe, it, expect, vi } from 'vitest';
import { changeAdminPassword, disableAdminAccount, type AdminAccountStore } from '@/lib/services/admin-account.service';
import { hashPassword } from '@/lib/security/password';
import { updateResearchConfig } from '@/lib/services/config-update.service';
import { reviewSessionValidity } from '@/lib/services/validity-review.service';
import { jsonError } from '@/lib/http';
import type { AdminDoc } from '@/types/research';
import type { ResearchRepository } from '@/lib/repositories/research.repository';

const CURRENT = 'current-Passphrase-2026';
async function setup(over: Partial<AdminDoc> = {}) {
  const doc: AdminDoc = { username: 'qa', passwordHash: await hashPassword(CURRENT), role: 'RESEARCHER', createdAt: new Date(), ...over };
  const store: AdminAccountStore & { doc: AdminDoc } = {
    doc,
    find: async (u) => (u === doc.username ? doc : null),
    setPassword: vi.fn(async (_u: string, hash: string, at: Date) => { if (doc.disabledAt) return false; doc.passwordHash = hash; doc.passwordChangedAt = at; return true; }),
    disable: vi.fn(async (_u: string, at: Date) => { if (doc.disabledAt) return false; doc.disabledAt = at; return true; })
  };
  const revokeAllSessions = vi.fn(async () => 3);
  const audit = { record: vi.fn(async () => undefined) };
  return { store, revokeAllSessions, audit, deps: { store, revokeAllSessions, audit } };
}

describe('password change', () => {
  it('changes the hash, revokes ALL sessions and writes an audit entry without any password', async () => {
    const s = await setup(); const before = s.store.doc.passwordHash;
    const r = await changeAdminPassword({ username: 'qa', role: 'RESEARCHER', currentPassword: CURRENT, newPassword: 'violet-lantern-orbit-2026' }, s.deps);
    expect(r.status).toBe(200);
    expect(s.store.doc.passwordHash).not.toBe(before);
    expect(s.revokeAllSessions).toHaveBeenCalledWith('qa', 'PASSWORD_CHANGED');
    expect(s.audit.record).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(s.audit.record.mock.calls[0]);
    expect(entry).toContain('ADMIN_PASSWORD_CHANGED'); expect(entry).not.toContain('violet'); expect(entry).not.toContain(CURRENT);
  });
  it.each([
    ['wrong current password', { currentPassword: 'nope-nope-nope-nope', newPassword: 'violet-lantern-orbit-2026' }, 'CURRENT_PASSWORD_INVALID'],
    ['weak new password', { currentPassword: CURRENT, newPassword: 'short' }, 'PASSWORD_POLICY'],
    ['same password', { currentPassword: CURRENT, newPassword: CURRENT }, 'PASSWORD_UNCHANGED']
  ])('%s → 400, nothing changed, no sessions revoked, no audit', async (_n, input, code) => {
    const s = await setup(); const before = s.store.doc.passwordHash;
    const r = await changeAdminPassword({ username: 'qa', role: 'RESEARCHER', ...input }, s.deps);
    expect(r.status).toBe(400); expect(r.status === 400 && r.body.code).toBe(code);
    expect(s.store.doc.passwordHash).toBe(before);
    expect(s.revokeAllSessions).not.toHaveBeenCalled(); expect(s.audit.record).not.toHaveBeenCalled();
  });
  it('a disabled account cannot change its password', async () => {
    const s = await setup({ disabledAt: new Date() });
    expect((await changeAdminPassword({ username: 'qa', role: 'RESEARCHER', currentPassword: CURRENT, newPassword: 'violet-lantern-orbit-2026' }, s.deps)).status).toBe(400);
    expect(s.revokeAllSessions).not.toHaveBeenCalled();
  });
});

describe('disable admin', () => {
  it('disables, revokes every session and audits the actor', async () => {
    const s = await setup();
    expect(await disableAdminAccount({ username: 'qa', actor: { username: 'system:cli', role: 'SYSTEM' } }, s.deps)).toEqual({ disabled: true, revokedSessions: 3 });
    expect(s.revokeAllSessions).toHaveBeenCalledWith('qa', 'ACCOUNT_DISABLED');
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_DISABLED', username: 'system:cli', role: 'SYSTEM', targetId: 'qa' }));
  });
  it('is a no-op (no audit) for an unknown or already disabled account', async () => {
    const s = await setup({ disabledAt: new Date() });
    expect((await disableAdminAccount({ username: 'qa', actor: { username: 'x', role: 'RESEARCHER' } }, s.deps)).disabled).toBe(false);
    expect(s.audit.record).not.toHaveBeenCalled();
  });
});

describe('role checks inside critical services (insufficient role → 403, nothing read or written)', () => {
  const repo = new Proxy({}, { get() { throw new Error('repository must not be touched'); } }) as unknown as ResearchRepository;
  it('config update', async () => {
    const err = await updateResearchConfig({} as never, { username: 's', role: 'SUPERVISOR' }, repo).catch((e) => e);
    expect(err.message).toBe('FORBIDDEN'); expect(jsonError(err).status).toBe(403);
  });
  it('validity review', async () => {
    const err = await reviewSessionValidity('id', { validityFlag: 'VALID', reason: null }, { username: 's', role: 'SUPERVISOR' }, repo).catch((e) => e);
    expect(err.message).toBe('FORBIDDEN'); expect(jsonError(err).status).toBe(403);
  });
});
