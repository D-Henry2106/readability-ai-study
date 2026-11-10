import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdminSessionService, hashSessionToken,
  type AdminDirectory, type AdminSessionStore
} from '@/lib/auth/admin-session-service';
import type { AdminSessionDoc } from '@/types/research';

class MemoryStore implements AdminSessionStore {
  docs = new Map<string, AdminSessionDoc>();
  touches = 0;
  async create(doc: AdminSessionDoc) { this.docs.set(doc.tokenHash, structuredClone(doc)); }
  async findByHash(h: string) { const d = this.docs.get(h); return d ? structuredClone(d) : null; }
  async touch(h: string, lastSeenAt: Date, idleExpiresAt: Date) { this.touches++; const d = this.docs.get(h); if (d && !d.revokedAt) Object.assign(d, { lastSeenAt, idleExpiresAt }); }
  async revokeByHash(h: string, reason: string, at: Date) { const d = this.docs.get(h); if (!d || d.revokedAt) return false; d.revokedAt = at; d.revokedReason = reason; return true; }
  async revokeAllForUser(u: string, reason: string, at: Date, except?: string) {
    let n = 0; for (const d of this.docs.values()) if (d.username === u && !d.revokedAt && d.tokenHash !== except) { d.revokedAt = at; d.revokedReason = reason; n++; } return n;
  }
}

describe('admin session service (opaque token, server-side state)', () => {
  let now = new Date('2026-01-01T00:00:00Z');
  let store: MemoryStore;
  let admin: { username: string; role: 'RESEARCHER' | 'SUPERVISOR'; disabledAt: Date | null } | null;
  let n = 0;
  const directory: AdminDirectory = { find: async () => admin };
  const make = () => new AdminSessionService(store, directory, () => ({ idleMs: 30 * 60_000, absoluteMs: 8 * 3_600_000 }), () => now,
    () => Buffer.alloc(32, ++n).toString('base64url'));
  const advance = (ms: number) => { now = new Date(now.getTime() + ms); };

  beforeEach(() => { now = new Date('2026-01-01T00:00:00Z'); store = new MemoryStore(); admin = { username: 'r1', role: 'RESEARCHER', disabledAt: null }; });

  it('stores only a hash of the token, never the token itself', async () => {
    const { token } = await make().issue('r1');
    const stored = JSON.stringify([...store.docs.values()]);
    expect(stored).not.toContain(token);
    expect(store.docs.has(hashSessionToken(token))).toBe(true);
  });

  it('accepts a fresh token and returns the role from the admins directory', async () => {
    const s = make(); const { token } = await s.issue('r1');
    expect(await s.validate(token)).toMatchObject({ username: 'r1', role: 'RESEARCHER' });
    admin = { username: 'r1', role: 'SUPERVISOR', disabledAt: null };
    expect((await s.validate(token))?.role).toBe('SUPERVISOR');
  });

  it('rejects garbage, empty, legacy HMAC-style and unknown tokens without touching the store', async () => {
    const s = make();
    for (const bad of [undefined, '', 'abc', 'eyJ1c2VybmFtZSI6InIxIn0.c2ln', 'x'.repeat(43), '../'.repeat(20)]) expect(await s.validate(bad)).toBeNull();
  });

  it('expires after the idle timeout, and activity slides it forward', async () => {
    const s = make(); const { token } = await s.issue('r1');
    advance(20 * 60_000); expect(await s.validate(token)).not.toBeNull();   // refreshes idle window
    advance(20 * 60_000); expect(await s.validate(token)).not.toBeNull();   // 40 min total, still alive
    advance(31 * 60_000); expect(await s.validate(token)).toBeNull();       // idle > 30 min
  });

  it('enforces the absolute expiry even with constant activity', async () => {
    const s = make(); const { token } = await s.issue('r1');
    for (let i = 0; i < 16; i++) { advance(29 * 60_000); expect(await s.validate(token)).not.toBeNull(); }
    advance(29 * 60_000);
    expect(now.getTime() - new Date('2026-01-01T00:00:00Z').getTime()).toBeGreaterThan(8 * 3_600_000);
    expect(await s.validate(token)).toBeNull();
  });

  it('writes the idle refresh at most once a minute', async () => {
    const s = make(); const { token } = await s.issue('r1');
    for (let i = 0; i < 5; i++) { advance(5_000); await s.validate(token); }
    expect(store.touches).toBe(0);
    advance(60_000); await s.validate(token);
    expect(store.touches).toBe(1);
  });

  it('logout revokes server-side: the same token can never be replayed', async () => {
    const s = make(); const { token } = await s.issue('r1');
    expect(await s.revoke(token, 'LOGOUT')).toBe(true);
    expect(await s.validate(token)).toBeNull();
    expect(await s.revoke(token, 'LOGOUT')).toBe(false);
  });

  it('rotation: issuing after revoking gives a different token and the old one is dead', async () => {
    const s = make(); const first = await s.issue('r1');
    await s.revoke(first.token, 'ROTATED_ON_LOGIN');
    const second = await s.issue('r1');
    expect(second.token).not.toBe(first.token);
    expect(await s.validate(first.token)).toBeNull();
    expect(await s.validate(second.token)).not.toBeNull();
  });

  it('revoke-all (password change) kills every session; "except" keeps one', async () => {
    const s = make(); const a = await s.issue('r1'); const b = await s.issue('r1'); const other = await s.issue('someone-else');
    admin = { username: 'someone-else', role: 'RESEARCHER', disabledAt: null };
    expect(await s.revokeAllForUser('r1', 'PASSWORD_CHANGED', b.token)).toBe(1);
    admin = { username: 'r1', role: 'RESEARCHER', disabledAt: null };
    expect(await s.validate(a.token)).toBeNull();
    expect(await s.validate(b.token)).not.toBeNull();
    expect(await s.revokeAllForUser('r1', 'PASSWORD_CHANGED')).toBe(1);
    expect(await s.validate(b.token)).toBeNull();
    admin = { username: 'someone-else', role: 'RESEARCHER', disabledAt: null };
    expect(await s.validate(other.token)).not.toBeNull();
  });

  it('a disabled or deleted admin loses the session immediately', async () => {
    const s = make(); const { token } = await s.issue('r1');
    admin = { username: 'r1', role: 'RESEARCHER', disabledAt: now };
    expect(await s.validate(token)).toBeNull();
    admin = { username: 'r1', role: 'RESEARCHER', disabledAt: null };
    expect(await s.validate(token)).toBeNull();       // stays revoked even if re-enabled
    const t2 = (await s.issue('r1')).token; admin = null;
    expect(await s.validate(t2)).toBeNull();
  });
});
